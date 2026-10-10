//#region src/main.ts
const no_new_symbol = Symbol("no_new");
var RedisXEnv = class {
	#redisClient;
	#redisSubClient;
	#namespace;
	#validator;
	#hash = null;
	/** @internal */
	_redis_key;
	constructor(redisClient, namespace, validator, _protection) {
		if (_protection !== no_new_symbol) throw new Error("[@redis-x/env] Do not use new RedisXEnv(), use createRedisXEnv() instead.");
		this.#redisClient = redisClient;
		this.#redisSubClient = redisClient.duplicate();
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
		this.#hash = await this.#redisClient.HGETALL(this._redis_key);
	}
	get #env() {
		if (!this.#hash) throw new Error(`[@redis-x/env] Cannot read from namespace "${this.#namespace}" because it is not loaded. This is likely due to a RedisXEnv misconfiguration or an error on the Redis server.`);
		try {
			return this.#validator({ ...this.#hash });
		} catch {
			throw new Error(`[@redis-x/env] Validation failed for namespace "${this.#namespace}".`);
		}
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
* @param redisClient The Redis client instance.
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
export { RedisXEnv, createRedisXEnv };
