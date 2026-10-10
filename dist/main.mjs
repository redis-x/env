//#region src/main.ts
const no_new_symbol = Symbol("no_new");
var RedisXEnv = class {
	#redisClient;
	#redisSubClient;
	#namespace;
	#validator;
	#storage = null;
	redis_key;
	constructor(redisClient, namespace, validator, _protection) {
		if (_protection !== no_new_symbol) throw new Error("[@redis-x/env] Do not use new RedisXEnv(), use createRedisXEnv() instead.");
		this.#redisClient = redisClient;
		this.#redisSubClient = redisClient.duplicate();
		this.#redisSubClient.on("error", (error) => {
			console.error(error);
		});
		this.#namespace = namespace;
		this.redis_key = `@x:env:${namespace}`;
		this.#validator = validator;
	}
	/** @internal */
	async _subscribe() {
		await this.#redisSubClient.connect();
		const reload = () => {
			this._reload().catch(console.error);
		};
		await this.#redisSubClient.subscribe(this.redis_key, reload);
		this.#redisSubClient.on("ready", reload);
	}
	/** @internal */
	async _reload() {
		const data = await this.#redisClient.HGETALL(this.redis_key);
		try {
			this.#storage = this.#validator(data);
		} catch (error) {
			if (process.env.NODE_ENV !== "test") {
				console.error("[@redis-x/env] Failed to validate namespace. Error below:");
				console.error(error);
			}
			this.#storage = null;
		}
	}
	get(key) {
		if (!this.#storage) throw new Error(`[@redis-x/env] Cannot read from namespace "${this.#namespace}" because it is not loaded. This is likely due to a RedisEnv misconfiguration or an error in the Redis server.`);
		return this.#storage[key];
	}
	mget(...keys) {
		if (!this.#storage) throw new Error(`[@redis-x/env] Cannot read from namespace "${this.#namespace}" because it is not loaded. This is likely due to a RedisEnv misconfiguration or an error in the Redis server.`);
		const result = {};
		for (const key of keys) result[key] = this.#storage[key];
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
