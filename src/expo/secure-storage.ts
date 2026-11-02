import { File, Paths } from "expo-file-system/next";
import {
	deleteItemAsync,
	getItem,
	setItemAsync,
	type KeychainAccessibilityConstant,
	type SecureStoreOptions,
} from "expo-secure-store";

import type { AuthStorage } from "../core/storage.js";

export type SecureStorageOptions = {
	/**
	 * When iOS lets the app read the session: one of SecureStore's constants,
	 * such as `AFTER_FIRST_UNLOCK`. Passed to SecureStore unchanged, whose
	 * default is `WHEN_UNLOCKED`. An app that refreshes in a background task
	 * before the device's first unlock needs `AFTER_FIRST_UNLOCK`. While the
	 * keychain can't be read, the session is `unavailable`; it is never signed
	 * out for that.
	 */
	keychainAccessible?: KeychainAccessibilityConstant;
	/**
	 * iOS keeps keychain items after the app is deleted. By default, a session
	 * an earlier install left there is removed before it is read, so a
	 * reinstalled app starts signed out. `false` restores it instead.
	 * Default: `true`.
	 */
	clearOnReinstall?: boolean;
};

/** SecureStore may reject values longer than this, in UTF-8 bytes. */
const MAX_BYTES = 2048;
/** The most keys one value may span, which bounds it at 128 KB. */
const MAX_CHUNKS = 64;

type Slot = "a" | "b";
type Layout = { slot: Slot; count: number };

/**
 * A SecureStore key for `key`. SecureStore accepts only letters, digits, `.`,
 * `-`, and `_`, and auth's keys contain colons. Every other character becomes
 * `_` and its UTF-8 bytes in hex, `my-app:auth:session` becomes
 * `my-app_3Aauth_3Asession`, and `.` stays free to mark chunk keys.
 */
function encodeKey(key: string): string {
	return encodeURIComponent(key)
		.replace(
			/[_.!~*'()]/g,
			(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
		)
		.replace(/%/g, "_");
}

const chunkKey = (base: string, slot: Slot, index: number) =>
	`${base}.${slot}${index}`;

function utf8Length(text: string): number {
	let bytes = 0;
	for (const char of text) {
		const code = char.codePointAt(0)!;
		bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
	}
	return bytes;
}

/** Splits `value` into pieces of at most `MAX_BYTES`, never inside a character. */
function split(value: string): string[] {
	const chunks: string[] = [];
	let chunk = "";
	let bytes = 0;
	for (const char of value) {
		const size = utf8Length(char);
		if (bytes + size > MAX_BYTES) {
			chunks.push(chunk);
			chunk = "";
			bytes = 0;
		}
		chunk += char;
		bytes += size;
	}
	if (chunk) chunks.push(chunk);
	return chunks;
}

/**
 * Android can't decrypt SecureStore data whose key it no longer has, such as
 * data Auto Backup restored onto another device. SecureStore deletes some of
 * it and reads `null`; for the rest it throws `ERR_DECRYPT`.
 */
const undecryptable = (error: unknown) =>
	typeof error === "object" &&
	error !== null &&
	"code" in error &&
	error.code === "ERR_DECRYPT";

/**
 * Saves the session with `expo-secure-store`: in the iOS keychain, and
 * encrypted with an Android Keystore key. For Expo apps on iOS and Android.
 *
 * - Values longer than SecureStore's 2048-byte limit are split across keys.
 *   The value is replaced only once every piece of the new one is written, so
 *   a write cut short, for example when the app is killed, keeps the previous
 *   value whole.
 * - Reads are synchronous, so with a synchronous user schema the session is
 *   restored before the first render. Writes and removals are asynchronous.
 * - A session left in the keychain by an earlier install is removed unless
 *   `clearOnReinstall` is `false`. A marker file in the app's documents
 *   directory, which deleting the app removes, tells installs apart.
 * - Data that can't be decrypted, as after Android restores a backup onto
 *   another device, reads as signed out and is removed. Other read failures,
 *   such as a locked iOS keychain, make the session `unavailable`.
 *
 * There is one JavaScript context in an app, so it has no `subscribe` or
 * `lock`.
 */
export function secureStorage(options: SecureStorageOptions = {}): AuthStorage {
	const clearOnReinstall = options.clearOnReinstall ?? true;
	const store: SecureStoreOptions =
		options.keychainAccessible === undefined
			? {}
			: { keychainAccessible: options.keychainAccessible };

	// Auth runs storage operations one at a time, in order, and waits for a
	// read that returns a promise. So cleanup this adapter needs is returned
	// from the operation that finds it, never left running beside the next.

	/** An item, `null` when absent, or `undefined` when it can't be decrypted. */
	function readItem(key: string): string | null | undefined {
		try {
			return getItem(key, store);
		} catch (error) {
			if (undecryptable(error)) return undefined;
			throw error;
		}
	}

	/**
	 * The head entry under `base` holds either `0:` and the whole value, or
	 * `1:<slot>:<count>` when the value is split across `count` chunk keys of
	 * that slot. Anything else isn't this adapter's format.
	 */
	function layoutOf(head: string | null | undefined): Layout | undefined {
		const match = head?.match(/^1:([ab]):([1-9][0-9]?)$/);
		const count = Number(match?.[2]);
		return match && count <= MAX_CHUNKS
			? { slot: match[1] as Slot, count }
			: undefined;
	}

	/**
	 * Removes chunks of `slot` from `from` on. A slot's chunks are written
	 * first to last and removed last to first, so the ones present always
	 * start at index 0 with no gap, and whatever a write or removal cut short
	 * left behind, the scan up to the first missing one finds.
	 */
	async function removeChunks(base: string, slot: Slot, from: number) {
		let end = from;
		while (end < MAX_CHUNKS && readItem(chunkKey(base, slot, end)) !== null)
			end++;
		for (let index = end - 1; index >= from; index--)
			await deleteItemAsync(chunkKey(base, slot, index), store);
	}

	/** Chunks first, so a removal cut short leaves no head pointing at them. */
	async function removeAll(base: string) {
		await removeChunks(base, "a", 0);
		await removeChunks(base, "b", 0);
		await deleteItemAsync(base, store);
	}

	/**
	 * Reads as signed out once the unreadable value is removed. A failed
	 * removal reads as signed out too: the next write replaces what is left.
	 */
	function discard(base: string): Promise<null> {
		return removeAll(base).then(
			() => null,
			() => null,
		);
	}

	function readValue(base: string): string | null | Promise<null> {
		const head = readItem(base);
		if (head === undefined) return discard(base);
		if (head === null) return null;
		if (head.startsWith("0:")) return head.slice(2);
		const layout = layoutOf(head);
		// Not this adapter's format: auth rejects it and removes it.
		if (!layout) return head;
		let value = "";
		for (let index = 0; index < layout.count; index++) {
			const chunk = readItem(chunkKey(base, layout.slot, index));
			if (chunk == null) return discard(base);
			value += chunk;
		}
		return value;
	}

	async function writeValue(base: string, value: string) {
		const previous = layoutOf(readItem(base));
		if (utf8Length(value) + 2 <= MAX_BYTES) {
			await setItemAsync(base, `0:${value}`, store);
		} else {
			const chunks = split(value);
			if (chunks.length > MAX_CHUNKS) {
				throw new Error(
					`secureStorage cannot save more than ${MAX_CHUNKS * MAX_BYTES} bytes`,
				);
			}
			// The slot the saved value doesn't use, so it stays whole until the
			// head points at the new one.
			const slot: Slot = previous?.slot === "a" ? "b" : "a";
			for (const [index, chunk] of chunks.entries())
				await setItemAsync(chunkKey(base, slot, index), chunk, store);
			// Leftovers from a longer write that was cut short.
			await removeChunks(base, slot, chunks.length);
			await setItemAsync(base, `1:${slot}:${chunks.length}`, store);
		}
		// The previous chunks are unreachable now. Failing to remove them
		// doesn't undo the write, and the next write to that slot replaces them.
		if (previous) await removeChunks(base, previous.slot, 0).catch(() => {});
	}

	// Keys checked for a session left by an earlier install. A failed check
	// is tried again by the next operation.
	const checked = new Set<string>();

	/**
	 * Resolves once `base` holds nothing an earlier install left, or
	 * `undefined` when that is already known.
	 */
	function ready(base: string): Promise<void> | undefined {
		if (!clearOnReinstall || checked.has(base)) return undefined;
		const marker = new File(Paths.document, `.session-kit-${base}`);
		if (marker.exists) {
			checked.add(base);
			return undefined;
		}
		// The marker is created only after the removal, so an install cut short
		// before then removes again on the next launch.
		return removeAll(base).then(() => {
			if (!marker.exists) marker.create();
			checked.add(base);
		});
	}

	return {
		get(key) {
			const base = encodeKey(key);
			const check = ready(base);
			return check ? check.then(() => readValue(base)) : readValue(base);
		},
		async set(key, value) {
			const base = encodeKey(key);
			await ready(base);
			await writeValue(base, value);
		},
		async remove(key) {
			const base = encodeKey(key);
			await ready(base);
			await removeAll(base);
		},
	};
}
