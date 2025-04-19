# @redis-x/env

Store your environment variables in Redis, but access them synchronously in your application.

[![npm version](https://img.shields.io/npm/v/@redis-x/env.svg)](https://www.npmjs.com/package/@redis-x/env)
[![license](https://img.shields.io/npm/l/@redis-x/env.svg)](https://github.com/redis-x/env/blob/main/LICENSE)

## Features

- 🗄️ **Redis-backed environment variables**: Store all your app configuration in Redis
- ⚡ **Synchronous access**: No need for `await` when accessing your environment variables
- ✅ **Schema validation**: Validate your environment with any validator library, ensure type-safety
- 🔔 **Real-time updates**: Environment variables are refreshed when changes are published to Redis
- 🛡️ **Type-safe access**: Full TypeScript support with inferred types from your schema

## Installation

```bash
bun add @redis-x/env redis
# or
pnpm add @redis-x/env redis
# or
npm install @redis-x/env redis
```

## Quick Start

```typescript
import { createClient } from 'redis';
import { createRedisEnv } from '@redis-x/env';
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
  DEBUG: v.pipe(
    v.string(),
    v.transform((value) => value === 'true'),
  ),
  DATABASE_CONFIG: v.pipe(
    v.string(),
    v.transform((value) => JSON.parse(value)),
    v.object({
      host: v.string(),
      port: v.number(),
    }),
  ),
}));

// Create RedisEnv instance
const env = await createRedisEnv(
  redisClient,
  'myapp', // namespace
  envValidator,
);

// Use your environment variables synchronously
const port = env.get('PORT'); // returns a number
const api_key = env.get('API_KEY'); // returns a string
const is_debug = env.get('DEBUG'); // returns a boolean
const db_config = env.get('DATABASE_CONFIG'); // returns an object

// Get multiple values at once
const { PORT, API_KEY } = env.mget('PORT', 'API_KEY');
```

## How It Works

1. Your environment variables are stored in Redis as a hash with the key `@x:env:{namespace}`
2. When your application starts, `@redis-x/env` loads and validates all variables
3. The library subscribes to Redis PubSub to detect changes to your environment
4. If changes occur, the environment is automatically reloaded and validated
5. Access is always synchronous after initial loading

## Updating Environment Variables

To update environment variables in Redis, update your hash and publish a message to `@x:env:{namespace}`:

```redis
HSET @x:env:myapp PORT 3000 API_KEY secret-key DEBUG true DATABASE_CONFIG '{"host":"localhost","port":5432}'
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

Issues and pull requests are welcome at [https://github.com/redis-x/env](https://github.com/redis-x/env).
