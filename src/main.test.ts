/* eslint-disable jsdoc/require-jsdoc */

import { createClient } from 'redis';
import * as v from 'valibot';
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from 'vitest';
import { createRedisXEnv } from './main.js';

const redisClient = createClient({
	socket: {
		port: 16379,
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
	let redisXEnv: Awaited<ReturnType<typeof create>>;

	// oxlint-disable-next-line unicorn/consistent-function-scoping
	async function create() {
		return await createRedisXEnv(
			redisClient,
			'test',
			v.parser(
				v.object({
					foo: v.string(),
					bar: v.pipe(
						v.string(),
						v.transform((value) => Math.trunc(Number(value))),
						v.minValue(0),
					),
					baz: v.pipe(
						v.string(),
						v.transform((value) => JSON.parse(value)),
						v.strictObject({
							qux: v.pipe(v.string(), v.minLength(1), v.maxLength(10)),
						}),
					),
				}),
			),
		);
	}

	beforeAll(async () => {
		await updateEnv({
			foo: 'bar',
			bar: '42',
			baz: JSON.stringify({ qux: 'quux' }),
		});

		redisXEnv = await create();
	});

	test('get', () => {
		expect(redisXEnv.get('foo')).toBe('bar');
		expect(redisXEnv.get('bar')).toBe(42);
		expect(redisXEnv.get('baz')).toStrictEqual({ qux: 'quux' });
	});

	test('mget', () => {
		expect(redisXEnv.mget('foo', 'bar')).toStrictEqual({
			foo: 'bar',
			bar: 42,
		});
	});

	test('get after update', async () => {
		await redisClient
			.MULTI()
			.HSET(redisXEnv.redis_key, 'bar', '69')
			.PUBLISH(redisXEnv.redis_key, '')
			.EXEC();

		await new Promise((resolve) => {
			setTimeout(resolve, 99);
		});

		expect(redisXEnv.get('foo')).toBe('bar');
		expect(redisXEnv.get('bar')).toBe(69);
		expect(redisXEnv.get('baz')).toStrictEqual({ qux: 'quux' });
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
		v.parser(
			v.object({
				foo: v.string(),
				bar: v.pipe(
					v.string(),
					v.transform((value) => Math.trunc(Number(value))),
					v.minValue(0),
				),
			}),
		),
	);

	expect(() => redisXEnv.get('foo')).toThrow(
		'Cannot read from namespace "test"',
	);
	expect(() => redisXEnv.get('bar')).toThrow(
		'Cannot read from namespace "test"',
	);
});

test('namespace does not exist', async () => {
	await updateEnv();

	const redisXEnv = await createRedisXEnv(
		redisClient,
		'test',
		v.parser(
			v.object({
				foo: v.string(),
			}),
		),
	);

	expect(() => redisXEnv.get('foo')).toThrow(
		'Cannot read from namespace "test"',
	);
	expect(() =>
		redisXEnv.get(
			// @ts-expect-error Unknown property
			'bar',
		),
	).toThrow('Cannot read from namespace "test"');
});

describe('connection lifecycle', () => {
	let client: typeof redisClient;
	let subscriber: typeof redisClient;

	beforeEach(async () => {
		client = redisClient.duplicate();
		subscriber = client.duplicate();
		client.duplicate = () => subscriber;
		await client.connect();
	});

	afterEach(async () => {
		if (subscriber.isOpen) {
			await subscriber.disconnect();
		}

		await client.quit();
	});

	test('reloads updates missed while the subscriber was disconnected', async () => {
		await client.HSET('@x:env:reconnect', { foo: 'before' });
		let markReloaded: (value: string) => void;
		// eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- Support Node.js 14.
		const reloaded = new Promise<string>((resolve) => {
			markReloaded = resolve;
		});
		const env = await createRedisXEnv(client, 'reconnect', (data) => {
			const parsed = v.parse(v.object({ foo: v.string() }), data);
			if (parsed.foo === 'after') {
				markReloaded(parsed.foo);
			}

			return parsed;
		});
		expect(env.get('foo')).toBe('before');

		await subscriber.disconnect();
		await client.HSET(env.redis_key, { foo: 'after' });
		expect(await client.PUBLISH(env.redis_key, '')).toBe(0);
		await subscriber.connect();

		await reloaded;
		expect(env.get('foo')).toBe('after');
		await env.destroy();
	});

	test('closes the subscriber when the initial read fails', async () => {
		await client.SET('@x:env:wrongtype', 'not a hash');

		await expect(
			createRedisXEnv(client, 'wrongtype', v.parser(v.object({}))),
		).rejects.toThrow('WRONGTYPE');
		expect(subscriber.isOpen).toBe(false);
		expect(await client.PING()).toBe('PONG');
	});

	test('closes the subscriber when subscription fails', async () => {
		const error = new Error('Subscription denied');
		subscriber.subscribe = () => Promise.reject(error);

		await expect(
			createRedisXEnv(client, 'subscribe-failure', v.parser(v.object({}))),
		).rejects.toBe(error);
		expect(subscriber.isOpen).toBe(false);
		expect(await client.PING()).toBe('PONG');
	});

	test('preserves the error when connecting fails before opening a socket', async () => {
		const error = new Error('Connection refused');
		subscriber.connect = () => Promise.reject(error);

		await expect(
			createRedisXEnv(client, 'connect-failure', v.parser(v.object({}))),
		).rejects.toBe(error);
		expect(subscriber.isOpen).toBe(false);
		expect(await client.PING()).toBe('PONG');
	});

	test('preserves the initialization error if cleanup also fails', async () => {
		const error = new Error('Subscription denied');
		subscriber.subscribe = () => Promise.reject(error);
		const disconnect = subscriber.disconnect.bind(subscriber);
		subscriber.disconnect = async () => {
			await disconnect();
			throw new Error('Cleanup failed');
		};

		await expect(
			createRedisXEnv(client, 'cleanup-failure', v.parser(v.object({}))),
		).rejects.toBe(error);
		expect(subscriber.isOpen).toBe(false);
		expect(await client.PING()).toBe('PONG');
	});
});
