import { Link } from "@tanstack/react-router";

import { gitConfig } from "@/lib/shared";

import { COLUMN, SectionHead } from "./buffer";

// Each setup with the entry point it imports, its guide and its example app.
const SETUPS = [
	[
		"TanStack Router",
		"tanstack-router",
		"Guards in beforeLoad, with the session in route context.",
		"setups/tanstack-router",
		"tanstack-router",
	],
	[
		"TanStack Start",
		"tanstack-start",
		"Server rendering, with the session in an encrypted cookie.",
		"setups/tanstack-start",
		"tanstack-start-ssr",
	],
	[
		"React Router",
		"react-router",
		"Declarative and data mode, and framework mode as a SPA.",
		"setups/react-router",
		"react-router-declarative",
	],
	[
		"React Router SSR",
		"react-router/server",
		"Framework mode with server rendering, the session on the server.",
		"setups/react-router-ssr",
		"react-router-framework-ssr",
	],
	[
		"Next.js",
		"next",
		"The App Router, with a Proxy that refreshes ahead of pages.",
		"setups/next",
		"next-app",
	],
	[
		"Expo Router",
		"expo",
		"Secure storage, a splash screen held while restoring, and deep links.",
		"setups/expo",
		"expo-router",
	],
	[
		"Effect",
		"effect",
		"The session as a service, and an effetch plugin.",
		"effect",
		"tanstack-start-spa-effetch",
	],
] as const;

const EXAMPLES = `https://github.com/${gitConfig.user}/${gitConfig.repo}/tree/${gitConfig.branch}/examples`;

export function Setups() {
	return (
		<section className={`${COLUMN} pt-20 sm:pt-28`}>
			<SectionHead title="One client, wherever your app runs">
				Each setup has its own entry point, a guide and a runnable example
				app.
			</SectionHead>
			<ul className="mt-8 border-t border-buffer-line">
				{SETUPS.map(([title, entry, description, page, example]) => (
					// The whole row opens the guide: its link's hit area stretches
					// over the row, and the example link sits above it.
					<li
						key={title}
						className="group relative grid gap-x-6 gap-y-1 border-b border-buffer-line py-4 transition-colors hover:bg-fd-accent/30 sm:grid-cols-[11rem_1fr_auto] sm:items-baseline sm:px-2"
					>
						<Link
							to="/docs/$"
							params={{ _splat: page }}
							className="font-semibold after:absolute after:inset-0"
						>
							{title}
						</Link>
						<code className="text-xs text-buffer-blue [overflow-wrap:anywhere] sm:text-sm">
							"@monarcode/session-kit/{entry}"
						</code>
						<span className="text-sm text-pretty text-fd-muted-foreground sm:col-start-2 sm:row-start-2">
							<span aria-hidden="true" className="text-buffer-dim">
								{"// "}
							</span>
							{description}
						</span>
						<span className="flex gap-x-5 text-sm text-buffer-dim">
							<span
								aria-hidden="true"
								className="underline-offset-4 transition-colors group-hover:text-fd-foreground group-hover:underline group-has-[[data-example]:hover]:text-buffer-dim group-has-[[data-example]:hover]:no-underline"
							>
								guide
							</span>
							<a
								data-example
								href={`${EXAMPLES}/${example}`}
								aria-label={`${title} example app`}
								// Above the row's link, with a hit area a thumb can find.
								className="relative z-10 underline-offset-4 transition-colors after:absolute after:inset-[-0.75rem] hover:text-fd-foreground hover:underline"
							>
								example
							</a>
						</span>
					</li>
				))}
			</ul>
		</section>
	);
}
