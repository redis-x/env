import type {
	RedisClientType,
	RedisFunctions,
	RedisModules,
	RedisScripts,
} from 'redis';

type RedisClient = RedisClientType<RedisFunctions, RedisModules, RedisScripts>;

export class RedisEnv<const T extends Record<string, unknown>> {
	private redisClient: RedisClient;
	private redisSubClient: RedisClient;
	private namespace: string;
	readonly redis_key: string;
	private validator: (value: unknown) => T;
	private storage: T | null = null;

	constructor(
		redisClient: RedisClient,
		namespace: string,
		validator: (value: unknown) => T,
	) {
		this.redisClient = redisClient;
		this.redisSubClient = redisClient.duplicate();

		this.namespace = namespace;
		this.redis_key = `@x:env:${namespace}`;
		this.validator = validator;
	}

	private async subscribe() {
		await this.redisSubClient.connect();

		await this.redisSubClient.subscribe(
			this.redis_key,
			() => {
				// eslint-disable-next-line no-console
				this.reload().catch(console.error);
			},
		);
	}

	private async reload() {
		const data = await this.redisClient.HGETALL(this.redis_key);

		try {
			this.storage = this.validator(data);
		}
		catch (error) {
			if (process.env.SILENT !== '1') {
				// eslint-disable-next-line no-console
				console.error('[@redis-x/env] Failed to validate namespace. Error below:');
				// eslint-disable-next-line no-console
				console.error(error);
			}

			this.storage = null;
		}
	}

	get<const K extends string>(key: K): Readonly<T[K]> {
		if (!this.storage) {
			throw new Error(`[@redis-x/env] Cannot read from namespace "${this.namespace}" because it is not loaded. This is likely due to a RedisEnv misconfiguration or an error in the Redis server.`);
		}

		return this.storage[key];
	}

	mget<const K extends string[]>(...keys: K) {
		if (!this.storage) {
			throw new Error(`[@redis-x/env] Cannot read from namespace "${this.namespace}" because it is not loaded. This is likely due to a RedisEnv misconfiguration or an error in the Redis server.`);
		}

		const result: Record<string, unknown> = {};
		for (const key of keys) {
			result[key] = this.storage[key];
		}

		return result as Readonly<{ [key in K[number]]: T[key] }>;
	}
}

/**
 * Creates a new RedisEnv instance.
 * @param redisClient The Redis client instance.
 * @param namespace The namespace for the environment.
 * @param validator The validator function for the environment.
 * @returns A new RedisEnv instance.
 */
export async function createRedisEnv<const T extends Record<string, unknown>>(
	redisClient: RedisClient,
	namespace: string,
	validator: (value: unknown) => T,
) {
	const redisEnv = new RedisEnv(redisClient, namespace, validator);

	await Promise.all([
		// @ts-expect-error Accessing private property.
		redisEnv.reload(),
		// @ts-expect-error Accessing private property.
		redisEnv.subscribe(),
	]);

	return redisEnv;
}
