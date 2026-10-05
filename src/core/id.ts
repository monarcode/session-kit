/**
 * A random session ID. It only tells sign-ins apart locally and is not a
 * secret, so it falls back to weaker randomness where Web Crypto is missing,
 * as in React Native.
 */
export function createId(): string {
	const crypto = globalThis.crypto;
	if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
	const bytes = new Uint8Array(16);
	if (typeof crypto?.getRandomValues === "function")
		crypto.getRandomValues(bytes);
	else
		for (let index = 0; index < bytes.length; index++)
			bytes[index] = Math.floor(Math.random() * 256);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}
