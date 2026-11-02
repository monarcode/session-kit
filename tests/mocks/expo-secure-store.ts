/**
 * In-memory stand-in for `expo-secure-store`, keeping SecureStore's key rule.
 * It rejects values over 2048 UTF-8 bytes, which SecureStore only warns
 * about, so an adapter that relies on larger values fails here.
 */

export type KeychainAccessibilityConstant = number;
export type SecureStoreOptions = { keychainAccessible?: number };

export const AFTER_FIRST_UNLOCK: KeychainAccessibilityConstant = 0;
export const WHEN_UNLOCKED: KeychainAccessibilityConstant = 5;

type Operation = "get" | "set" | "delete";

export const secureStore = {
	items: new Map<string, string>(),
	/** Keys Android can no longer decrypt: reading one throws `ERR_DECRYPT`. */
	undecryptable: new Set<string>(),
	/** Makes every read throw, as a locked iOS keychain does. */
	locked: false,
	/** Makes an operation on a key throw. */
	fails: (() => false) as (operation: Operation, key: string) => boolean,
	/** The options passed to each call. */
	options: [] as SecureStoreOptions[],
	reset() {
		this.items.clear();
		this.undecryptable.clear();
		this.locked = false;
		this.fails = () => false;
		this.options = [];
	},
};

const codedError = (code: string, message: string) =>
	Object.assign(new Error(message), { code });

function check(operation: Operation, key: string, options: SecureStoreOptions) {
	secureStore.options.push(options);
	if (typeof key !== "string" || !/^[\w.-]+$/.test(key)) {
		throw new Error(
			'Invalid key provided to SecureStore. Keys must not be empty and contain only alphanumeric characters, ".", "-", and "_".',
		);
	}
	if (secureStore.fails(operation, key))
		throw codedError("ERR_KEY_CHAIN", `Could not ${operation} ${key}`);
}

/**
 * With `pnpm run test:async`, writes settle a few microtasks late and
 * deletes later still, so work that doesn't wait for each one finishes out
 * of order.
 */
async function settle(ticks: number) {
	if (process.env.SESSION_KIT_TEST_STORAGE !== "async") return;
	for (let tick = 0; tick < ticks; tick++) await Promise.resolve();
}

export function getItem(
	key: string,
	options: SecureStoreOptions = {},
): string | null {
	check("get", key, options);
	if (secureStore.locked)
		throw codedError("ERR_KEY_CHAIN", "User interaction is not allowed");
	if (secureStore.undecryptable.has(key))
		throw codedError("ERR_DECRYPT", `Could not decrypt the value for ${key}`);
	return secureStore.items.get(key) ?? null;
}

export async function setItemAsync(
	key: string,
	value: string,
	options: SecureStoreOptions = {},
): Promise<void> {
	await settle(2);
	check("set", key, options);
	if (Buffer.byteLength(value) > 2048)
		throw new Error(`Value for ${key} is over 2048 bytes`);
	secureStore.items.set(key, value);
	secureStore.undecryptable.delete(key);
}

export async function deleteItemAsync(
	key: string,
	options: SecureStoreOptions = {},
): Promise<void> {
	await settle(3);
	check("delete", key, options);
	secureStore.items.delete(key);
	secureStore.undecryptable.delete(key);
}
