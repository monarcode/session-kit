import { Link } from "@tanstack/react-router";
import {
	CodeBlock,
	CodeBlockTab,
	CodeBlockTabs,
	CodeBlockTabsList,
	CodeBlockTabsTrigger,
	Pre,
} from "fumadocs-ui/components/codeblock";

import { Logo } from "@/components/logo";
import { gitConfig } from "@/lib/shared";

// The same managers, in the same order, as the docs' install tabs.
const INSTALL = [
	["npm", "npm install @monarcode/session-kit"],
	["pnpm", "pnpm add @monarcode/session-kit"],
	["yarn", "yarn add @monarcode/session-kit"],
	["bun", "bun add @monarcode/session-kit"],
] as const;

export function Hero({ version }: { version: string }) {
	return (
		<section className="mx-auto flex w-full max-w-5xl flex-col items-center px-4 pt-20 pb-12 text-center">
			<Logo className="mb-8 h-10 w-auto sm:h-12" />
			<a
				href={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/main/CHANGELOG.md`}
				className="mb-4 rounded-full border border-fd-border px-3 py-1 text-xs text-fd-muted-foreground hover:text-fd-foreground"
			>
				v{version}
			</a>
			<h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
				Your backend signs users in. session-kit handles everything after.
			</h1>
			<p className="mt-5 max-w-2xl text-lg text-fd-muted-foreground text-balance">
				Hand it the tokens your sign-in endpoint returns. It saves the
				session, restores it on reload, refreshes tokens before they expire,
				keeps every tab in step, and guards your routes.
			</p>
			<div className="mt-8 w-full max-w-md text-left">
				<CodeBlockTabs defaultValue="npm" className="my-0">
					<CodeBlockTabsList>
						{INSTALL.map(([manager]) => (
							<CodeBlockTabsTrigger key={manager} value={manager}>
								{manager}
							</CodeBlockTabsTrigger>
						))}
					</CodeBlockTabsList>
					{INSTALL.map(([manager, command]) => (
						<CodeBlockTab key={manager} value={manager}>
							<CodeBlock>
								<Pre>
									<code>
										{/* `line` carries the code block's padding. */}
										<span className="line">{command}</span>
									</code>
								</Pre>
							</CodeBlock>
						</CodeBlockTab>
					))}
				</CodeBlockTabs>
			</div>
			<div className="mt-6 flex flex-wrap justify-center gap-3">
				<Link
					to="/docs/$"
					params={{ _splat: "getting-started" }}
					className="rounded-lg bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/85"
				>
					Get started
				</Link>
				<a
					href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}
					className="rounded-lg border border-fd-border px-4 py-2 text-sm font-medium hover:bg-fd-accent"
				>
					GitHub
				</a>
			</div>
		</section>
	);
}
