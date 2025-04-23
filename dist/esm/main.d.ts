import type { RedisClientType, RedisFunctions, RedisModules, RedisScripts } from 'redis';
type RedisClient = RedisClientType<RedisFunctions, RedisModules, RedisScripts>;
declare const no_new_symbol: unique symbol;
export declare class RedisXEnv<const T extends Record<string, unknown>> {
    private redisClient;
    private redisSubClient;
    private namespace;
    readonly redis_key: string;
    private validator;
    private storage;
    constructor(redisClient: RedisClient, namespace: string, validator: (value: unknown) => T, _protection: typeof no_new_symbol);
    private subscribe;
    private reload;
    get<const K extends string>(key: K): Readonly<T[K]>;
    mget<const K extends string[]>(...keys: K): Readonly<{ [key in K[number]]: T[key]; }>;
}
/**
 * Creates a new RedisEnv instance.
 * @param redisClient The Redis client instance.
 * @param namespace The namespace for the environment.
 * @param validator The validator function for the environment.
 * @returns A new RedisEnv instance.
 */
export declare function createRedisXEnv<const T extends Record<string, unknown>>(redisClient: RedisClient, namespace: string, validator: (value: unknown) => T): Promise<RedisXEnv<T>>;
export {};
