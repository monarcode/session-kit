import type { ReactNode } from "react";

import Link from "fumadocs-core/link";

// The MDX `Cards` and `Card`, set as rows between hairlines like the
// landing's setups list rather than as a grid of boxes.

export function Cards({ children }: { children: ReactNode }) {
	return (
		<ul className="not-prose my-8 border-t border-buffer-line">{children}</ul>
	);
}

const ROW =
	"grid gap-x-6 gap-y-1 py-3.5 sm:grid-cols-[13rem_1fr] sm:items-baseline sm:px-2";

export function Card({
	title,
	description,
	href,
	external,
	children,
}: {
	title: ReactNode;
	description?: ReactNode | undefined;
	href?: string | undefined;
	external?: boolean | undefined;
	children?: ReactNode | undefined;
}) {
	const body = (
		<>
			<span className="font-mono text-sm font-semibold">{title}</span>
			{(description || children) && (
				<span className="text-sm text-pretty text-fd-muted-foreground">
					{description}
					{children}
				</span>
			)}
		</>
	);
	return (
		<li className="border-b border-buffer-line">
			{href ? (
				// `data-card` keeps the prose link styles off the row.
				<Link
					href={href}
					external={external}
					data-card=""
					className={`${ROW} transition-colors hover:bg-fd-accent/30`}
				>
					{body}
				</Link>
			) : (
				<div className={ROW}>{body}</div>
			)}
		</li>
	);
}
