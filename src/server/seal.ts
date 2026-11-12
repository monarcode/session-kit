import { AuthError } from "../core/errors.js";

/**
 * The shortest secret accepted: 32 characters, the AES-256 key size in bytes.
 */
const MIN_SECRET_LENGTH = 32;
/** Marks the format, so a later one can be told apart. */
const VERSION = "1.";
const IV_BYTES = 12;

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
	const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
	return Uint8Array.from(
		atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
		(c) => c.charCodeAt(0),
	);
}

/**
 * Checks the `secret` option, returning the secrets in order: the first seals.
 */
export function readSecrets(secret: unknown): readonly string[] {
	const secrets = typeof secret === "string" ? [secret] : secret;
	if (
		!Array.isArray(secrets) ||
		secrets.length === 0 ||
		!secrets.every(
			(value) =>
				typeof value === "string" && value.length >= MIN_SECRET_LENGTH,
		)
	) {
		throw new AuthError(
			"INVALID_OPTIONS",
			`Pass secret as a string of at least ${MIN_SECRET_LENGTH} characters, or a list of them`,
		);
	}
	return Object.freeze([...secrets]);
}

export type Sealer = {
	/** Encrypts `plain`, bound to `context`. */
	seal: (plain: string, context: string) => Promise<string>;
	/** Decrypts with any secret, or resolves `null` when none opens it. */
	open: (sealed: string, context: string) => Promise<string | null>;
};

/**
 * AES-256-GCM through Web Crypto, with a key derived by HKDF-SHA-256 from
 * each secret. `context`, such as the cookie name, is authenticated with the
 * value, so a value moved to another cookie doesn't open.
 */
export function createSealer(secrets: readonly string[], name: string): Sealer {
	let keys: Promise<CryptoKey[]> | undefined;
	const derive = () =>
		(keys ??= Promise.all(
			secrets.map(async (secret) => {
				const subtle = globalThis.crypto?.subtle;
				if (!subtle)
					throw new AuthError(
						"INVALID_OPTIONS",
						"Sealing the session cookie needs Web Crypto (crypto.subtle)",
					);
				const material = await subtle.importKey(
					"raw",
					encoder.encode(secret),
					"HKDF",
					false,
					["deriveKey"],
				);
				return subtle.deriveKey(
					{
						name: "HKDF",
						hash: "SHA-256",
						// Changing the salt or info changes every key, which signs
						// everyone out.
						salt: encoder.encode("session-kit"),
						info: encoder.encode(`session-kit:${name}:cookie`),
					},
					material,
					{ name: "AES-GCM", length: 256 },
					false,
					["encrypt", "decrypt"],
				);
			}),
		).catch((cause: unknown) => {
			// Derive again next time: the failure may pass.
			keys = undefined;
			throw cause;
		}));

	return {
		async seal(plain, context) {
			const [key] = await derive();
			const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
			const ciphertext = new Uint8Array(
				await globalThis.crypto.subtle.encrypt(
					{ name: "AES-GCM", iv, additionalData: encoder.encode(context) },
					key!,
					encoder.encode(plain),
				),
			);
			const sealed = new Uint8Array(IV_BYTES + ciphertext.length);
			sealed.set(iv);
			sealed.set(ciphertext, IV_BYTES);
			return VERSION + toBase64Url(sealed);
		},
		async open(sealed, context) {
			if (!sealed.startsWith(VERSION)) return null;
			let bytes: Uint8Array;
			try {
				bytes = fromBase64Url(sealed.slice(VERSION.length));
			} catch {
				return null;
			}
			if (bytes.length <= IV_BYTES) return null;
			const iv = bytes.slice(0, IV_BYTES);
			const ciphertext = bytes.slice(IV_BYTES);
			for (const key of await derive()) {
				try {
					const plain = await globalThis.crypto.subtle.decrypt(
						{
							name: "AES-GCM",
							iv,
							additionalData: encoder.encode(context),
						},
						key,
						ciphertext,
					);
					// `fatal` rejects broken UTF-8 rather than replacing it.
					return new TextDecoder("utf-8", { fatal: true }).decode(plain);
				} catch {
					// Sealed with another secret, or tampered with: try the next.
				}
			}
			return null;
		},
	};
}
