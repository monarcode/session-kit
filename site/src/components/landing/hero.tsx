import { Link } from "@tanstack/react-router";

import { gitConfig } from "@/lib/shared";
import type { ConfigLine } from "@/lib/tour";

import { COLUMN } from "./buffer";
import { Install } from "./install";
import { LiveConfig } from "./live-config";

/**
 * The opening: the pitch and install row as comments at the column's edge,
 * then the live config, the first numbered lines of the buffer.
 */
export function Hero({
	version,
	config,
}: {
	version: string;
	config: ConfigLine[];
}) {
	return (
		<section className={`${COLUMN} pt-8 pb-4 sm:pt-10`}>
			<h1 className="text-[clamp(1.5rem,3.6vw,2.75rem)] leading-[1.12] tracking-[-0.04em]">
				<span className="block">
					<span className="font-light text-fd-muted-foreground">
						<span aria-hidden="true" className="text-buffer-dim">
							{"// "}
						</span>
						Your backend signs users in.{" "}
					</span>
				</span>
				<span className="block">
					<span className="font-bold">
						<span
							aria-hidden="true"
							className="font-light text-buffer-dim"
						>
							{"// "}
						</span>
						Session kit handles everything after.
					</span>
				</span>
			</h1>

			<div className="mt-3 sm:mt-4">
				<p className="max-w-[72ch] text-sm leading-relaxed text-pretty text-fd-muted-foreground sm:text-base sm:leading-[1.75]">
					<span aria-hidden="true" className="text-buffer-dim">
						{"// "}
					</span>
					Hand it the tokens your sign-in endpoint returns. It saves,
					restores and refreshes the session, keeps tabs in step, and
					guards your routes.
				</p>
			</div>

			{/* Three groups, set apart by space: the pitch, what to do next, and
			    the demo. */}
			<div className="mt-5 sm:mt-6">
				<div className="flex min-w-0 flex-wrap items-end gap-3">
					<div className="w-full max-w-md">
						<Install />
					</div>
					<Link
						to="/docs/$"
						params={{ _splat: "getting-started" }}
						className="flex h-12 items-center px-6 text-sm font-bold text-fd-primary-foreground bg-fd-primary decoration-2 underline-offset-4 hover:underline"
					>
						Get started
					</Link>
					<a
						href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}
						className="flex h-12 items-center border border-buffer-line px-5 text-sm transition-colors hover:bg-fd-accent"
					>
						GitHub
					</a>
					<a
						href={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/main/CHANGELOG.md`}
						className="flex h-12 items-center px-1 text-xs text-buffer-dim transition-colors hover:text-fd-foreground max-sm:hidden"
					>
						v{version}
					</a>
				</div>
			</div>

			<LiveConfig lines={config} start={1} />
		</section>
	);
}
