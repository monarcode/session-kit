import type { ComponentProps } from "react";

import * as Twoslash from "fumadocs-twoslash/ui";
import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { TypeTable } from "fumadocs-ui/components/type-table";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

import { Card, Cards } from "./docs/cards";

// Marked for the docs' styles in app.css, which square it off. Declared once
// here: a new component on each render would reset its open rows.
function DocsTypeTable(props: ComponentProps<typeof TypeTable>) {
	return (
		<TypeTable
			{...props}
			className={["docs-types", props.className].filter(Boolean).join(" ")}
		/>
	);
}

export function getMDXComponents(components?: MDXComponents) {
	return {
		...defaultMdxComponents,
		...Twoslash,
		Accordion,
		Accordions,
		Card,
		Cards,
		Step,
		Steps,
		Tab,
		Tabs,
		TypeTable: DocsTypeTable,
		...components,
	} satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
	type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
