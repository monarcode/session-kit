import { Card, Cards } from "fumadocs-ui/components/card";

const SETUPS = [
	[
		"TanStack Router",
		"Guards in beforeLoad, with the session in route context.",
		"/docs/setups/tanstack-router",
	],
	[
		"TanStack Start",
		"Server rendering, with the session in an encrypted cookie.",
		"/docs/setups/tanstack-start",
	],
	[
		"React Router",
		"Declarative, data and framework mode without SSR.",
		"/docs/setups/react-router",
	],
	[
		"React Router SSR",
		"Framework mode with the session kept on the server.",
		"/docs/setups/react-router-ssr",
	],
	[
		"Next.js",
		"The App Router, with a Proxy that refreshes ahead of pages.",
		"/docs/setups/next",
	],
	[
		"Expo Router",
		"Keychain storage, a held splash screen and deep links.",
		"/docs/setups/expo",
	],
	[
		"React",
		"No router: render by the session's status.",
		"/docs/getting-started",
	],
	[
		"Effect",
		"The session as a service, and an effetch plugin.",
		"/docs/effect",
	],
] as const;

export function Setups() {
	return (
		<section className="mx-auto w-full max-w-5xl px-4 py-16">
			<h2 className="text-2xl font-semibold tracking-tight">
				One client, wherever your app runs
			</h2>
			<p className="mt-2 max-w-2xl text-fd-muted-foreground">
				Each setup has a guide and a runnable example app.
			</p>
			<Cards className="mt-6 sm:grid-cols-2 lg:grid-cols-4">
				{SETUPS.map(([title, description, href]) => (
					<Card
						key={title}
						title={title}
						description={description}
						href={href}
					/>
				))}
			</Cards>
		</section>
	);
}
