import { Suspense, use } from "react";

import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { staticFunctionMiddleware } from "@tanstack/start-static-server-functions";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { Callout } from "fumadocs-ui/components/callout";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
	DocsBody,
	DocsDescription,
	DocsPage,
	DocsTitle,
	MarkdownCopyButton,
	ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";

import { useMDXComponents } from "@/components/mdx";
import { baseOptions } from "@/lib/layout.shared";
import {
	getPageMarkdownUrl,
	gitConfig,
	LATEST,
	latestLabel,
	pageMeta,
	versionOfPath,
} from "@/lib/shared";
import { docs, source } from "@/lib/source";

export const Route = createFileRoute("/docs/$")({
	component: Page,
	loader: async ({ params }) => {
		const slugs = params._splat?.split("/") ?? [];
		const data = await pageData(slugs);
		await docs.getPage(data.path)?.preload();
		return data;
	},
	head: ({ loaderData }) => ({
		meta: loaderData
			? [
					...pageMeta(
						`${loaderData.title} | Session kit`,
						loaderData.description,
					),
					// Older lines stay out of search engines, which send readers
					// to the current docs instead.
					...(loaderData.older
						? [{ name: "robots", content: "noindex" }]
						: []),
				]
			: [],
	}),
});

/**
 * In the browser, a page's data is a JSON file. A missing page has none, so
 * the host answers with its 404 page, which fails to parse.
 */
async function pageData(slugs: string[]) {
	try {
		return await loader({ data: slugs });
	} catch (error) {
		if (error instanceof SyntaxError) throw notFound();
		throw error;
	}
}

const loader = createServerFn({ method: "GET" })
	.validator((slugs: string[]) => slugs)
	.middleware([staticFunctionMiddleware])
	.handler(async ({ data: slugs }) => {
		const page = source.getPage(slugs);
		if (!page) throw notFound();
		const version = versionOfPath(page.path);
		const older =
			version === LATEST
				? undefined
				: {
						version,
						// The same page in the current line, or its first page.
						latestUrl: source.getPage(slugs.slice(1))?.url ?? "/docs",
					};
		return {
			path: page.path,
			title: page.data.title ?? "",
			description: page.data.description ?? "",
			markdownUrl: getPageMarkdownUrl(page).url,
			pageTree: await source.serializePageTree(source.getPageTree()),
			older,
		};
	});

type Older = { version: string; latestUrl: string } | undefined;

function Content({
	path,
	markdownUrl,
	older,
}: {
	path: string;
	markdownUrl: string;
	older: Older;
}) {
	const page = docs.getPage(path);
	if (!page) throw new Error(`unknown page: ${path}`);

	const { toc } = use(page.load());
	const MDX = page.body;

	return (
		<DocsPage
			toc={toc}
			breadcrumb={{ className: "docs-breadcrumb" }}
			footer={{ className: "docs-pager" }}
		>
			{older && (
				<Callout
					type="warn"
					className="mt-0 rounded-none border-buffer-line bg-transparent"
				>
					These docs are for Session kit {older.version}. The latest is{" "}
					{latestLabel()}:{" "}
					<Link to={older.latestUrl} className="font-medium underline">
						read this page there
					</Link>
					.
				</Callout>
			)}
			{/* The title is a comment, like the landing's headings. */}
			<DocsTitle className="font-mono text-[1.75rem] leading-[1.15] font-semibold tracking-[-0.04em] text-balance sm:text-4xl">
				<span aria-hidden="true" className="font-light text-buffer-dim">
					{"// "}
				</span>
				{page.title}
			</DocsTitle>
			<DocsDescription className="mb-6 max-w-[62ch] text-base text-pretty sm:text-lg">
				{page.description}
			</DocsDescription>
			<div className="docs-actions -mt-2 flex flex-row items-center gap-2 border-b border-buffer-line pb-6">
				<MarkdownCopyButton markdownUrl={markdownUrl} />
				<ViewOptionsPopover
					markdownUrl={markdownUrl}
					githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/site/content/docs/${encodeURI(path)}`}
				/>
			</div>
			<DocsBody>
				<MDX components={useMDXComponents()} />
			</DocsBody>
		</DocsPage>
	);
}

function Page() {
	const { pageTree, path, markdownUrl, older } = useFumadocsLoader(
		Route.useLoaderData(),
	);

	return (
		<DocsLayout
			{...baseOptions()}
			tree={pageTree}
			// Scopes the docs' styles in app.css.
			containerProps={{ className: "docs-source" }}
		>
			<Link to={markdownUrl} hidden />
			<Suspense>
				<Content path={path} markdownUrl={markdownUrl} older={older} />
			</Suspense>
		</DocsLayout>
	);
}
