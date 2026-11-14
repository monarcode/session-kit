import { COLUMN, SectionHead } from "./buffer";

const FEATURES = [
	[
		"One refresh at a time",
		"Open tabs take turns, so only one spends the refresh token and the rest reuse the tokens it saved. A sign-out in one tab signs out them all.",
	],
	[
		"A user you can trust",
		"Your schema, from Zod, Valibot, ArkType or any Standard Schema library, types the user and checks it wherever it arrives: at sign-in, on refresh, on reload and from another tab.",
	],
	[
		"Tokens kept out of state",
		"The auth state holds no tokens, so it's safe to render and to put in route context. Only the code that sends your requests reads them.",
	],
	[
		"Guards for your router",
		"TanStack Router, React Router in all three modes, Expo Router and Next.js send signed-out users to sign in, then back to the page they asked for.",
	],
	[
		"Your HTTP client",
		"ky, axios, openapi-fetch and anything else that takes a fetch send the access token to your API's origin only, and refresh after a 401.",
	],
	[
		"Server rendering",
		"With TanStack Start, Next.js or React Router, the session lives in an encrypted httpOnly cookie, so the first render is already signed in.",
	],
	[
		"Native apps",
		"The session is saved in the iOS keychain or Android Keystore, the splash screen holds until it's restored, and it can lock behind biometrics.",
	],
	[
		"Made to be debugged",
		"Every failure Session kit reports is an AuthError with a code, and debug mode logs each step without printing a token.",
	],
] as const;

export function Features() {
	return (
		<section className={`${COLUMN} pt-20 sm:pt-28`}>
			<SectionHead title="What it handles" />
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
		</section>
	);
}
