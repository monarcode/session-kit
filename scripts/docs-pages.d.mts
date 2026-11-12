// Types for the site, which imports `docs-pages.mjs` to give each titled
// example the same app that `check-docs.mjs` compiles it in.

/** One file of a page's app. */
export interface PageFile {
	origin: string;
	line: number;
	path: string;
	dom: boolean;
	code: string;
	fixture?: boolean | undefined;
}

/** A site page whose titled examples compile as one app. */
export interface PageDocument {
	path: string;
	resolutions: ("NodeNext" | "Bundler")[];
	dom: boolean;
	fixtures: Record<string, string>;
	shared?:
		| { from: string; files: string[]; directories?: string[] | undefined }
		| undefined;
	requires?: Record<string, string> | undefined;
}

export const root: string;
export const PAGES: string;
export const MARKERS: { md: RegExp; mdx: RegExp };
export const TITLE: RegExp;
export const documents: PageDocument[];

export function markedExamples(path: string, dom: boolean): PageFile[];
export function installedAtLeast(name: string, minimum: string): boolean;
export function pageApp(
	document: Pick<PageDocument, "path" | "dom" | "fixtures" | "shared">,
	report: (message: string) => void,
): PageFile[];
export function compilerSettings(
	resolution: "NodeNext" | "Bundler",
	dom: boolean,
): Record<string, unknown> & { lib: string[] };
