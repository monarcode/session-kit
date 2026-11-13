import { gitConfig } from "@/lib/shared";

import { COLUMN } from "./buffer";

const LINKS = [
	["npm", "https://www.npmjs.com/package/@monarcode/session-kit"],
	["GitHub", `https://github.com/${gitConfig.user}/${gitConfig.repo}`],
	[
		"Changelog",
		`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/main/CHANGELOG.md`,
	],
	[
		"MIT License",
		`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/main/LICENSE`,
	],
] as const;

export function Footer() {
	return (
		<footer className="mt-24 border-t border-buffer-line sm:mt-28">
			<div
				className={`${COLUMN} flex flex-wrap gap-x-6 py-4.5 text-xs text-fd-muted-foreground`}
			>
				{LINKS.map(([label, href]) => (
					<a
						key={label}
						href={href}
						// The hit area reaches past the label: 44px tall, and
						// half the gap to each neighbour.
						className="relative py-3.5 transition-colors after:absolute after:inset-x-[-0.75rem] after:inset-y-0 hover:text-fd-foreground"
					>
						{label}
					</a>
				))}
			</div>
		</footer>
	);
}
