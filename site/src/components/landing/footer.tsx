import { gitConfig } from "@/lib/shared";

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
		<footer className="border-t border-fd-border">
			<div className="mx-auto flex w-full max-w-5xl flex-wrap gap-x-6 gap-y-2 px-4 py-8 text-sm text-fd-muted-foreground">
				{LINKS.map(([label, href]) => (
					<a key={label} href={href} className="hover:text-fd-foreground">
						{label}
					</a>
				))}
			</div>
		</footer>
	);
}
