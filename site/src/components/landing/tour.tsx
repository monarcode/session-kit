import { Link } from "@tanstack/react-router";
import { toJsx } from "fumadocs-core/utils/hast-to-jsx";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import type { Root } from "hast";

export type TourStep = {
	label: string;
	file: string;
	href: string;
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
			<Tabs className="mt-6" items={steps.map((step) => step.label)}>
				{steps.map((step) => (
					<Tab key={step.label} value={step.label}>
						{toJsx(step.code, {
							components: {
								pre: (props) => (
									<CodeBlock
										{...props}
										title={step.file}
										className="my-0 max-h-[28rem]"
									>
										<Pre>{props.children}</Pre>
									</CodeBlock>
								),
							},
						})}
						<Link
							to={step.href}
							className="mt-3 inline-block text-sm font-medium text-fd-primary hover:underline"
						>
							Read the walkthrough →
						</Link>
					</Tab>
				))}
			</Tabs>
		</section>
	);
}
