/**
 * Where a build is served. Plain values with no build globals, so
 * `vite.config.ts` can import them.
 */

/** The live site. */
export const PRODUCTION_URL = "https://session-kit.monarcode.dev";

/**
 * Where this build is served: the live site, or, on a Cloudflare Pages
 * preview (`main` and pull requests), the deployment's own address
 * (`CF_PAGES_URL`, not the branch's alias), which keeps serving this build,
 * so its links and Markdown stay on the same docs. Cloudflare deploys the
 * `site` branch as the live site, and a build outside Cloudflare is for it
 * too.
 */
export function siteUrl(env: Record<string, string | undefined>): string {
	const preview = env.CF_PAGES_BRANCH && env.CF_PAGES_BRANCH !== "site";
	// Full URLs are built as `SITE_URL + path`, so no trailing slash.
	return ((preview && env.CF_PAGES_URL) || PRODUCTION_URL).replace(/\/$/, "");
}
