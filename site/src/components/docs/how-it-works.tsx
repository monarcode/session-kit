import { Fragment, useEffect, useRef, type CSSProperties } from "react";

// The "How it works" figure on the Introduction: your backend, Session kit and
// your components as three flat panels, with what crosses between them drawn
// as hairline arrows. HTML rather than an image, so it reflows with the page,
// stays selectable, and takes the site's own type and colours.

type Direction = "left" | "right" | "both";

type Crossing = { direction: Direction; label: string } | null;

const COLUMNS = [
	{
		name: "Your backend",
		note: "issues tokens",
		items: ["POST /login", "POST /refresh", "GET /orders"],
	},
	{
		name: "Session kit",
		note: "keeps the session",
		items: ["signIn()", "refresh, on time", "authFetch()"],
	},
	{
		name: "Your components",
		note: "state, never tokens",
		items: ["useAuth()", "route guards", "loaders, queries"],
	},
] as const;

// For each row, what crosses the gap after the backend and the gap after
// Session kit. Tokens only ever cross the first.
const CROSSINGS: readonly [Crossing, Crossing][] = [
	[
		{ direction: "right", label: "tokens" },
		{ direction: "right", label: "state" },
	],
	[{ direction: "both", label: "tokens" }, null],
	[
		{ direction: "left", label: "token" },
		{ direction: "left", label: "request" },
	],
];

// When a packet sets off across each arrow, in ms, in the order a sign-in and
// then a request travel: the login row, the refresh, then the request out.
const DELAYS: readonly [number, number][] = [
	[0, 450],
	[900, 0],
	[2250, 1800],
];

const HEADER = "h-16";
const ROW = "h-12";

/**
 * Where tokens, state and requests travel between the backend, Session kit
 * and the components, as a figure.
 *
 * The page puts a text diagram inside it. This component ignores that, and
 * the page's Markdown keeps it.
 */
export function HowItWorks() {
	const figure = useRef<HTMLElement>(null);

	// Plays the packets once, when the figure first scrolls into view.
	useEffect(function playWhenSeen() {
		const node = figure.current;
		if (!node || typeof IntersectionObserver === "undefined") return;
		const observer = new IntersectionObserver(
			function onIntersect([entry]) {
				if (!entry?.isIntersecting) return;
				node.dataset.play = "";
				observer.disconnect();
			},
			{ threshold: 0.4 },
		);
		observer.observe(node);
		return function unwatch() {
			observer.disconnect();
		};
	}, []);

	return (
		<figure
			ref={figure}
			role="img"
			aria-label="Your backend issues tokens. Session kit saves and refreshes them, and sends them with your requests. Your components read state and never see a token."
			className="not-prose @container my-8"
		>
			<div className="flex flex-col items-stretch @xl:flex-row">
				{COLUMNS.map((column, index) => (
					<Fragment key={column.name}>
						{index > 0 && (
							<Gap
								crossings={CROSSINGS.map(
									(row) => row[index - 1] ?? null,
								)}
								delays={DELAYS.map((row) => row[index - 1] ?? 0)}
							/>
						)}
						<div
							className={`flex-1 border ${
								index === 1
									? "border-buffer-mark"
									: "border-buffer-line"
							}`}
						>
							<div
								className={`${HEADER} flex flex-col justify-center border-b px-4 ${
									index === 1
										? "border-buffer-mark"
										: "border-buffer-line"
								}`}
							>
								<span
									className={`text-sm font-semibold ${
										index === 1
											? "text-fd-foreground"
											: "text-fd-muted-foreground"
									}`}
								>
									{column.name}
								</span>
								<span className="text-xs text-buffer-dim">
									<span aria-hidden="true">{"// "}</span>
									{column.note}
								</span>
							</div>
							{column.items.map((item, row) => (
								<div
									key={item}
									className={`${ROW} flex items-center px-4 font-mono text-[13px] leading-tight text-fd-foreground ${
										row > 0 ? "border-t border-buffer-line" : ""
									}`}
								>
									{item}
								</div>
							))}
						</div>
					</Fragment>
				))}
			</div>
		</figure>
	);
}

/** What crosses between two panels: beside them from 36rem, between them below. */
function Gap({
	crossings,
	delays,
}: {
	crossings: Crossing[];
	delays: number[];
}) {
	return (
		<>
			<div
				aria-hidden="true"
				// Starts under the header, so each arrow sits level with its row.
				className="hidden w-24 shrink-0 flex-col pt-[calc(4rem+1px)] pb-px @xl:flex"
			>
				{crossings.map((crossing, row) => (
					<div key={row} className={`${ROW} relative flex items-center`}>
						{crossing && <Arrow {...crossing} delay={delays[row] ?? 0} />}
					</div>
				))}
			</div>
			<div
				aria-hidden="true"
				className="flex h-8 flex-col items-center text-buffer-mark @xl:hidden"
			>
				<Arrowhead className="-rotate-90" />
				<span className="relative w-px flex-1 bg-current">
					<Packet axis="y" direction="both" delay={delays[0] ?? 0} />
				</span>
				<Arrowhead className="rotate-90" />
			</div>
		</>
	);
}

function Arrow({
	direction,
	label,
	delay,
}: {
	direction: Direction;
	label: string;
	delay: number;
}) {
	return (
		<div className="relative flex w-full items-center text-buffer-mark">
			<span className="absolute inset-x-0 bottom-[calc(50%+5px)] text-center text-[11px] leading-none text-buffer-dim">
				{label}
			</span>
			{direction !== "right" && <Arrowhead className="-scale-x-100" />}
			<span className="relative h-px flex-1 bg-current">
				<Packet axis="x" direction={direction} delay={delay} />
			</span>
			{direction !== "left" && <Arrowhead />}
		</div>
	);
}

/** The square that crosses an arrow once; `app.css` plays it. */
function Packet({
	axis,
	direction,
	delay,
}: {
	axis: "x" | "y";
	direction: Direction;
	delay: number;
}) {
	return (
		<span
			data-axis={axis}
			data-direction={direction}
			style={{ "--delay": `${delay}ms` } as CSSProperties}
			className={`how-packet absolute size-[5px] bg-fd-foreground opacity-0 ${
				axis === "x"
					? "top-1/2 -translate-y-1/2"
					: "left-1/2 -translate-x-1/2"
			}`}
		/>
	);
}

function Arrowhead({ className = "" }: { className?: string }) {
	return (
		<svg
			width="7"
			height="9"
			viewBox="0 0 7 9"
			className={`shrink-0 fill-current ${className}`}
		>
			<path d="M0 0 7 4.5 0 9Z" />
		</svg>
	);
}
