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

export type TourStep = {
	label: string;
	file: string;
	href: string;
	/** A line under the code, such as which router an example uses. */
	note?: string | undefined;
	code: Root;
};

export function Tour({ steps }: { steps: TourStep[] }) {
	return (
		<section className="mx-auto w-full max-w-5xl px-4 py-16">
			<h2 className="text-2xl font-semibold tracking-tight">
				The whole idea in three files
			</h2>
			<p className="mt-2 max-w-2xl text-fd-muted-foreground">
				A client that knows your backend, a component that reads the
				session, and a route only signed-in users reach. Every snippet is
				type-checked against the published package.
			</p>
			<Tabs className="mt-6" defaultValue={steps[0]?.label}>
				{/* Phones: three equal columns whose labels may wrap, so no step
				    hides off the edge of a scrolling strip. */}
				<TabsList className="grid grid-cols-3 gap-0 px-0 sm:flex sm:gap-3.5 sm:px-4">
					{steps.map((step) => (
						<TabsTrigger
							key={step.label}
							value={step.label}
							className="justify-center px-2 text-center whitespace-normal text-balance sm:px-0 sm:whitespace-nowrap"
						>
							{step.label}
						</TabsTrigger>
					))}
				</TabsList>
				{steps.map((step) => (
					<TabsContent key={step.label} value={step.label}>
						{toJsx(step.code, {
							components: {
								pre: (props) => (
									<CodeBlock
										{...props}
										title={step.file}
										// Phones wrap long lines with a hanging indent
										// rather than hide their ends off to the right,
										// and show the whole file: a capped box would
										// trap the page's scroll inside it.
										className="my-0 sm:max-h-[28rem] max-sm:[&_[role=region]]:max-h-none max-sm:[&_.line]:ps-[calc(1rem+2ch)] max-sm:[&_.line]:-indent-[2ch] max-sm:[&_pre]:w-full max-sm:[&_pre]:whitespace-pre-wrap max-sm:[&_pre]:break-words"
									>
										<Pre>{props.children}</Pre>
									</CodeBlock>
								),
							},
						})}
						<div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
							<Link
								to={step.href}
								className="font-medium text-fd-primary hover:underline"
							>
								Read the walkthrough →
							</Link>
							{step.note && (
								<span className="text-fd-muted-foreground">
									{step.note}
								</span>
							)}
						</div>
					</TabsContent>
				))}
			</Tabs>
		</section>
	);
}
