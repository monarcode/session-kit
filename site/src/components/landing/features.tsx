import { Link } from "@tanstack/react-router";

import { COLUMN, SectionHead } from "./buffer";

const FEATURES = [
	[
		"Schema-driven users",
		"Any Standard Schema library, such as Zod, Valibot or ArkType, checks the user at sign-in, refresh, restore and in other tabs, and types it.",
	],
	[
		"Tokens kept out of state",
		"The auth state holds no tokens, so it's safe to render and to put in route context. Only the code that sends your requests reads them.",
	],
	[
		"Guards for every router",
		"TanStack Router, React Router in all three modes, Expo Router and Next.js send signed-out users to sign in, then back to the page they asked for.",
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
		"Every failure Session kit reports is an AuthError with a code, and debug mode logs each step without printing a token.",
	],
] as const;

export function Features() {
	return (
		<section className={`${COLUMN} pt-20 sm:pt-28`}>
			<SectionHead title="What you get" />
			<dl className="mt-8 border-t border-buffer-line">
				{FEATURES.map(([title, text]) => (
					<div
						key={title}
						className="grid gap-x-6 gap-y-1 border-b border-buffer-line py-4 sm:grid-cols-[16rem_1fr] sm:px-2"
					>
						<dt className="font-semibold">{title}</dt>
						<dd className="max-w-[72ch] text-sm leading-relaxed text-pretty text-fd-muted-foreground">
							<span aria-hidden="true" className="text-buffer-dim">
								{"// "}
							</span>
							{text}
						</dd>
					</div>
				))}
			</dl>
			{/* Set as a block comment: a note on the code above, not a callout. */}
			<aside className="mt-12 max-w-[72ch] text-sm leading-relaxed text-fd-muted-foreground">
				<p aria-hidden="true" className="text-buffer-dim">
					/*
				</p>
				<h3 className="ps-[3ch] font-semibold text-fd-foreground">
					What it doesn't do
				</h3>
				<p className="mt-1 ps-[3ch] text-pretty">
					Session kit never signs users in. It has no sign-in form, OAuth
					flow or user database: it starts where your backend's sign-in
					response ends.{" "}
					<Link
						to="/docs/$"
						params={{ _splat: "" }}
						hash="what-it-doesnt-do"
						className="text-fd-foreground underline decoration-buffer-dim underline-offset-4 transition-colors hover:decoration-fd-foreground"
					>
						Is it for you?
					</Link>
				</p>
				<p aria-hidden="true" className="ps-[1ch] text-buffer-dim">
					*/
				</p>
			</aside>
		</section>
	);
}
