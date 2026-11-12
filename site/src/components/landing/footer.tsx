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
				className={`${COLUMN} flex flex-wrap gap-x-6 gap-y-2 py-8 text-xs text-fd-muted-foreground`}
			>
				{LINKS.map(([label, href]) => (
					<a key={label} href={href} className="hover:text-fd-foreground">
						{label}
					</a>
				))}
			</div>
		</footer>
	);
}
