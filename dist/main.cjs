Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let _redis_x_client = require("@redis-x/client");
//#region src/main.ts
const no_new_symbol = Symbol("no_new");
const symbol_not_ready = Symbol("not_ready");
const symbol_validation_failed = Symbol("validation_failed");
var RedisXEnv = class {
	#redisXClient;
	#redisSubClient;
	#namespace;
	#validator;
	/** The validated env, `symbol_validation_failed` if the latest loaded hash failed validation, or `symbol_not_ready` before the first load. */
	#storage = symbol_not_ready;
	/** @internal */
	_redis_key;
	constructor(redisClient, namespace, validator, _protection) {
		if (_protection !== no_new_symbol) throw new Error("[@redis-x/env] Do not use new RedisXEnv(), use createRedisXEnv() instead.");
		this.#redisXClient = (0, _redis_x_client.getRedisXClient)(redisClient);
		this.#redisSubClient = this.#redisXClient["~redisClient"].duplicate();
		this.#redisSubClient.on("error", (error) => {
			console.error(error);
		});
		this.#namespace = namespace;
		this.#validator = validator;
		this._redis_key = `@x:env:${namespace}`;
	}
	/** @internal */
	async _subscribe() {
		await this.#redisSubClient.connect();
		const reload = () => {
			this._reload().catch(console.error);
		};
		await this.#redisSubClient.subscribe(this._redis_key, reload);
		this.#redisSubClient.on("ready", reload);
	}
	/** @internal */
	async _reload() {
		const hash = await this.#redisXClient.HGETALL(this._redis_key);
		try {
			this.#storage = this.#validator(hash);
		} catch {
			this.#storage = symbol_validation_failed;
		}
	}
	get #env() {
		if (this.#storage === symbol_not_ready) throw new Error(`[@redis-x/env] Cannot read from namespace "${this.#namespace}" because it is not loaded. This is likely due to a RedisXEnv misconfiguration or an error on the Redis server.`);
		if (this.#storage === symbol_validation_failed) throw new Error(`[@redis-x/env] Validation failed for namespace "${this.#namespace}".`);
		return this.#storage;
	}
	get(key) {
		return this.#env[key];
	}
	mget(...keys) {
		const env = this.#env;
		const result = {};
		for (const key of keys) result[key] = env[key];
		return result;
	}
	async destroy() {
		if (this.#redisSubClient.isOpen) await this.#redisSubClient.disconnect();
	}
};
/**
* Creates a new RedisEnv instance.
* @param redisClient Client from the `redis` package or a RedisX client.
* @param namespace The namespace for the environment.
* @param validator The validator function for the environment.
* @returns A new RedisEnv instance.
*/
async function createRedisXEnv(redisClient, namespace, validator) {
	const redisEnv = new RedisXEnv(redisClient, namespace, validator, no_new_symbol);
	try {
		await redisEnv._subscribe();
		await redisEnv._reload();
	} catch (error) {
		try {
			await redisEnv.destroy();
		} catch {}
		throw error;
	}
	return redisEnv;
}
//#endregion
exports.RedisXEnv = RedisXEnv;
exports.createRedisXEnv = createRedisXEnv;
