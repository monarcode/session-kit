import { Link } from "@tanstack/react-router";

import { gitConfig } from "@/lib/shared";

import { COLUMN, PRIMARY_ACTION, SectionHead } from "./buffer";
import { Install } from "./install";

const INLINE_LINK =
	"text-fd-foreground underline decoration-buffer-dim underline-offset-4 transition-colors hover:decoration-fd-foreground";

/**
 * Where the page ends: the hero's actions again, so a visitor who read to the
 * bottom doesn't scroll back for them, under three facts they can check.
 */
export function Closing() {
	return (
		<section className={`${COLUMN} pt-20 sm:pt-28`}>
			<SectionHead title="Add it to your app" />
			<div className="mt-3 max-w-[72ch] text-sm leading-relaxed text-pretty text-fd-muted-foreground sm:text-base sm:leading-[1.75]">
				<p>
					<span aria-hidden="true" className="text-buffer-dim">
						{"// "}
					</span>
					Releases are published from CI with{" "}
					<a
						href="https://www.npmjs.com/package/@monarcode/session-kit#provenance"
						className={INLINE_LINK}
					>
						npm provenance
					</a>
					.
				</p>
				<p>
					<span aria-hidden="true" className="text-buffer-dim">
						{"// "}
					</span>
					Each one passes{" "}
					<a
						href={`https://github.com/${gitConfig.user}/${gitConfig.repo}/tree/${gitConfig.branch}/tests`}
						className={INLINE_LINK}
					>
						the test suite
					</a>{" "}
					twice, with synchronous and with asynchronous storage.
				</p>
				<p>
					<span aria-hidden="true" className="text-buffer-dim">
						{"// "}
					</span>
					<Link
						to="/docs/$"
						params={{ _splat: "faq" }}
						hash="how-much-does-it-add-to-my-bundle"
						className={INLINE_LINK}
					>
						About 11 kB gzipped
					</Link>{" "}
					in a single-page app.
				</p>
			</div>
			<div className="mt-5 flex min-w-0 flex-wrap items-end gap-3 sm:mt-6">
				<div className="w-full max-w-md">
					<Install />
				</div>
				<Link
					to="/docs/$"
					params={{ _splat: "getting-started" }}
					className={PRIMARY_ACTION}
				>
					Get started
				</Link>
			</div>
		</section>
	);
}
