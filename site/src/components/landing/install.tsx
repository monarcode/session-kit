import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// The same managers, in the same order, as the docs' install tabs.
const INSTALL = [
	["npm", "npm install @monarcode/session-kit"],
	["pnpm", "pnpm add @monarcode/session-kit"],
	["yarn", "yarn add @monarcode/session-kit"],
	["bun", "bun add @monarcode/session-kit"],
] as const;

type Manager = (typeof INSTALL)[number][0];

// The chosen package manager is one choice for the whole page, so the prompt
// in the hero and the one where the page closes agree, and it is remembered
// for the next visit.
const STORAGE_KEY = "session-kit:package-manager";
const watchers = new Set<() => void>();
let chosen: Manager | undefined;

/** The saved choice, read once. Storage can be blocked: then it is npm. */
function chosenManager(): Manager {
	if (chosen) return chosen;
	let saved: string | null = null;
	try {
		saved = localStorage.getItem(STORAGE_KEY);
	} catch {
		// Private windows and blocked storage: nothing was saved.
	}
	chosen = INSTALL.find(([name]) => name === saved)?.[0] ?? "npm";
	return chosen;
}

function chooseManager(manager: Manager) {
	chosen = manager;
	try {
		localStorage.setItem(STORAGE_KEY, manager);
	} catch {
		// The choice still holds for this page.
	}
	for (const notify of watchers) notify();
}

function watchManager(onChange: () => void) {
	watchers.add(onChange);
	return () => watchers.delete(onChange);
}

/** The install prompt: a package-manager switch, the command and a copy button. */
export function Install() {
	// The server renders npm; a saved choice shows once the page hydrates.
	const manager = useSyncExternalStore(
		watchManager,
		chosenManager,
		(): Manager => "npm",
	);
	// What the copy button last did: copied the command, or, where the page
	// may not write to the clipboard, selected it for the visitor to copy.
	const [copy, setCopy] = useState<"idle" | "copied" | "selected">("idle");
	const code = useRef<HTMLElement>(null);
	const command = INSTALL.find(([name]) => name === manager)![1];

	useEffect(
		function clearCopy() {
			if (copy === "idle") return;
			const timer = setTimeout(
				() => setCopy("idle"),
				copy === "copied" ? 1600 : 4000,
			);
			return function cancel() {
				clearTimeout(timer);
			};
		},
		[copy],
	);

	async function copyCommand() {
		try {
			await navigator.clipboard.writeText(command);
			setCopy("copied");
		} catch {
			// The clipboard is denied, or missing on an insecure origin. Select
			// the command instead, so the visitor's own copy takes it.
			if (code.current) {
				window.getSelection()?.selectAllChildren(code.current);
			}
			setCopy("selected");
		}
	}

	return (
		<div className="min-w-0">
			<div
				role="group"
				aria-label="Package manager"
				className="flex gap-6 text-xs text-buffer-dim"
			>
				{INSTALL.map(([name]) => (
					<button
						key={name}
						type="button"
						aria-pressed={name === manager}
						onClick={() => chooseManager(name)}
						// The hit area reaches past the name: 44px tall, and half the gap
						// to each neighbour.
						className="relative py-1 transition-colors after:absolute after:inset-x-[-0.75rem] after:inset-y-[-0.625rem] hover:text-fd-foreground aria-pressed:text-fd-foreground aria-pressed:shadow-[inset_0_-2px_0_var(--color-fd-foreground)]"
					>
						{name}
					</button>
				))}
			</div>
			<div className="mt-2 flex min-h-12 items-center gap-3 border border-buffer-line py-1.5 ps-4 pe-1.5 text-sm">
				<span aria-hidden="true" className="text-buffer-dim">
					$
				</span>
				<code
					ref={code}
					className="min-w-0 flex-1 [overflow-wrap:anywhere]"
				>
					{command}
				</code>
				<button
					type="button"
					onClick={() => void copyCommand()}
					// The hit area is the field's full height.
					className="relative h-9 px-3 text-xs text-fd-muted-foreground transition-colors after:absolute after:inset-x-0 after:inset-y-[-0.25rem] hover:bg-fd-accent hover:text-fd-foreground"
				>
					<span aria-live="polite">
						{copy === "idle" ? "copy" : copy}
						{copy === "selected" && (
							<span className="sr-only">
								. Copy it with your keyboard or the selection menu.
							</span>
						)}
					</span>
				</button>
			</div>
		</div>
	);
}
