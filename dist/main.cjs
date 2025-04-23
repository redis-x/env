"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// dist/esm/main.js
var main_exports = {};
__export(main_exports, {
  RedisXEnv: () => RedisXEnv,
  createRedisXEnv: () => createRedisXEnv
});
module.exports = __toCommonJS(main_exports);
var no_new_symbol = Symbol("no_new");
var RedisXEnv = class {
  redisClient;
  redisSubClient;
  namespace;
  redis_key;
  validator;
  storage = null;
  constructor(redisClient, namespace, validator, _protection) {
    if (_protection !== no_new_symbol) {
      throw new Error("[@redis-x/env] Do not use new RedisXEnv(), use createRedisXEnv() instead.");
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
      this.reload().catch(console.error);
    });
  }
  async reload() {
    const data = await this.redisClient.HGETALL(this.redis_key);
    try {
      this.storage = this.validator(data);
    } catch (error) {
      if (process.env.SILENT !== "1") {
        console.error("[@redis-x/env] Failed to validate namespace. Error below:");
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
};
async function createRedisXEnv(redisClient, namespace, validator) {
  const redisEnv = new RedisXEnv(redisClient, namespace, validator, no_new_symbol);
  await Promise.all([
    // @ts-expect-error Accessing private property.
    redisEnv.reload(),
    // @ts-expect-error Accessing private property.
    redisEnv.subscribe()
  ]);
  return redisEnv;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  RedisXEnv,
  createRedisXEnv
});
