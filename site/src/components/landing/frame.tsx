import type { ComponentProps } from "react";

/**
 * The home layout's container as a plain `div`. Fumadocs makes it the page's
 * `<main>`, which would hold the navbar and the footer too, so neither would
 * be a landmark. Here the navbar is the page's banner, and the page puts its
 * own `<main>` and footer inside.
 *
 * A skip link comes first, so keyboard users can pass the navbar.
 */
export function Frame({
	children,
	className,
	...props
}: Omit<ComponentProps<"main">, "ref">) {
	return (
		// Fumadocs' navbar sets its layout variables through this id.
		<div
			id="nd-home-layout"
			{...props}
			className={`flex flex-1 flex-col ${className ?? ""}`}
		>
			<a
				href="#main"
				className="sr-only border border-buffer-line bg-fd-background px-4 py-3 text-sm focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
			>
				Skip to content
			</a>
			{children}
		</div>
	);
}
