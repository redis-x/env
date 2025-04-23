/* eslint-disable jsdoc/require-jsdoc */

import {
	beforeAll,
	describe,
	expect,
	test,
} from 'vitest';
import { createClient } from 'redis';
import * as v from 'valibot';
import { createRedisXEnv } from './main.js';

const redisClient = createClient({
	socket: {
		port: Number.parseInt(process.env.REDIS_PORT!),
	},
});
await redisClient.connect();
await redisClient.FLUSHDB();

async function updateEnv(env?: Record<string, string>) {
	const transaction = redisClient.MULTI();
	transaction.DEL('@x:env:test');

	if (env) {
		transaction.HSET('@x:env:test', env);
	}

	await transaction.EXEC();
}

describe('correct setup', () => {
	let redisXEnv;

	beforeAll(async () => {
		await updateEnv({
			foo: 'bar',
			bar: '42',
			baz: JSON.stringify({ qux: 'quux' }),
		});

		redisXEnv = await createRedisXEnv(
			redisClient,
			'test',
			v.parser(v.object({
				foo: v.string(),
				bar: v.pipe(
					v.string(),
					v.transform((value) => Number.parseInt(value)),
					v.minValue(0),
				),
				baz: v.pipe(
					v.string(),
					v.transform((value) => JSON.parse(value)),
					v.strictObject({
						qux: v.pipe(
							v.string(),
							v.minLength(1),
							v.maxLength(10),
						),
					}),
				),
			})),
		);
	});

	test('get', () => {
		expect(
			redisXEnv.get('foo'),
		).toBe('bar');
		expect(
			redisXEnv.get('bar'),
		).toBe(42);
		expect(
			redisXEnv.get('baz'),
		).toStrictEqual({ qux: 'quux' });
	});

	test('mget', () => {
		expect(
			redisXEnv.mget('foo', 'bar'),
		).toStrictEqual({
			foo: 'bar',
			bar: 42,
		});
	});

	test('get after update', async () => {
		await redisClient.MULTI()
			.HSET(redisXEnv.redis_key, 'bar', '69')
			.PUBLISH(redisXEnv.redis_key, '')
			.EXEC();

		await new Promise((resolve) => {
			setTimeout(resolve, 99);
		});

		expect(
			redisXEnv.get('foo'),
		).toBe('bar');
		expect(
			redisXEnv.get('bar'),
		).toBe(69);
		expect(
			redisXEnv.get('baz'),
		).toStrictEqual({ qux: 'quux' });
	});
});

test('invalid property on the server', async () => {
	await updateEnv({
		foo: 'bar',
		bar: '-42', // negative value
	});

	const redisXEnv = await createRedisXEnv(
		redisClient,
		'test',
		v.parser(v.object({
			foo: v.string(),
			bar: v.pipe(
				v.string(),
				v.transform((value) => Number.parseInt(value)),
				v.minValue(0),
			),
		})),
	);

	expect(() => redisXEnv.get('foo')).toThrow('Cannot read from namespace "test"');
	expect(() => redisXEnv.get('bar')).toThrow('Cannot read from namespace "test"');
});

test('namespace does not exist', async () => {
	await updateEnv();

	const redisXEnv = await createRedisXEnv(
		redisClient,
		'test',
		v.parser(v.object({
			foo: v.string(),
		})),
	);

	expect(() => redisXEnv.get('foo')).toThrow('Cannot read from namespace "test"');
	expect(() => redisXEnv.get('bar')).toThrow('Cannot read from namespace "test"');
});
