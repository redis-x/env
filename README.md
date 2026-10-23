# @redis-x/env

[![npm version](https://img.shields.io/npm/v/@redis-x/env.svg)](https://www.npmjs.com/package/@redis-x/env)
[![Open on npmx.dev](https://npmx.dev/api/registry/badge/version/@redis-x/env?style=shieldsio&label=npmx.dev)](https://npmx.dev/package/@redis-x/env)
[![license](https://img.shields.io/npm/l/@redis-x/env.svg?color=blue)](https://github.com/redis-x/env/blob/main/LICENSE)

Store your environment variables in Redis, but access them synchronously in your application.

## Features

- 🗄️ **Redis-backed environment variables**: Store all your app configuration in Redis
- ⚡ **Synchronous access**: No need for `await` when accessing your environment variables
- ✅ **Schema validation**: Validate your environment with any validator library, ensure type-safety
- 🔔 **Real-time updates**: Environment variables are refreshed when changes are published to Redis
- 🛡️ **Type-safe access**: Full TypeScript support with inferred types from your schema

## Installation

```bash
bun i @redis-x/env redis
# or with pnpm
pnpm add @redis-x/env redis
# or with npm
npm install @redis-x/env redis
```

## Quick Start

```typescript
import { createClient } from 'redis';
import { createRedisXEnv } from '@redis-x/env';
import * as v from 'valibot';

// Connect to Redis
const redisClient = createClient({
  url: 'redis://localhost:6379'
});
await redisClient.connect();

// Create validator — we use valibot for example
const envValidator = v.parser(v.object({
  PORT: v.pipe(
    v.string(),
    v.transform((value) => Number.parseInt(value)),
    v.minValue(1024),
    v.maxValue(65535),
  ),
  API_KEY: v.string(),
}));

// Create RedisEnv instance
const env = await createRedisXEnv(
  redisClient,
  'myapp', // namespace
  envValidator,
);

// Use your environment variables synchronously
const port = env.get('PORT'); // returns a number
const api_key = env.get('API_KEY'); // returns a string

// Get multiple values at once
const { PORT, API_KEY } = env.mget('PORT', 'API_KEY');
```

## How It Works

1. Your environment variables are stored in Redis as a hash with the key `@x:env:{namespace}`
2. During initialization, the library subscribes to Redis PubSub, then loads and validates the hash
3. Published changes and subscriber reconnections load and validate the hash again
4. Reads are synchronous and return the cached validated values without another Redis request

The validator runs once per load, so `get()` and `mget()` return the same values each time,
and these values are not write-protected. This is a design choice. Do not modify returned objects,
arrays or class instances: changes are visible to every later read until the next reload.

## Updating Environment Variables

To update environment variables in Redis, update your hash and publish a message to `@x:env:{namespace}`:

```redis
HSET @x:env:myapp PORT 3000 API_KEY secret-key
PUBLISH @x:env:myapp 1
```

When using `PUBLISH`, message is ignored.

## Error Handling

If validation fails (such as when required variables are missing or types are incorrect), accessing the environment will throw an error:

```typescript
try {
  const port = env.get('PORT');
} catch (error) {
  console.error('Environment validation failed:', error.message);
  // Handle the error appropriately
}
```

## Contributing

Issues and pull requests are welcome at [our GitHub repository](https://github.com/redis-x/env).
