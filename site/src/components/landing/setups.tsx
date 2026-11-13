import { Link } from "@tanstack/react-router";

import { COLUMN, SectionHead } from "./buffer";

// Each setup with the entry point it imports and its guide.
const SETUPS = [
	[
		"TanStack Router",
		"tanstack-router",
		"Guards in beforeLoad, with the session in route context.",
		"setups/tanstack-router",
	],
	[
		"TanStack Start",
		"tanstack-start",
		"Server rendering, with the session in an encrypted cookie.",
		"setups/tanstack-start",
	],
	[
		"React Router",
		"react-router",
		"Declarative and data mode, and framework mode as a SPA.",
		"setups/react-router",
	],
	[
		"React Router SSR",
		"react-router/server",
		"Framework mode with server rendering, the session on the server.",
		"setups/react-router-ssr",
	],
	[
		"Next.js",
		"next",
		"The App Router, with a Proxy that refreshes ahead of pages.",
		"setups/next",
	],
	[
		"Expo Router",
		"expo",
		"Secure storage, a splash screen held while restoring, and deep links.",
		"setups/expo",
	],
	[
		"Effect",
		"effect",
		"The session as a service, and an effetch plugin.",
		"effect",
	],
] as const;

export function Setups() {
	return (
		<section className={`${COLUMN} pt-20 sm:pt-28`}>
			<SectionHead title="One client, wherever your app runs">
				Each setup has its own entry point, a guide and a runnable example
				app.
			</SectionHead>
			<ul className="mt-8 border-t border-buffer-line">
				{SETUPS.map(([title, entry, description, page]) => (
					<li key={title} className="border-b border-buffer-line">
						<Link
							to="/docs/$"
							params={{ _splat: page }}
							className="group grid gap-x-6 gap-y-1 py-4 transition-colors hover:bg-fd-accent/30 sm:grid-cols-[11rem_minmax(0,25rem)_1fr_auto] sm:items-baseline sm:px-2"
						>
							<span className="font-semibold">{title}</span>
							<code className="text-xs text-buffer-blue [overflow-wrap:anywhere] sm:text-sm">
								"@monarcode/session-kit/{entry}"
							</code>
							<span className="text-sm text-pretty text-fd-muted-foreground">
								<span aria-hidden="true" className="text-buffer-dim">
									{"// "}
								</span>
								{description}
							</span>
							<span
								aria-hidden="true"
								className="text-sm text-buffer-dim underline-offset-4 transition-colors group-hover:text-fd-foreground group-hover:underline max-sm:hidden"
							>
								guide
							</span>
						</Link>
					</li>
				))}
			</ul>
		</section>
	);
}
