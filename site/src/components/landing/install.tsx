import { useEffect, useState } from "react";

// The same managers, in the same order, as the docs' install tabs.
const INSTALL = [
	["npm", "npm install @monarcode/session-kit"],
	["pnpm", "pnpm add @monarcode/session-kit"],
	["yarn", "yarn add @monarcode/session-kit"],
	["bun", "bun add @monarcode/session-kit"],
] as const;

type Manager = (typeof INSTALL)[number][0];

/** The install prompt: a package-manager switch, the command and a copy button. */
export function Install() {
	const [manager, setManager] = useState<Manager>("npm");
	const [copied, setCopied] = useState(false);
	const command = INSTALL.find(([name]) => name === manager)![1];

	useEffect(
		function clearCopied() {
			if (!copied) return;
			const timer = setTimeout(() => setCopied(false), 1600);
			return function cancel() {
				clearTimeout(timer);
			};
		},
		[copied],
	);

	return (
		<div className="min-w-0">
			<div
				role="group"
				aria-label="Package manager"
				className="flex gap-4 text-xs text-buffer-dim"
			>
				{INSTALL.map(([name]) => (
					<button
						key={name}
						type="button"
						aria-pressed={name === manager}
						onClick={() => setManager(name)}
						className="py-1 transition-colors hover:text-fd-foreground aria-pressed:text-fd-foreground aria-pressed:shadow-[inset_0_-2px_0_var(--color-fd-foreground)]"
					>
						{name}
					</button>
				))}
			</div>
			<div className="mt-2 flex min-h-12 items-center gap-3 border border-buffer-line py-1.5 ps-4 pe-1.5 text-sm">
				<span aria-hidden="true" className="text-buffer-dim">
					$
				</span>
				<code className="min-w-0 flex-1 [overflow-wrap:anywhere]">
					{command}
				</code>
				<button
					type="button"
					onClick={() => {
						void navigator.clipboard?.writeText(command).then(() => {
							setCopied(true);
						});
					}}
					className="h-9 px-3 text-xs text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground"
				>
					<span aria-live="polite">{copied ? "copied" : "copy"}</span>
				</button>
			</div>
		</div>
	);
}
