import { RedisXClient } from "@redis-x/client";
import { RedisClientType, RedisFunctions, RedisModules, RedisScripts } from "redis";
//#region src/main.d.ts
type RedisClient = RedisClientType<RedisModules, RedisFunctions, RedisScripts>;
declare const no_new_symbol: unique symbol;
export declare class RedisXEnv<const T extends Record<string, unknown>> {
  #private;
  constructor(redisClient: RedisClient | RedisXClient, namespace: string, validator: (value: unknown) => T, _protection: typeof no_new_symbol);
  get<const K extends keyof T>(key: K): T[K];
  mget<const K extends (keyof T)[]>(...keys: K): Readonly<{ [key in K[number]]: T[key]; }>;
  destroy(): Promise<void>;
}
/**
 * Creates a new RedisEnv instance.
 * @param redisClient Client from the `redis` package or a RedisX client.
 * @param namespace The namespace for the environment.
 * @param validator The validator function for the environment.
 * @returns A new RedisEnv instance.
 */
export declare function createRedisXEnv<const T extends Record<string, unknown>>(redisClient: RedisClient | RedisXClient, namespace: string, validator: (value: unknown) => T): Promise<RedisXEnv<T>>;
//#endregion
export {};