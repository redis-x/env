const no_new_symbol = Symbol('no_new');
export class RedisXEnv {
    redisClient;
    redisSubClient;
    namespace;
    redis_key;
    validator;
    storage = null;
    constructor(redisClient, namespace, validator, _protection) {
        if (_protection !== no_new_symbol) {
            throw new Error('[@redis-x/env] Do not use new RedisXEnv(), use createRedisXEnv() instead.');
        }
        this.redisClient = redisClient;
        this.redisSubClient = redisClient.duplicate();
        this.namespace = namespace;
        this.redis_key = `@x:env:${namespace}`;
        this.validator = validator;
    }
    async subscribe() {
        await this.redisSubClient.connect();
        await this.redisSubClient.subscribe(this.redis_key, () => {
            // eslint-disable-next-line no-console
            this.reload().catch(console.error);
        });
    }
    async reload() {
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
    get(key) {
        if (!this.storage) {
            throw new Error(`[@redis-x/env] Cannot read from namespace "${this.namespace}" because it is not loaded. This is likely due to a RedisEnv misconfiguration or an error in the Redis server.`);
        }
        return this.storage[key];
    }
    mget(...keys) {
        if (!this.storage) {
            throw new Error(`[@redis-x/env] Cannot read from namespace "${this.namespace}" because it is not loaded. This is likely due to a RedisEnv misconfiguration or an error in the Redis server.`);
        }
        const result = {};
        for (const key of keys) {
            result[key] = this.storage[key];
        }
        return result;
    }
}
/**
 * Creates a new RedisEnv instance.
 * @param redisClient The Redis client instance.
 * @param namespace The namespace for the environment.
 * @param validator The validator function for the environment.
 * @returns A new RedisEnv instance.
 */
export async function createRedisXEnv(redisClient, namespace, validator) {
    const redisEnv = new RedisXEnv(redisClient, namespace, validator, no_new_symbol);
    await Promise.all([
        // @ts-expect-error Accessing private property.
        redisEnv.reload(),
        // @ts-expect-error Accessing private property.
        redisEnv.subscribe(),
    ]);
    return redisEnv;
}
