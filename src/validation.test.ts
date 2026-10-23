import { createClient } from 'redis';
import * as v from 'valibot';
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
	vi,
} from 'vitest';
import { createRedisXEnv } from './main.js';

const redisClient = createClient({ socket: { port: 16379 } });

beforeAll(async () => {
	await redisClient.connect();
});

afterAll(async () => {
	await redisClient.DEL(['@x:env:instances', '@x:env:reload', '@x:env:secret']);
	await redisClient.quit();
});

class Address {
	#value: string;

	constructor(value: string) {
		this.#value = value;
	}

	set(value: string): void {
		this.#value = value;
	}

	toString(): string {
		return this.#value;
	}
}

describe('validation', () => {
	let destroy: (() => Promise<void>) | undefined;

	afterEach(async () => {
		const cleanup = destroy;
		destroy = undefined;
		try {
			await cleanup?.();
		} finally {
			vi.restoreAllMocks();
		}
	});

	test('validates once per load and returns the same values on every read', async () => {
		await redisClient.HSET('@x:env:instances', { address: '127.0.0.1' });
		let calls = 0;
		const env = await createRedisXEnv(redisClient, 'instances', (data) => {
			calls++;
			const parsed = v.parse(v.object({ address: v.string() }), data);
			return { address: new Address(parsed.address) };
		});
		destroy = () => env.destroy();
		expect(calls).toBe(1);

		const address: Address = env.get('address');
		expect(address).toBeInstanceOf(Address);
		expect(env.get('address')).toBe(address);
		expect(env.mget('address').address).toBe(address);
		expect(env.mget()).toStrictEqual({});
		expect(calls).toBe(1);

		await redisClient.HSET('@x:env:instances', { address: '10.0.0.1' });
		await env._reload();
		expect(calls).toBe(2);
		expect(env.get('address')).not.toBe(address);
		expect(env.get('address').toString()).toBe('10.0.0.1');
		expect(address.toString()).toBe('127.0.0.1');
		expect(calls).toBe(2);
	});

	test('fails reads after a reload with an invalid hash and recovers on the next valid one', async () => {
		await redisClient.HSET('@x:env:reload', { port: '3000' });
		const env = await createRedisXEnv(
			redisClient,
			'reload',
			v.parser(
				v.object({
					port: v.pipe(v.string(), v.transform(Number), v.minValue(1)),
				}),
			),
		);
		destroy = () => env.destroy();
		expect(env.get('port')).toBe(3000);

		await redisClient.HSET('@x:env:reload', { port: '0' });
		await env._reload();
		expect(() => env.get('port')).toThrow(
			'[@redis-x/env] Validation failed for namespace "reload".',
		);

		await redisClient.HSET('@x:env:reload', { port: '4000' });
		await env._reload();
		expect(env.get('port')).toBe(4000);
	});

	test('sanitizes validation errors without logging rejected values', async () => {
		// oxlint-disable-next-line no-console
		const errorLog = vi.spyOn(console, 'error').mockImplementation(vi.fn());
		const secret = 'dummy-sensitive-value';
		await redisClient.HSET('@x:env:secret', { secret });
		const env = await createRedisXEnv(redisClient, 'secret', (data) => {
			const parsed = v.parse(v.object({ secret: v.string() }), data);
			throw Object.assign(new Error(`Invalid secret: ${parsed.secret}`), {
				// eslint-disable-next-line unicorn/no-error-property-assignment -- Simulate sensitive validator diagnostics on Node.js 14.
				cause: parsed,
				input: parsed,
			});
		});
		destroy = () => env.destroy();

		for (const read of [
			() => env.get('secret'),
			() => env.mget('secret'),
			() => env.mget(),
		]) {
			let caught: unknown;
			try {
				read();
			} catch (error) {
				caught = error;
			}

			expect(caught).toBeInstanceOf(Error);
			expect(caught).toHaveProperty(
				'message',
				'[@redis-x/env] Validation failed for namespace "secret".',
			);
			expect(caught).not.toHaveProperty('cause');
			expect(caught).not.toHaveProperty('input');
			expect(String(caught)).not.toContain(secret);
		}

		expect(errorLog).not.toHaveBeenCalled();
	});
});
