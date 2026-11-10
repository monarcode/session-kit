import { AuthError } from "../core/errors.js";
import { savedIdentity } from "../core/persistence.js";
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
	 * can't, such as while a Next.js Server Component renders: then nothing is
	 * refreshed or saved. Calls that need a fresh token reject with
	 * `REFRESH_FAILED`: `credentials.get` with expired access, and
	 * `credentials.renew`. Calls that must change the cookie reject with
	 * `INVALID_OPTIONS`: `signIn`, `signOut`, `credentials.reject`,
	 * `updateUser` and `refreshIfDue`.
	 */
	readonly writable: boolean;
};

/** Cookie values stay below browsers' 4 KB limit, with room for attributes. */
const CHUNK_SIZE = 3800;
/** A head naming its chunks: `c` and their count. Sealed values start with a digit. */
const CHUNKED = /^c([1-9])$/;
/**
 * Servers and proxies refuse requests whose headers are too large (nginx:
 * 8 KB for the `Cookie` line), and keep refusing until the cookie is gone, so
 * a session that needs more is refused at sign-in rather than sent.
 */
const MAX_CHUNKS = 2;
/** How long a refresh's result serves requests that still carry the old cookie. */
const REUSE_MS = 10_000;
const MAX_REUSED = 10_000;
/** The most saves followed from one cookie: a refresh, a profile update, another refresh. */
const MAX_FOLLOWED = 10;

/** A session's saved entry and when it expires; `text` is `null` once it ended. */
type Save = { text: string | null; expiresAt: number };
type Reused = Save & { until: number };

// Refreshes under way on each jar, which an adapter waits for before its jar
// stops setting cookies.
const refreshing = new WeakMap<CookieJar, Set<Promise<unknown>>>();

// Read-only jars over the same cookies as a writable one, as Next's two jars
// for one store: reads follow the writable jar's session, so a sign-in there
// shows here.
const writableSiblings = new WeakMap<CookieJar, CookieJar>();

/** Records that `readOnly` reads the cookies `writable` writes. */
export function pairJars(readOnly: CookieJar, writable: CookieJar): void {
	writableSiblings.set(readOnly, writable);
}

/** The writable jar over the same cookies as `jar`, if an adapter paired them. */
export function writableSibling(jar: CookieJar): CookieJar | undefined {
	return writableSiblings.get(jar);
}

/** Resolves once no refresh is under way on `jar`, counting those begun meanwhile. */
export async function refreshesSettled(jar: CookieJar): Promise<void> {
	const pending = refreshing.get(jar);
	while (pending?.size) await Promise.allSettled(pending);
}

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

	// Refreshes the backend failed, by the same key: requests waiting on the
	// same token fail with them rather than call the backend again.
	const failures = new Map<string, { error: unknown; until: number }>();

	function prune(now: number) {
		for (const entries of [saves, failures])
			for (const [key, entry] of entries) {
				if (entry.until > now && entries.size <= MAX_REUSED) break;
				entries.delete(key);
			}
	}

	return {
		/** Records that the session saved as `previous` is now `save`. */
		saved(previous: { id: string; accessToken: string }, save: Save) {
			const now = Date.now();
			const key = keyOf(previous.id, previous.accessToken);
			saves.delete(key);
			saves.set(key, { ...save, until: now + REUSE_MS });
			prune(now);
		},
		/** The newest save that follows `text`, or `undefined` when none does. */
		latest(text: string | null): Save | undefined {
			let current = savedIdentity(text);
			let newest: Save | undefined;
			const now = Date.now();
			for (let step = 0; current && step < MAX_FOLLOWED; step++) {
				const entry = saves.get(keyOf(current.id, current.accessToken));
				if (!entry || entry.until <= now || entry.text === text) break;
				newest = { text: entry.text, expiresAt: entry.expiresAt };
				text = entry.text;
				const next = savedIdentity(text);
				if (next?.accessToken === current.accessToken) break;
				current = next;
			}
			return newest;
		},
		/** Records that refreshing the session saved as `previous` failed with `error`. */
		failed(previous: { id: string; accessToken: string }, error: unknown) {
			const now = Date.now();
			const key = keyOf(previous.id, previous.accessToken);
			failures.delete(key);
			failures.set(key, { error, until: now + REUSE_MS });
			prune(now);
		},
		/** The recent failure to refresh the session saved as `previous`, if any. */
		failure(previous: { id: string; accessToken: string }): unknown {
			const entry = failures.get(keyOf(previous.id, previous.accessToken));
			return entry && entry.until > Date.now() ? entry.error : undefined;
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

/** Failures of this server, not the backend's: retrying may work. */
const LOCAL_FAILURES = new Set([
	"SESSION_CHANGED",
	"PERSISTENCE_FAILED",
	"INVALID_OPTIONS",
]);

/** Whether a refresh failed at the backend, and would fail again if retried at once. */
function failedOnTheBackend(error: unknown): boolean {
	return !(error instanceof AuthError && LOCAL_FAILURES.has(error.code));
}

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
		if (!opened && jar.writable) clear();
		return opened || null;
	}

	function remember(next: string | null) {
		text = next;
		session = savedIdentity(next) ?? session;
	}

	/** Deletes the chunks from `count` on, which a shorter value leaves behind. */
	function trim(count: number) {
		for (let index = count; index < chunks; index++)
			jar.delete(chunkName(index), options);
		chunks = count;
	}

	/** Sets the cookie to `sealed`, in chunks if needed, until `expiresAt`. */
	function write(sealed: string, expiresAt: number) {
		if (!jar.writable)
			throw new AuthError(
				"INVALID_OPTIONS",
				"This cookie jar can't set cookies, so the session can't be saved here",
			);
		const parts: string[] = [];
		if (sealed.length > CHUNK_SIZE) {
			for (let start = 0; start < sealed.length; start += CHUNK_SIZE)
				parts.push(sealed.slice(start, start + CHUNK_SIZE));
			if (parts.length > MAX_CHUNKS)
				throw new AuthError(
					"PERSISTENCE_FAILED",
					"The session is too large for cookies",
				);
		}
		const maxAge = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
		parts.forEach((part, index) =>
			jar.set(chunkName(index), part, { ...options, maxAge }),
		);
		trim(parts.length);
		jar.set(cookie, parts.length ? `c${parts.length}` : sealed, {
			...options,
			maxAge,
		});
	}

	/** Deletes the cookie and its chunks. */
	function clear() {
		trim(0);
		jar.delete(cookie, options);
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
		const newer = shared.latest(text);
		if (newer) {
			remember(newer.text);
			if (jar.writable) {
				if (newer.text === null) clear();
				else write(await sealer.seal(newer.text, cookie), newer.expiresAt);
			}
		}
		return text;
	}

	return {
		get: load,
		async set(_key, value, meta) {
			await load();
			const previous = savedIdentity(text);
			write(await sealer.seal(value, cookie), meta.expiresAt);
			remember(value);
			if (previous && savedIdentity(value)?.id === previous.id)
				shared.saved(previous, { text: value, expiresAt: meta.expiresAt });
		},
		async remove() {
			await load();
			const previous = savedIdentity(text);
			const held = text;
			remember(null);
			// A read-only jar keeps the cookie, so other requests mustn't take the
			// session as ended.
			if (!jar.writable) return;
			if (jar.get(cookie) !== undefined || held !== null) clear();
			if (previous) shared.saved(previous, { text: null, expiresAt: 0 });
		},
		lock(_name, signal, work) {
			const run = async () => {
				// The new tokens couldn't be saved, and the backend may have spent the
				// refresh token the cookie holds.
				if (!jar.writable)
					throw new AuthError(
						"REFRESH_FAILED",
						"This cookie jar can't set cookies any more, so the session isn't refreshed here",
					);
				const tried = session;
				const failure = tried && shared.failure(tried);
				if (failure) throw failure;
				try {
					return await work();
				} catch (error) {
					if (tried && failedOnTheBackend(error))
						shared.failed(tried, error);
					throw error;
				}
			};
			const held = session
				? shared.exclusive(session.id, signal, run)
				: run();
			const pending = refreshing.get(jar) ?? new Set();
			refreshing.set(jar, pending);
			pending.add(held);
			const forget = () => pending.delete(held);
			held.then(forget, forget);
			return held;
		},
	};
}
