import { getRedisXClient, type RedisXClient } from '@redis-x/client';
import type {
	RedisClientType,
	RedisFunctions,
	RedisModules,
	RedisScripts,
} from 'redis';

type RedisClient = RedisClientType<RedisModules, RedisFunctions, RedisScripts>;

const no_new_symbol: unique symbol = Symbol('no_new');
const symbol_not_ready: unique symbol = Symbol('not_ready');
const symbol_validation_failed: unique symbol = Symbol('validation_failed');

// oxlint-disable-next-line unicorn/name-replacements
export class RedisXEnv<const T extends Record<string, unknown>> {
	#redisXClient: RedisXClient;
	#redisSubClient: RedisClient;
	#namespace: string;
	#validator: (value: unknown) => T;
	/** The validated env, `symbol_validation_failed` if the latest loaded hash failed validation, or `symbol_not_ready` before the first load. */
	#storage: T | typeof symbol_not_ready | typeof symbol_validation_failed =
		symbol_not_ready;
	/** @internal */
	// eslint-disable-next-line unicorn/prefer-private-class-fields
	_redis_key: string;

	constructor(
		redisClient: RedisClient | RedisXClient,
		namespace: string,
		validator: (value: unknown) => T,
		_protection: typeof no_new_symbol,
	) {
		if (_protection !== no_new_symbol) {
			throw new Error(
				'[@redis-x/env] Do not use new RedisXEnv(), use createRedisXEnv() instead.',
			);
		}

		this.#redisXClient = getRedisXClient(redisClient);
		this.#redisSubClient = this.#redisXClient['~redisClient'].duplicate();
		this.#redisSubClient.on('error', (error) => {
			// oxlint-disable-next-line no-console
			console.error(error);
		});

		this.#namespace = namespace;
		this.#validator = validator;

		this._redis_key = `@x:env:${namespace}`;
	}

	/** @internal */
	// eslint-disable-next-line unicorn/prefer-private-class-fields
	async _subscribe(): Promise<void> {
		await this.#redisSubClient.connect();

		const reload = () => {
			// oxlint-disable-next-line no-console, promise/prefer-await-to-then, unicorn/prefer-await
			this._reload().catch(console.error);
		};

		await this.#redisSubClient.subscribe(this._redis_key, reload);

		// On reconnect, ready fires after node-redis restores the subscription.
		this.#redisSubClient.on('ready', reload);
	}

	/** @internal */
	// eslint-disable-next-line unicorn/prefer-private-class-fields
	async _reload(): Promise<void> {
		const hash = await this.#redisXClient.HGETALL(this._redis_key);

		try {
			this.#storage = this.#validator(hash);
		} catch {
			// Do not keep or log the error: validator diagnostics may contain rejected values.
			this.#storage = symbol_validation_failed;
		}
	}

	get #env(): T {
		if (this.#storage === symbol_not_ready) {
			throw new Error(
				`[@redis-x/env] Cannot read from namespace "${this.#namespace}" because it is not loaded. This is likely due to a RedisXEnv misconfiguration or an error on the Redis server.`,
			);
		}

		if (this.#storage === symbol_validation_failed) {
			throw new Error(
				`[@redis-x/env] Validation failed for namespace "${this.#namespace}".`,
			);
		}

		return this.#storage;
	}

	get<const K extends keyof T>(key: K): T[K] {
		return this.#env[key];
	}

	mget<const K extends (keyof T)[]>(
		...keys: K
	): Readonly<{ [key in K[number]]: T[key] }> {
		const env = this.#env;
		const result = {} as { [key in K[number]]: T[key] };
		for (const key of keys) {
			result[key] = env[key];
		}

		return result;
	}

	async destroy(): Promise<void> {
		if (this.#redisSubClient.isOpen) {
			await this.#redisSubClient.disconnect();
		}
	}
}

/**
 * Creates a new RedisEnv instance.
 * @param redisClient Client from the `redis` package or a RedisX client.
 * @param namespace The namespace for the environment.
 * @param validator The validator function for the environment.
 * @returns A new RedisEnv instance.
 */
export async function createRedisXEnv<const T extends Record<string, unknown>>(
	redisClient: RedisClient | RedisXClient,
	namespace: string,
	validator: (value: unknown) => T,
): Promise<RedisXEnv<T>> {
	const redisEnv = new RedisXEnv(
		redisClient,
		namespace,
		validator,
		no_new_symbol,
	);

	try {
		await redisEnv._subscribe();
		await redisEnv._reload();
	} catch (error) {
		try {
			await redisEnv.destroy();
		} catch {
			// Preserve the initialization error if cleanup also fails.
		}

		throw error;
	}

	return redisEnv;
}
