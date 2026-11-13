import { Link } from "@tanstack/react-router";

import { COLUMN } from "./buffer";

/**
 * What Session kit leaves to the backend, and where to go for it. Set as a
 * block comment under the tour: a note on the code above, not a callout.
 */
export function ScopeNote() {
	return (
		<section className={`${COLUMN} pt-12 sm:pt-16`}>
			<div className="max-w-[72ch] text-sm leading-relaxed text-fd-muted-foreground">
				<p aria-hidden="true" className="text-buffer-dim">
					/*
				</p>
				<h2 className="ps-[3ch] font-semibold text-fd-foreground">
					What it doesn't do
				</h2>
				<p className="mt-1 ps-[3ch] text-pretty">
					Session kit never signs users in. It has no sign-in form, OAuth
					flow or user database: it starts where your backend's sign-in
					response ends. If you need those too, use an auth service or
					framework such as Auth.js, Better Auth or Clerk, which manage
					their own sessions.{" "}
					<Link
						to="/docs/$"
						params={{ _splat: "" }}
						hash="what-it-doesnt-do"
						className="whitespace-nowrap text-fd-foreground underline decoration-buffer-dim underline-offset-4 transition-colors hover:decoration-fd-foreground"
					>
						Read the introduction
					</Link>
				</p>
				<p aria-hidden="true" className="ps-[1ch] text-buffer-dim">
					*/
				</p>
			</div>
		</section>
	);
}
