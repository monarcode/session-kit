import { AuthError } from "../core/errors.js";
import { isRecord } from "../core/json.js";
import type { AuthStorage } from "../core/storage.js";
import type { Sealer } from "./seal.js";

/**
 * Attributes of the session cookie, as {@link CookieJar} receives them. Every
 * framework's cookie API accepts this shape, or maps from it in a line.
 *
 * @example
 * ```ts
 * import type { CookieOptions } from "@monarcode/session-kit/server";
 *
 * export const toHeader = (name: string, value: string, options: CookieOptions) =>
 * 	[
 * 		`${name}=${value}`,
 * 		`Path=${options.path}`,
 * 		`SameSite=${options.sameSite}`,
 * 		...(options.maxAge === undefined ? [] : [`Max-Age=${options.maxAge}`]),
 * 		...(options.domain ? [`Domain=${options.domain}`] : []),
 * 		...(options.secure ? ["Secure"] : []),
 * 		"HttpOnly",
 * 	].join("; ");
 * ```
 *
 * @since 0.1.0
 */
export type CookieOptions = Readonly<{
	/** Always `true`: page scripts can't read the session cookie. */
	httpOnly: true;
	/** Whether the cookie is sent over HTTPS only. */
	secure: boolean;
	/** Which cross-site requests carry the cookie. */
	sameSite: "lax" | "strict" | "none";
	/** The paths that receive the cookie. */
	path: string;
	/** The domain that receives the cookie; absent for this host only. */
	domain?: string | undefined;
	/** Lifetime in seconds. Absent when deleting. */
	maxAge?: number | undefined;
}>;

/**
 * Reads and writes the request's cookies, for `createServerAuth`'s methods.
 * Each framework adapter builds one; for anything else, wrap the request's
 * cookies and the response's `Set-Cookie` yourself. Pass the same jar to every
 * call while handling one request, so they share one refresh and see each
 * other's writes. Make a new one for each request, and never keep one at
 * module level: calls with the same jar share what it read, so a reused jar
 * would show one request's session to the next.
 *
 * @example
 * ```ts
 * import type { CookieJar } from "@monarcode/session-kit/server";
 *
 * declare const requestCookies: Map<string, string>;
 * declare function setCookie(name: string, value: string, maxAge?: number): void;
 *
 * export const jar: CookieJar = {
 * 	writable: true,
 * 	get: (name) => requestCookies.get(name),
 * 	set: (name, value, options) => setCookie(name, value, options.maxAge),
 * 	delete: (name) => setCookie(name, "", 0),
 * };
 * ```
 *
 * @since 0.1.0
 */
export type CookieJar = {
	/** The request's cookie `name`, or `undefined` when it has none. */
	get: (name: string) => string | undefined;
	/** Sets cookie `name` on the response. */
	set: (name: string, value: string, options: CookieOptions) => void;
	/** Removes cookie `name`, with the attributes it was set with. */
	delete: (name: string, options: CookieOptions) => void;
	/**
	 * Whether the response can still set cookies. `false` where the framework
	 * can't, such as while a Next.js server component renders: then nothing is
	 * refreshed or saved, and methods that must save reject.
	 */
	readonly writable: boolean;
};

/** Cookie values stay below browsers' 4 KB limit, with room for attributes. */
const CHUNK_SIZE = 3800;
/** A head naming its chunks: `c` and their count. Sealed values start with a digit. */
const CHUNKED = /^c([1-9])$/;
/**
 * Servers refuse requests whose headers are too large (Node: 16 KB in all),
 * so a session that needs more is refused at sign-in rather than sent.
 */
const MAX_CHUNKS = 3;
/** How long a refresh's result serves requests that still carry the old cookie. */
const REUSE_MS = 10_000;
const MAX_REUSED = 10_000;

/** What a saved entry says about itself, read without validating it. */
function identify(
	text: string | null,
): { id: string; accessToken: string } | null {
	if (!text) return null;
	try {
		const value: unknown = JSON.parse(text);
		return isRecord(value) &&
			typeof value.id === "string" &&
			typeof value.accessToken === "string"
			? { id: value.id, accessToken: value.accessToken }
			: null;
	} catch {
		return null;
	}
}

type Reused = { text: string | null; until: number };

/**
 * What one server auth shares across the requests it handles: a lock per
 * session, so one request at a time spends its refresh token, and each
 * session's latest saves, so requests that carry an outdated cookie use what
 * another request saved instead of refreshing again.
 */
export function createShared() {
	const locks = new Map<string, Promise<unknown>>();
	// Keyed by session ID and the access token a save replaced.
	const saves = new Map<string, Reused>();
	const keyOf = (id: string, accessToken: string) => `${id}\n${accessToken}`;

	function prune(now: number) {
		for (const [key, entry] of saves) {
			if (entry.until > now && saves.size <= MAX_REUSED) break;
			saves.delete(key);
		}
	}

	return {
		/** Records that the session saved as `previous` is now `text`, or ended when `null`. */
		saved(
			previous: { id: string; accessToken: string },
			text: string | null,
		) {
			const now = Date.now();
			const key = keyOf(previous.id, previous.accessToken);
			saves.delete(key);
			saves.set(key, { text, until: now + REUSE_MS });
			prune(now);
		},
		/** The newest save that follows `text`, or `text` itself. */
		latest(text: string | null): string | null {
			let current = identify(text);
			const now = Date.now();
			// A chain of saves: a refresh, then a profile update, then another refresh.
			for (let step = 0; current && step < 10; step++) {
				const entry = saves.get(keyOf(current.id, current.accessToken));
				if (!entry || entry.until <= now || entry.text === text) break;
				text = entry.text;
				const next = identify(text);
				if (next?.accessToken === current.accessToken) break;
				current = next;
			}
			return text;
		},
		/** Runs `work` after earlier work for session `id` settles. */
		async exclusive<T>(
			id: string,
			signal: AbortSignal,
			work: () => Promise<T>,
		): Promise<T> {
			const previous = locks.get(id) ?? Promise.resolve();
			let release!: () => void;
			const held = new Promise<void>((resolve) => (release = resolve));
			const tail = previous.then(() => held);
			locks.set(id, tail);
			try {
				await new Promise<void>((resolve, reject) => {
					const abort = () => reject(signal.reason);
					if (signal.aborted) return abort();
					signal.addEventListener("abort", abort, { once: true });
					void previous.then(() => {
						signal.removeEventListener("abort", abort);
						resolve();
					});
				});
				return await work();
			} finally {
				release();
				if (locks.get(id) === tail) locks.delete(id);
			}
		},
	};
}

export type Shared = ReturnType<typeof createShared>;

/**
 * The session cookie of one request as auth storage: the engine reads and
 * writes it like any saved session. Values are sealed, and split across
 * `<cookie>.0…n` when too large for one cookie.
 */
export function jarStorage(input: {
	jar: CookieJar;
	cookie: string;
	options: Omit<CookieOptions, "maxAge">;
	sealer: Sealer;
	shared: Shared;
}): AuthStorage {
	const { jar, cookie, options, sealer, shared } = input;
	// What this request holds: read once, then kept as it writes.
	let loaded: Promise<string | null> | undefined;
	let text: string | null = null;
	// The chunks the browser holds, to delete those a shorter value leaves.
	let chunks = 0;
	// The session this request read, whose lock and saves it uses.
	let session: { id: string; accessToken: string } | null = null;

	function chunkName(index: number) {
		return `${cookie}.${index}`;
	}

	async function readCookie(): Promise<string | null> {
		const head = jar.get(cookie);
		if (!head) return null;
		const count = CHUNKED.exec(head)?.[1];
		let sealed: string | null = head;
		if (count) {
			chunks = Number(count);
			const parts = Array.from({ length: chunks }, (_, index) =>
				jar.get(chunkName(index)),
			);
			sealed = parts.every(Boolean) ? parts.join("") : null;
		}
		const opened = sealed && (await sealer.open(sealed, cookie));
		// Sealed with a retired secret, cut short, or tampered with: signed out.
		if (!opened && jar.writable) write(null, 0);
		return opened || null;
	}

	function remember(next: string | null) {
		text = next;
		session = identify(next) ?? session;
	}

	function write(sealed: string | null, maxAge: number) {
		if (!jar.writable)
			throw new AuthError(
				"INVALID_OPTIONS",
				"This cookie jar can't set cookies, so the session can't be saved here",
			);
		const parts: string[] = [];
		if (sealed !== null && sealed.length > CHUNK_SIZE) {
			for (let start = 0; start < sealed.length; start += CHUNK_SIZE)
				parts.push(sealed.slice(start, start + CHUNK_SIZE));
			if (parts.length > MAX_CHUNKS)
				throw new AuthError(
					"PERSISTENCE_FAILED",
					"The session is too large for cookies",
				);
		}
		parts.forEach((part, index) =>
			jar.set(chunkName(index), part, { ...options, maxAge }),
		);
		for (let index = parts.length; index < chunks; index++)
			jar.delete(chunkName(index), options);
		chunks = parts.length;
		if (sealed === null) jar.delete(cookie, options);
		else
			jar.set(cookie, parts.length ? `c${parts.length}` : sealed, {
				...options,
				maxAge,
			});
	}

	async function load(): Promise<string | null> {
		loaded ??= readCookie().then(
			(value) => {
				remember(value);
				return value;
			},
			(cause: unknown) => {
				// Read again next time: the failure may pass.
				loaded = undefined;
				throw cause;
			},
		);
		await loaded;
		// Another request may have saved this session since.
		const latest = shared.latest(text);
		if (latest !== text) {
			remember(latest);
			if (jar.writable) {
				if (latest === null) write(null, 0);
				else write(await sealer.seal(latest, cookie), maxAgeOf(latest));
			}
		}
		return text;
	}

	return {
		get: load,
		async set(_key, value, meta) {
			await load();
			const previous = identify(text);
			const sealed = await sealer.seal(value, cookie);
			write(
				sealed,
				Math.max(0, Math.ceil((meta.expiresAt - Date.now()) / 1000)),
			);
			remember(value);
			const next = identify(value);
			if (previous && next?.id === previous.id)
				shared.saved(previous, value);
		},
		async remove() {
			await load();
			const previous = identify(text);
			// Nothing to delete, or a read-only jar: the next writable request deletes it.
			if (jar.writable && (jar.get(cookie) !== undefined || text !== null))
				write(null, 0);
			remember(null);
			if (previous) shared.saved(previous, null);
		},
		lock: (_name, signal, work) =>
			session ? shared.exclusive(session.id, signal, work) : work(),
	};
}

/** The cookie lifetime for `text`, a saved entry, from its `persistUntil`. */
function maxAgeOf(text: string): number {
	const saved: unknown = JSON.parse(text);
	const until = isRecord(saved) ? saved.persistUntil : undefined;
	return typeof until === "number"
		? Math.max(0, Math.ceil((until - Date.now()) / 1000))
		: 0;
}
