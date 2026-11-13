import type { ReactNode } from "react";

/** The landing page's column, shared by every section. */
// It matches the navbar's width, so the text starts under the logo.
export const COLUMN = "mx-auto w-full max-w-(--fd-layout-width) px-4";

/** The page's comment-voice headline, as the hero and the 404 set it. */
export const HEADLINE =
	"text-[clamp(1.6875rem,3.6vw,2.75rem)] leading-[1.12] tracking-[-0.04em]";

/** The one lime action on a page, such as Get started. */
export const PRIMARY_ACTION =
	"flex h-12 items-center px-6 text-sm font-bold text-fd-primary-foreground bg-fd-primary decoration-2 underline-offset-4 hover:underline";

/** A quiet action beside it, such as GitHub: a hairline box. */
export const SECONDARY_ACTION =
	"flex h-12 items-center border border-buffer-line px-5 text-sm transition-colors hover:bg-fd-accent";

/**
 * A line number in the buffer's gutter. Screen readers skip it. A `live` line,
 * one a visitor can edit, is marked with a lime `>`.
 */
export function Gutter({ n, live }: { n: number; live?: boolean }) {
	return (
		<span
			aria-hidden="true"
			className="relative w-7 shrink-0 text-xs font-normal tracking-normal text-buffer-dim tabular-nums select-none sm:w-12"
		>
			{/* The marker hangs left of the number, so the numbers stay in one
			    column. */}
			{live && (
				<span className="absolute end-full pe-px text-fd-primary">
					{">"}
				</span>
			)}
			{String(n).padStart(2, "0")}
		</span>
	);
}

/** A section heading set as a comment, with a line of lead text under it. */
export function SectionHead({
	title,
	children,
}: {
	title: string;
	children?: ReactNode;
}) {
	return (
		<header>
			<h2 className="text-[1.375rem] leading-tight font-semibold tracking-tight text-balance sm:text-3xl">
				<span aria-hidden="true" className="text-buffer-dim">
					{"// "}
				</span>
				{title}
			</h2>
			{children && (
				<p className="mt-3 max-w-[62ch] font-sans text-base leading-relaxed text-pretty text-fd-muted-foreground sm:text-lg">
					{children}
				</p>
			)}
		</header>
	);
}
