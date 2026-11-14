import { Fragment } from "react";

import { Link } from "@tanstack/react-router";
import { toJsx } from "fumadocs-core/utils/hast-to-jsx";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "fumadocs-ui/components/tabs";
import type { Root } from "hast";

import { COLUMN, SectionHead } from "./buffer";

export type TourStep = {
	label: string;
	file: string;
	href: string;
	/** The page the walkthrough link leads to, as its text names it. */
	guide: string;
	code: Root;
};

export function Tour({ steps }: { steps: TourStep[] }) {
	return (
		<section className={`${COLUMN} pt-20 sm:pt-28`}>
			<SectionHead title="The whole idea in three files">
				A client that knows your backend, a route only signed-in users
				reach, and a page that reads the session. This is the TanStack
				Router guide's own code, type-checked with every other example in
				the docs. Each setup's guide has its own version.
			</SectionHead>
			{/* One surface, the code block: the tabs sit on the page, not on a card. */}
			<Tabs
				className="mt-8 overflow-visible rounded-none border-0 bg-transparent"
				defaultValue={steps[0]?.label}
			>
				{/* The tabs are the buffer's open files. Phones: three equal columns
				    whose names may wrap, so no file hides off the edge of a
				    scrolling strip. */}
				<TabsList
					aria-label="Files"
					className="grid grid-cols-3 gap-0 border-b border-buffer-line px-0 sm:flex sm:gap-6"
				>
					{steps.map((step) => (
						<TabsTrigger
							key={step.label}
							value={step.label}
							className="justify-center px-1 text-center text-[11px] whitespace-normal [overflow-wrap:anywhere] data-[active]:border-fd-foreground data-[active]:text-fd-foreground sm:px-0 sm:text-sm sm:whitespace-nowrap"
						>
							{/* A path wraps after a slash or before the extension, not
							    inside a name. */}
							{step.file.split(/(?<=\/)|(?=\.)/).map((part, i) => (
								<Fragment key={i}>
									{i > 0 && <wbr />}
									{part}
								</Fragment>
							))}
						</TabsTrigger>
					))}
				</TabsList>
				{steps.map((step) => (
					<TabsContent
						key={step.label}
						value={step.label}
						className="rounded-none bg-transparent p-0 pt-5"
					>
						<p className="mb-3 text-sm text-fd-muted-foreground">
							<span aria-hidden="true" className="text-buffer-dim">
								{"// "}
							</span>
							{step.label}
						</p>
						{toJsx(step.code, {
							components: {
								pre: (props) => (
									<CodeBlock
										{...props}
										// Flat on the page, with no title bar: the tab
										// already names the file. Phones wrap long lines
										// with a hanging indent rather than hide their
										// ends off to the right.
										className="my-0 rounded-none border-buffer-line bg-transparent max-sm:[&_.line]:ps-[calc(1rem+2ch)] max-sm:[&_.line]:-indent-[2ch] max-sm:[&_pre]:w-full max-sm:[&_pre]:whitespace-pre-wrap max-sm:[&_pre]:break-words"
										// Every file shows whole: the longest fits under
										// Fumadocs' own cap, and on phones a capped box
										// would trap the page's scroll.
										viewportProps={{ className: "max-sm:max-h-none" }}
									>
										<Pre>{props.children}</Pre>
									</CodeBlock>
								),
							},
						})}
						<Link
							to={step.href}
							className="inline-block py-3 text-sm underline decoration-buffer-dim underline-offset-4 transition-colors hover:decoration-fd-foreground"
						>
							Read the walkthrough in {step.guide}
						</Link>
					</TabsContent>
				))}
			</Tabs>
		</section>
	);
}
