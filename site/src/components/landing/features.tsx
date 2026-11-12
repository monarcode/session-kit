import { Link } from "@tanstack/react-router";

const FEATURES = [
	[
		"Schema-driven users",
		"Any Standard Schema library, such as Zod, Valibot or ArkType, checks the user at sign-in, refresh, restore and in other tabs, and types it.",
	],
	[
		"Tokens stay out of reach",
		"State holds no tokens, so it's safe to render and put in route context. Only request code sees them.",
	],
	[
		"Every router",
		"TanStack Router, React Router in all three modes, and Expo Router get guards that redirect with a return URL.",
	],
	[
		"Server rendering",
		"With TanStack Start, Next.js or React Router, the session lives in an encrypted httpOnly cookie.",
	],
	[
		"Native apps",
		"The iOS keychain and Android Keystore, a splash screen held while restoring, and biometric locking.",
	],
	[
		"Made to be debugged",
		"Every failure is an AuthError with a code, and debug mode logs each step without printing a token.",
	],
] as const;

export function Features() {
	return (
		<section className="mx-auto w-full max-w-5xl px-4 py-16">
			<h2 className="text-2xl font-semibold tracking-tight">What you get</h2>
			<div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
				{FEATURES.map(([title, text]) => (
					<div key={title}>
						<h3 className="font-medium">{title}</h3>
						<p className="mt-1 text-sm text-pretty text-fd-muted-foreground">
							{text}
						</p>
					</div>
				))}
			</div>
			<div className="mt-12 rounded-xl border border-fd-border bg-fd-card p-6">
				<h3 className="font-medium">What it doesn't do</h3>
				<p className="mt-1 text-sm text-pretty text-fd-muted-foreground">
					session-kit never signs users in. It has no sign-in form, OAuth
					flow or user database: it starts where your backend's sign-in
					response ends.{" "}
					<Link
						to="/docs/$"
						params={{ _splat: "" }}
						hash="what-it-doesnt-do"
						className="font-medium text-fd-primary hover:underline"
					>
						Is it for you?
					</Link>
				</p>
			</div>
		</section>
	);
}
