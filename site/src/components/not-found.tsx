import { Link } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import { baseOptions } from "@/lib/layout.shared";

import {
	COLUMN,
	HEADLINE,
	PRIMARY_ACTION,
	SECONDARY_ACTION,
} from "./landing/buffer";
import { Frame } from "./landing/frame";

/** A path with no page: the buffer's comment voice, and two ways back. */
export function NotFound() {
	return (
		<HomeLayout
			{...baseOptions()}
			slots={{ container: Frame }}
			className="live-source"
		>
			<main
				id="main"
				className={`${COLUMN} flex flex-1 scroll-mt-14 flex-col pt-16 pb-24`}
			>
				<h1 className={`${HEADLINE} font-bold`}>
					<span aria-hidden="true" className="font-light text-buffer-dim">
						{"// "}
					</span>
					404: nothing at this path.
				</h1>
				<p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-pretty text-fd-muted-foreground sm:mt-4 sm:text-base">
					The page may have moved. Search, at the top, finds it by name.
				</p>
				<div className="mt-5 flex flex-wrap gap-3 sm:mt-6">
					{/* Exact, or a missing docs page would mark this link current. */}
					<Link
						to="/docs/$"
						params={{ _splat: "" }}
						activeOptions={{ exact: true }}
						className={PRIMARY_ACTION}
					>
						Read the docs
					</Link>
					<Link to="/" className={SECONDARY_ACTION}>
						Home
					</Link>
				</div>
			</main>
		</HomeLayout>
	);
}
