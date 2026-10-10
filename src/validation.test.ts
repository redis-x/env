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
	await redisClient.DEL([
		'@x:env:instances',
		'@x:env:mutable',
		'@x:env:secret',
	]);
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

describe('validation on reads', () => {
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

	test('validates once per read and preserves independent class instances', async () => {
		await redisClient.HSET('@x:env:instances', { address: '127.0.0.1' });
		let calls = 0;
		const env = await createRedisXEnv(redisClient, 'instances', (data) => {
			calls++;
			const parsed = v.parse(v.object({ address: v.string() }), data);
			const address = new Address(parsed.address);
			return { address, sameAddress: address };
		});
		destroy = () => env.destroy();
		expect(calls).toBe(0);

		const first: Address = env.get('address');
		expect(calls).toBe(1);
		expect(first).toBeInstanceOf(Address);
		first.set('changed');

		const batch = env.mget('address', 'sameAddress');
		const { address } = batch;
		expect(calls).toBe(2);
		expect(address.toString()).toBe('127.0.0.1');
		expect(address).not.toBe(first);
		expect(batch.sameAddress).toBe(address);
		address.set('changed again');
		expect(env.get('address').toString()).toBe('127.0.0.1');
		expect(calls).toBe(3);

		expect(env.mget()).toStrictEqual({});
		expect(calls).toBe(4);
	});

	test('isolates raw input and nested objects and arrays between reads', async () => {
		const original = { details: { label: 'original' }, items: ['one'] };
		await redisClient.HSET('@x:env:mutable', {
			payload: JSON.stringify(original),
		});
		const env = await createRedisXEnv(redisClient, 'mutable', (data) => {
			const hash = data as { payload: string };
			const config = v.parse(
				v.object({
					details: v.object({ label: v.string() }),
					items: v.array(v.string()),
				}),
				JSON.parse(hash.payload),
			);
			hash.payload = 'changed by validator';
			return { config };
		});
		destroy = () => env.destroy();

		const first = env.get('config');
		first.details.label = 'changed';
		first.items.push('two');
		const second = env.mget('config').config;
		expect(second).toStrictEqual(original);
		second.details.label = 'changed again';
		second.items.push('three');
		expect(env.get('config')).toStrictEqual(original);
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
