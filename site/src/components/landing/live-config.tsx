import {
	type CSSProperties,
	useEffect,
	useId,
	useReducer,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";

import { toJsx } from "fumadocs-core/utils/hast-to-jsx";

import type { ConfigLine } from "@/lib/tour";

import { Gutter } from "./buffer";

/** Minutes the lanes show: 09:00 to 10:01. */
const HOUR = 62;
/**
 * Minutes shown before 09:00: your app's own sign-in call to its backend,
 * before Session kit takes over.
 */
const PRE = 2;
/**
 * Columns after the hour: a blank one for the time skipped, then "later",
 * when the refresh token has expired too and the session ends.
 */
const POST = 4;
/** The refresh that fails, the sign-out, and the route guard's redirect. */
const REJECTED = HOUR + 1;
const SIGNED_OUT = HOUR + 2;
const REDIRECTED = HOUR + 3;
/** The last column's minute, and the length of each lane's score. */
const END = HOUR + POST;
/** Columns in each lane: the sign-in call, the hour, then later. */
const COLUMNS = PRE + END;
/** How long an access token lasts in the illustrative hour. */
const EXPIRES = 15;
/** Real milliseconds per minute of the hour. */
const MINUTE_MS = 140;
/**
 * Real milliseconds per minute while the playhead hurries: through what is
 * left of the hour after its last moment, and to the cycle boundary once a
 * visitor has queued an edit.
 */
const HURRY_MS = 25;
/** A short rest between cycles, in minutes of the hour. */
const REST = 8;
/** How long the playhead holds on a moment, so its tooltip can be read. */
const HOLD_MS = 1700;
/** Each refresh comes a minute before the access token would expire. */
const REFRESHES = [14, 28, 42, 56];

/** A lane's cell: a held state, a moment, or a moment that ends the session. */
type Cell = "" | "bar" | "hit" | "end";

// Bar lanes hold a state across the hour; hit lanes mark single moments.
const LANES = [
	["signed in", "bar"],
	["refresh", "hit"],
	["storage", "hit"],
	["other tabs", "bar"],
	["route guard", "hit"],
] as const;

/** What each lane does in the hour, with the `refresh` option or without. */
function score(refresh: boolean): Cell[][] {
	const lane = (cell: (m: number) => Cell) =>
		Array.from({ length: END }, (_, m) => cell(m));
	if (!refresh) {
		return [
			lane((m) => (m < EXPIRES ? "bar" : "")),
			lane(() => ""),
			// Saved at sign-in, then cleared when access expires.
			lane((m) => (m === 0 ? "hit" : m === EXPIRES ? "end" : "")),
			lane(() => ""),
			lane((m) => (m === EXPIRES + 1 ? "end" : "")),
		];
	}
	// Still signed in through the hour and into later, until the refresh
	// there fails.
	const signedIn = (m: number) => m < HOUR || m === REJECTED;
	return [
		lane((m) => (signedIn(m) ? "bar" : "")),
		lane((m) =>
			REFRESHES.includes(m) ? "hit" : m === REJECTED ? "end" : "",
		),
		// Saved at sign-in and on every refresh, read back on the reload at
		// 09:20, and cleared at the sign-out.
		lane((m) =>
			[0, 20, ...REFRESHES].includes(m)
				? "hit"
				: m === SIGNED_OUT
					? "end"
					: "",
		),
		lane((m) => (m >= 31 && signedIn(m) ? "bar" : "")),
		lane((m) => (m === 20 ? "hit" : m === REDIRECTED ? "end" : "")),
	];
}

const SCORES = { on: score(true), off: score(false) };

/** A lit moment's line in a tooltip; `label` stands in for the lane's name. */
type Moment = { lane: number; text: string; label?: string | undefined };

/** What happened at each lit moment of the hour, by minute, for tooltips. */
function moments(refresh: boolean): Map<number, Moment[]> {
	const at = new Map<number, Moment[]>();
	const add = (minute: number, lane: number, text: string, label?: string) => {
		at.set(minute, [...(at.get(minute) ?? []), { lane, text, label }]);
	};
	add(
		-PRE,
		0,
		"Your app's login() call. Your backend checks the password and returns tokens.",
		"your backend",
	);
	add(0, 2, "auth.signIn hands Session kit the tokens. The session is saved.");
	if (!refresh) {
		// The signed-in lane carries its own note here, so the tooltip speaks
		// for storage.
		add(
			EXPIRES,
			2,
			"Access expired with no refresh: signed out, session cleared.",
		);
		add(
			EXPIRES + 1,
			4,
			"The route guard redirects to /login, keeping the page in redirectTo.",
		);
		return at;
	}
	for (const m of REFRESHES) {
		add(m, 1, "New tokens, a minute before access expired.");
		add(m, 2, "The new tokens are saved.");
	}
	add(20, 2, "Page reloaded. The session is restored.");
	add(20, 4, "Checks the restored session. The page renders.");
	add(31, 3, "A second tab opened and shares the session.");
	add(
		REJECTED,
		1,
		"The refresh token has expired too. Your backend rejects it, so refresh returns null.",
	);
	add(SIGNED_OUT, 2, "Signed out. The saved session is cleared.");
	add(SIGNED_OUT, 3, "Every other tab is signed out too.");
	add(REDIRECTED, 4, "Redirects to /login, keeping the page in redirectTo.");
	return at;
}

const MOMENTS = { on: moments(true), off: moments(false) };
/** The minutes the playhead holds on, in order. */
const STOPS = {
	on: [...MOMENTS.on.keys()].sort((a, b) => a - b),
	off: [...MOMENTS.off.keys()].sort((a, b) => a - b),
};

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function watchReducedMotion(onChange: () => void) {
	const query = window.matchMedia(REDUCED_MOTION);
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
}

type Edits = {
	refresh: boolean;
	queued: boolean | null;
	cycle: number;
	/** Whether the hour has played out and rests before the next cycle. */
	resting: boolean;
};
type Edit =
	| { type: "boundary" }
	| { type: "restart" }
	| { type: "rest" }
	| { type: "queue"; refresh: boolean }
	| { type: "set"; refresh: boolean };

/**
 * The config's edits: a queued one only lands where an hour starts, at a
 * cycle boundary or when the hour restarts after being off screen.
 */
function edits(state: Edits, edit: Edit): Edits {
	switch (edit.type) {
		case "boundary":
			return {
				refresh: state.queued ?? state.refresh,
				queued: null,
				cycle: state.cycle + 1,
				resting: false,
			};
		case "restart":
			return {
				...state,
				refresh: state.queued ?? state.refresh,
				queued: null,
				resting: false,
			};
		case "rest":
			return { ...state, resting: true };
		case "queue":
			return {
				...state,
				queued: edit.refresh === state.refresh ? null : edit.refresh,
			};
		case "set":
			return { ...state, refresh: edit.refresh, queued: null };
	}
}

function clock(minute: number) {
	if (minute >= HOUR) return "later";
	const total = 9 * 60 + minute;
	return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Where a minute's column starts across the lanes, as a percentage. */
function columnAt(minute: number) {
	return `${((minute + PRE) / COLUMNS) * 100}%`;
}

// A held state runs through the gaps between minutes, so it reads as one
// strip rather than dashes. The gaps are 1px, and 3px from 640px.
const BAR = "h-1.5 self-center -me-px sm:h-2 sm:-me-[3px]";

// Lime only for what has played or is playing; the brand lime, never a tint.
// Red only for what ends the session. An empty minute draws nothing: the
// lane's track shows through.
function cellClass(lane: "bar" | "hit", kind: Cell, m: number, minute: number) {
	// The skipped time between the hour and later is a break in every lane.
	if (m === HOUR || kind === "") return "";
	if (lane === "bar") {
		return `${BAR} ${m <= minute ? "bg-fd-primary" : "bg-buffer-track"}`;
	}
	const shape = "rounded-[1px]";
	if (kind === "end") {
		return `${shape} ${m <= minute ? "bg-buffer-red" : "bg-buffer-mark"}`;
	}
	if (m === minute || m === minute - 1) return `${shape} bg-fd-primary`;
	return `${shape} ${m < minute ? "bg-fd-muted-foreground" : "bg-buffer-mark"}`;
}

// Wrapped code lines hang under the line they continue. Fumadocs pads each
// highlighted line; without that, a commented-out line keeps its column.
const CODE =
	"min-w-0 ps-[4ch] -indent-[4ch] whitespace-pre-wrap [overflow-wrap:anywhere] [&_.line]:px-0!";

/**
 * The hero's live config and the hour it plays. Commenting out the `refresh`
 * line takes effect at the next cycle, never mid-hour: the playhead hurries
 * there once a visitor has made the edit. Until a visitor touches it, the
 * page makes that edit itself as a cycle ends, so the config and the hour
 * under it always agree.
 */
export function LiveConfig({
	lines,
	start,
}: {
	lines: ConfigLine[];
	start: number;
}) {
	const [{ refresh, queued, cycle, resting }, dispatch] = useReducer(edits, {
		refresh: true,
		queued: null,
		cycle: 1,
		resting: false,
	});
	const [minute, setMinute] = useState(END);
	// The server and the first render show a still hour; the browser decides.
	const reduced = useSyncExternalStore(
		watchReducedMotion,
		() => window.matchMedia(REDUCED_MOTION).matches,
		() => true,
	);
	const [choice, setChoice] = useState<"auto" | "play" | "pause">("auto");
	const playing = choice === "auto" ? !reduced : choice === "play";
	const [visible, setVisible] = useState(false);
	const [touched, setTouched] = useState(false);
	const figure = useRef<HTMLElement>(null);
	const head = useRef<HTMLDivElement>(null);
	const stops = useRef(STOPS.on);
	// Whether a visitor's edit is queued, so the playhead hurries to land it.
	const hurry = useRef(false);
	const captionId = useId();
	// The moment the playhead holds on, and the one under the pointer.
	const [held, setHeld] = useState<number | null>(null);
	const [hovered, setHovered] = useState<number | null>(null);

	const source = queued ?? refresh;
	const cells = refresh ? SCORES.on : SCORES.off;
	const happened = refresh ? MOMENTS.on : MOMENTS.off;

	useEffect(
		function followTheScore() {
			stops.current = refresh ? STOPS.on : STOPS.off;
		},
		[refresh],
	);

	useEffect(function watchVisibility() {
		const element = figure.current;
		if (!element) return;
		const observer = new IntersectionObserver(([entry]) => {
			setVisible(entry?.isIntersecting ?? false);
		});
		observer.observe(element);
		return function unwatch() {
			observer.disconnect();
		};
	}, []);

	useEffect(
		function hurryForTheVisitor() {
			hurry.current = touched && queued !== null;
		},
		[touched, queued],
	);

	useEffect(
		function playTheHour() {
			if (!playing || !visible) return;
			// The hour starts over from 08:58, so an edit still queued lands.
			dispatch({ type: "restart" });
			let frame = 0;
			let previous = performance.now();
			// Minutes into the cycle, the next moment to hold on, when the
			// current hold ends, and whether the hour has played out.
			let t = -PRE;
			let next = 0;
			let holdUntil = 0;
			let rested = false;
			let last: number | null = null;
			function tick(now: number) {
				const elapsed = now - previous;
				previous = now;
				const hurried = hurry.current;
				// A hurried playhead leaves the moment it was holding on.
				if (hurried && holdUntil) holdUntil = now;
				if (now >= holdUntil) {
					if (holdUntil) {
						holdUntil = 0;
						setHeld(null);
					}
					const stop = stops.current[next];
					// After the hour's last moment there is nothing left to show,
					// so the playhead hurries to the end. The rest keeps its pace:
					// it is the beat in which the page's own edit shows as queued.
					const pace =
						hurried || (stop === undefined && t < END)
							? HURRY_MS
							: MINUTE_MS;
					const advanced = t + elapsed / pace;
					if (hurried) {
						// No holds: pass every moment on the way to the boundary.
						while ((stops.current[next] ?? Infinity) <= advanced)
							next += 1;
						t = advanced;
					} else if (stop !== undefined && advanced >= stop) {
						t = stop;
						next += 1;
						holdUntil = now + HOLD_MS;
						setHeld(stop);
					} else {
						t = advanced;
					}
				}
				if (t >= END && !rested) {
					rested = true;
					dispatch({ type: "rest" });
				}
				if (t >= END + REST) {
					// The cycle boundary: a queued edit lands here, so there is
					// nothing left to hurry for. The first stop, the sign-in call,
					// is the same in both scores, so the new score's stops are in
					// place by the time the hold there ends.
					t = -PRE;
					next = 0;
					last = null;
					rested = false;
					hurry.current = false;
					dispatch({ type: "boundary" });
				}
				const shown = Math.min(t, END) + PRE;
				head.current?.style.setProperty("--p", String(shown / COLUMNS));
				const m = Math.min(Math.floor(t), END);
				if (m !== last) {
					last = m;
					setMinute(m);
				}
				frame = requestAnimationFrame(tick);
			}
			frame = requestAnimationFrame(tick);
			return function stop() {
				cancelAnimationFrame(frame);
			};
		},
		[playing, visible],
	);

	// The page's own demo: as the first cycle ends, then every third cycle, it
	// drops `refresh` for one cycle and puts it back. The edit is made once the
	// hour has played out, so the config never disagrees with the hour shown.
	useEffect(
		function demoTheEdit() {
			if (touched || !playing || !resting) return;
			if (refresh && cycle % 3 !== 1) return;
			dispatch({ type: "queue", refresh: !refresh });
		},
		[resting, cycle, refresh, touched, playing],
	);

	function toggle() {
		setTouched(true);
		dispatch({ type: playing ? "queue" : "set", refresh: !source });
	}

	function pauseOrPlay() {
		setTouched(true);
		// No cycle ends while paused, so a queued edit lands now.
		if (playing) dispatch({ type: "set", refresh: source });
		setChoice(playing ? "pause" : "play");
	}

	const shownMinute = playing ? minute : END;
	const tip = hovered ?? (playing && visible ? held : null);

	return (
		<>
			<div className="mt-7 text-[13px] leading-[1.8] sm:mt-8 sm:text-[15px] sm:leading-[1.7] short:mt-5 short:leading-[1.55]">
				{lines.map((line, i) => {
					const live = line.text.trimStart().startsWith("refresh:");
					const n = start + i;
					if (!live) {
						return (
							<div key={n} className="flex items-baseline">
								<Gutter n={n} />
								<code className={`shiki ${CODE}`}>
									{/* A blank line holds a space, so it keeps its height
									    and its number sits on the baseline. */}
									{line.text ? toJsx(line.code) : " "}
								</code>
							</div>
						);
					}
					const indent = line.text.length - line.text.trimStart().length;
					return (
						<div key={n} className="flex items-baseline">
							<Gutter n={n} live />
							<button
								type="button"
								onClick={toggle}
								aria-label={
									source
										? "Comment out the refresh option"
										: "Restore the refresh option"
								}
								className={`-ms-2 flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 ps-2 text-start transition-colors max-sm:pb-1 ${
									queued !== null
										? "bg-fd-accent/40 shadow-[inset_2px_0_0_var(--brand-lime)]"
										: "hover:bg-fd-accent/40"
								}`}
							>
								{source ? (
									<code className={`shiki ${CODE}`}>
										{toJsx(line.code)}
										{queued !== null && <Cursor />}
									</code>
								) : (
									<code className={`${CODE} text-buffer-dim`}>
										{" ".repeat(indent)}
										{"// "}
										{line.text.trimStart()}
										{queued !== null && <Cursor />}
									</code>
								)}
								{/* Phones put the tag on its own row, under the code. */}
								<span className="shrink-0 text-xs max-sm:basis-full max-sm:ps-[calc(4ch-0.5rem)] sm:ms-auto">
									<span
										className={`px-2 ${
											queued !== null
												? "bg-fd-primary text-fd-primary-foreground"
												: "text-buffer-dim"
										}`}
									>
										{queued !== null
											? "applies next cycle"
											: source
												? "click to comment out"
												: "click to restore"}
									</span>
								</span>
							</button>
						</div>
					);
				})}
			</div>

			<figure
				ref={figure}
				aria-labelledby={captionId}
				className="mt-5 border-t border-buffer-line pt-5 short:mt-3 short:pt-3"
			>
				<p className="sr-only">
					Before 09:00, your app signs in with your backend, then hands the
					tokens to Session kit. With the refresh option, the user stays
					signed in all hour: Session kit refreshes a minute before each
					expiry, saves the session at sign-in and on every refresh, reads
					it back on a reload at 09:20, where the route guard lets the page
					render, and keeps a second tab opened at 09:31 in step. Later,
					when the refresh token has expired too, the refresh fails: the
					session ends in every tab and the route guard redirects to the
					sign-in page. Without the refresh option, the session ends when
					access expires at 09:15, and the guard redirects at 09:16.
				</p>

				{/* The status line heads the figure: it sits by the config it reports
				    on, and no tooltip, which opens under a lane, covers it. */}
				<div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 text-xs text-fd-muted-foreground">
					<figcaption id={captionId} className="text-pretty">
						One illustrative hour, as Session kit runs it
					</figcaption>
					<div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-buffer-dim">
						<span>{playing ? "running" : "paused"}</span>
						<span>refresh {refresh ? "on" : "off"}</span>
						{!refresh && shownMinute >= EXPIRES && (
							<span className="text-buffer-red sm:hidden">
								signed out at 09:15
							</span>
						)}
						<span>
							cycle{" "}
							<span className="text-fd-foreground tabular-nums">
								{cycle}
							</span>
						</span>
						<span
							className="text-sm text-fd-foreground tabular-nums"
							aria-hidden="true"
						>
							{clock(shownMinute)}
						</span>
						<button
							type="button"
							onClick={pauseOrPlay}
							className="underline decoration-buffer-dim underline-offset-4 transition-colors hover:text-fd-foreground"
						>
							{playing ? "pause" : "play"}
						</button>
					</div>
				</div>
				<div aria-hidden="true" className="mt-3">
					{/* The playhead spans the lanes, not the axis under them. */}
					<div className="relative">
						{LANES.map(([lane, kind], k) => (
							<div
								key={lane}
								className="grid grid-cols-[5.5rem_1fr] items-center gap-3 py-[5px] sm:grid-cols-[8rem_1fr] short:py-[3px]"
							>
								<span className="text-xs text-fd-muted-foreground">
									{lane}
								</span>
								<div
									className="relative isolate grid h-4 gap-px sm:h-5 sm:gap-[3px]"
									style={{
										gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`,
									}}
								>
									{/* The lane's track: a hairline under its minutes,
									    broken where the hour skips to later. Only the
									    signed-in lane starts before 09:00. */}
									<span
										className="absolute top-1/2 -z-10 h-px bg-buffer-track"
										style={{
											left: columnAt(k === 0 ? -PRE : 0),
											right: `calc(100% - ${columnAt(HOUR)})`,
										}}
									/>
									<span
										className="absolute top-1/2 right-0 -z-10 h-px bg-buffer-track"
										style={{ left: columnAt(HOUR + 1) }}
									/>
									{/* Before 09:00 only the signed-in lane has anything:
									    your backend's sign-in call, in blue. The other
									    lanes start when Session kit does. */}
									{Array.from({ length: PRE }, (_, i) => {
										const m = i - PRE;
										if (k !== 0) return <span key={m} />;
										return (
											<span
												key={m}
												onPointerEnter={() => setHovered(-PRE)}
												onPointerLeave={() => setHovered(null)}
												className={`${BAR} cursor-help transition-colors duration-200 ${m <= shownMinute ? "bg-buffer-blue" : "bg-buffer-track"}`}
											/>
										);
									})}
									{cells[k]!.map((cell, m) => {
										const explained =
											cell !== "" &&
											happened
												.get(m)
												?.some((moment) => moment.lane === k);
										return (
											<span
												key={m}
												onPointerEnter={
													explained
														? () => setHovered(m)
														: undefined
												}
												onPointerLeave={
													explained
														? () => setHovered(null)
														: undefined
												}
												className={`transition-colors duration-200 ${explained ? "cursor-help" : ""} ${cellClass(kind, cell, m, shownMinute)}`}
											/>
										);
									})}
									{k === 0 && !refresh && shownMinute >= EXPIRES && (
										<span
											className="absolute top-1/2 -translate-y-1/2 bg-fd-background ps-2 pe-1 text-xs whitespace-nowrap text-buffer-red max-sm:hidden"
											style={{ left: columnAt(EXPIRES) }}
										>
											access expired, no refresh: signed out
										</span>
									)}
								</div>
							</div>
						))}
						<div className="pointer-events-none absolute inset-y-0 right-0 left-[calc(5.5rem+0.75rem)] [--row:1.625rem] sm:left-[calc(8rem+0.75rem)] sm:[--row:1.875rem] short:[--row:1.625rem]">
							<div
								ref={head}
								className="absolute inset-y-[-4px] w-0.5 bg-fd-primary"
								style={{
									left: `calc(var(--p, 1) * 100%)`,
									opacity: playing ? 1 : 0,
								}}
							/>
							{tip !== null && (
								<Tooltip
									minute={tip}
									moments={happened.get(tip) ?? []}
								/>
							)}
						</div>
					</div>
					<div className="mt-2 grid grid-cols-[5.5rem_1fr] gap-3 text-xs text-buffer-dim sm:grid-cols-[8rem_1fr]">
						<span />
						{/* Each time sits at the start of its minute's column. */}
						<div className="relative h-4 tabular-nums">
							{[0, 15, 30, 45].map((m) => (
								<span
									key={m}
									className={`absolute ${m === 45 ? "max-sm:hidden" : ""}`}
									style={{ left: columnAt(m) }}
								>
									{clock(m)}
								</span>
							))}
							<span className="absolute right-0">{clock(REJECTED)}</span>
						</div>
					</div>
				</div>

				<p className="mt-4 max-w-[110ch] text-xs leading-relaxed text-buffer-dim">
					<span aria-hidden="true">{"// "}</span>Illustrative:{" "}
					<span
						aria-hidden="true"
						className="inline-block h-1.5 w-3 bg-buffer-blue align-middle sm:h-2"
					/>{" "}
					your app signs in with your backend, then from 09:00{" "}
					<span
						aria-hidden="true"
						className="inline-block h-1.5 w-3 bg-fd-primary align-middle sm:h-2"
					/>{" "}
					Session kit runs the session, until{" "}
					<span
						aria-hidden="true"
						className="inline-block h-1.5 w-3 bg-buffer-red align-middle sm:h-2"
					/>{" "}
					it ends. Access tokens last 15 minutes. With refresh, the page
					reloads at 09:20, a second tab opens at 09:31, and later the
					refresh token expires too.
				</p>
			</figure>
		</>
	);
}

/**
 * What happened at a lit moment, opening below the lowest lane it lit. At
 * each moment the lanes under it are empty or still ahead, so it never hides
 * the lit cells, the handover at 09:00 or the code above. It stays inside the
 * lanes' width, so near either end it shifts off centre. Phones run it across
 * the figure (6.25rem is the label column and its gap).
 */
function Tooltip({ minute, moments }: { minute: number; moments: Moment[] }) {
	const lowest = Math.max(...moments.map((moment) => moment.lane));
	const x = `${((minute + PRE + 0.5) / COLUMNS) * 100}%`;
	// Rows are a fixed height, so a lane's bottom is a multiple of --row.
	const below = `calc(${lowest + 1} * var(--row))`;
	return (
		<>
			{/* A tick from the cell's bottom, through the row's padding, down to
			    the tip. The tip sits above the axis times, which come later in
			    the page. */}
			<span
				className="absolute h-[11px] w-px bg-buffer-dim max-sm:hidden"
				style={{ left: x, top: `calc(${below} - 5px)` }}
			/>
			<div
				key={minute}
				className="absolute top-(--below) z-10 w-(--tip) border border-buffer-line bg-fd-popover px-3 py-2 text-xs leading-relaxed [--tip:calc(100%+6.25rem)] motion-safe:animate-[buffer-tip-in_160ms_ease-out] max-sm:-left-[6.25rem] sm:left-(--left) sm:[--tip:min(27rem,100%)]"
				style={
					{
						"--left": `clamp(0px, calc(${x} - var(--tip) / 2), calc(100% - var(--tip)))`,
						"--below": `calc(${below} + 0.375rem)`,
					} as CSSProperties
				}
			>
				<p className="text-fd-foreground tabular-nums">{clock(minute)}</p>
				{moments.map((moment) => (
					<p key={moment.lane} className="flex gap-x-3 max-sm:flex-col">
						<span className="shrink-0 text-buffer-dim sm:w-[12ch]">
							{moment.label ?? LANES[moment.lane]![0]}
						</span>
						<span className="text-fd-muted-foreground">
							{moment.text}
						</span>
					</p>
				))}
			</div>
		</>
	);
}

/**
 * The edit cursor on a line whose change is queued. It holds still when
 * motion is reduced.
 */
function Cursor() {
	return (
		<span
			aria-hidden="true"
			className="ms-1 inline-block h-[1.05em] w-[0.6ch] bg-fd-primary align-[-0.15em] motion-safe:animate-[buffer-blink_1s_linear_infinite]"
		/>
	);
}
