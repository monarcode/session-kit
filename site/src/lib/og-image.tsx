/**
 * The link-preview images, drawn with Takumi in the landing page's world: a
 * code buffer in Geist Mono on ink, headings set as comments behind a dim
 * `//`, prose in Geist, and lime only for the mark. Import it from server
 * code only.
 */
import type { ReactNode } from "react";

import geistMonoExt from "@fontsource-variable/geist-mono/files/geist-mono-latin-ext-wght-normal.woff2?inline";
import geistMono from "@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?inline";
import geistExt from "@fontsource-variable/geist/files/geist-latin-ext-wght-normal.woff2?inline";
import geist from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?inline";
import { render } from "takumi-js";

import { SETUPS } from "@/components/landing/setups";
import {
	BRACE_PATH,
	DOT_PATH,
	LOGO_VIEW_BOX,
	NAME_PATH,
} from "@/components/logo";

import { IMAGE_AS_BASE64, OG_SIZE } from "./og";
import { SITE_URL, TAGLINE } from "./shared";

// The site's tokens, from `site/DESIGN.md`.
const INK = "#16171d";
const LIME = "#d5f70d";
const FOREGROUND = "#e8e9ee";
const MUTED = "#9a9ca8";
const COMMENT = "#7f828e";
const HAIRLINE = "#262833";

/** The bytes of a font Vite inlined as a data URL. */
const fontData = (dataUrl: string) =>
	Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(",") + 1)), (c) =>
		c.charCodeAt(0),
	);

/**
 * Geist and Geist Mono, every weight, each with its Latin Extended subset
 * as the fallback for the accented letters the Latin one lacks.
 */
const FONTS = [
	{ name: "Geist Variable", data: fontData(geist) },
	{ name: "Geist Ext", data: fontData(geistExt) },
	{ name: "Geist Mono Variable", data: fontData(geistMono) },
	{ name: "Geist Mono Ext", data: fontData(geistMonoExt) },
];

const SANS = "Geist Variable, Geist Ext";
const MONO = { fontFamily: "Geist Mono Variable, Geist Mono Ext" } as const;

/** The site's host, as a reader would type it. */
const HOST = SITE_URL.replace(/^https?:\/\//, "");

/**
 * The libraries the home image names, from the landing page's setups. React
 * Router's server rendering is React Router again, so each is named once.
 */
const LIBRARIES = SETUPS.filter(([, entry]) => !entry.endsWith("/server")).map(
	([name]) => name,
);

/**
 * How many characters of mono note fit across the foot. A URL that leaves
 * no room for the tagline beside it takes the whole line.
 */
const FOOT_ROOM = 76;

/**
 * The longest text each part of an image has room for: two lines of title
 * at its smallest size and three of description, both measured by drawing
 * text of exactly this length, then a section label beside the wordmark and
 * a headline comment on one line, worked out from Geist Mono's width.
 */
export const TITLE_ROOM = 52;
export const DESCRIPTION_ROOM = 160;
const SECTION_ROOM = 50;
const HEADLINE_ROOM = 37;

/**
 * The characters the images can draw. Geist's Latin and Latin Extended
 * files cover these; a character outside them would be drawn as a box.
 */
const DRAWABLE =
	/^[\u0020-\u007e\u00a0-\u017f\u2013\u2014\u2018\u2019\u201c\u201d\u2026]$/u;

/**
 * Fails the build on text an image can't draw as it is: longer than its
 * room, or with a character the fonts lack. Either would ship unseen.
 */
function checkText(text: string, room: number, what: string) {
	if (text.length > room)
		throw new Error(
			`${what} is ${text.length} characters, and its link-preview image has room for ${room}: "${text}"`,
		);
	const missing = [...text].find((char) => !DRAWABLE.test(char));
	if (missing)
		throw new Error(
			`${what} has "${missing}" (U+${missing.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}), which its link-preview image's fonts can't draw: "${text}"`,
		);
}

/** The wordmark: the lime mark, and the name in the text colour. */
function Wordmark({ height }: { height: number }) {
	const [, , width, tall] = LOGO_VIEW_BOX.split(" ").map(Number);
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox={LOGO_VIEW_BOX}
			width={(height * width!) / tall!}
			height={height}
		>
			<path fill={LIME} d={BRACE_PATH} />
			<path fill={LIME} d={DOT_PATH} />
			<path fill={FOREGROUND} d={NAME_PATH} />
		</svg>
	);
}

/** A heading set as a comment: a dim `//`, then the text. */
function Comment({ children }: { children: ReactNode }) {
	return (
		<>
			<span style={{ color: COMMENT, fontWeight: 300 }}>{"// "}</span>
			{children}
		</>
	);
}

/**
 * The frame every image shares: the wordmark and a mono label across the
 * top, the content at the foot of the space, and a hairline over two mono
 * notes.
 */
function Frame({
	label,
	foot,
	children,
}: {
	label?: string | undefined;
	foot: [string, string | undefined];
	children: ReactNode;
}) {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width: "100%",
				height: "100%",
				padding: "60px 72px 56px",
				backgroundColor: INK,
				color: FOREGROUND,
				fontFamily: SANS,
				fontWeight: 400,
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<Wordmark height={44} />
				{label && (
					<span style={{ ...MONO, fontSize: 22, color: COMMENT }}>
						{label}
					</span>
				)}
			</div>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					flexGrow: 1,
					justifyContent: "flex-end",
				}}
			>
				{children}
			</div>
			<div
				style={{
					...MONO,
					display: "flex",
					justifyContent: "space-between",
					marginTop: 44,
					paddingTop: 22,
					borderTop: `2px solid ${HAIRLINE}`,
					fontSize: 22,
					color: COMMENT,
				}}
			>
				<span>{foot[0]}</span>
				{foot[1] && <span>{foot[1]}</span>}
			</div>
		</div>
	);
}

/**
 * A docs page's image: where it sits in the docs, its title set as a
 * comment, as the page sets it, and its description.
 */
export function DocsImage({
	section,
	title,
	description,
	path,
}: {
	section: string;
	title: string;
	description: string;
	path: string;
}) {
	const url = `${HOST}${path}`;
	checkText(title, TITLE_ROOM, `${path}: the title`);
	checkText(description, DESCRIPTION_ROOM, `${path}: the description`);
	checkText(section, SECTION_ROOM, `${path}: its place in the sidebar`);
	checkText(url, FOOT_ROOM, `${path}: the URL`);
	const foot = url.length + TAGLINE.length + 4 <= FOOT_ROOM;
	// Short titles set larger, so one word doesn't sit small in the frame.
	const size = title.length <= 20 ? 76 : title.length <= 34 ? 62 : 52;
	return (
		<Frame label={section} foot={[url, foot ? TAGLINE : undefined]}>
			<div
				style={{
					...MONO,
					fontSize: size,
					fontWeight: 600,
					letterSpacing: "-0.04em",
					lineHeight: 1.1,
				}}
			>
				<Comment>{title}</Comment>
			</div>
			{description && (
				<div
					style={{
						marginTop: 28,
						maxWidth: 1000,
						fontSize: 30,
						lineHeight: 1.4,
						color: MUTED,
					}}
				>
					{description}
				</div>
			)}
		</Frame>
	);
}

/**
 * The home image's headline, two comments: what Session kit keeps, then
 * what it does with it. The landing page's hero has its own pitch.
 */
const HEADLINE = [
	"Sessions, defined by a schema.",
	"Restored, refreshed and synced.",
] as const;

/**
 * The home page's image: the headline, a quiet line and a bold one, over
 * the libraries it supports.
 */
export function HomeImage() {
	for (const line of HEADLINE)
		checkText(line, HEADLINE_ROOM, "The home image's headline");
	return (
		<Frame foot={[HOST, TAGLINE]}>
			<div
				style={{
					...MONO,
					display: "flex",
					flexDirection: "column",
					// Each comment on one line.
					fontSize: 46,
					letterSpacing: "-0.04em",
					lineHeight: 1.2,
				}}
			>
				<span style={{ fontWeight: 300, color: MUTED }}>
					<Comment>{HEADLINE[0]}</Comment>
				</span>
				<span style={{ fontWeight: 700 }}>
					<Comment>{HEADLINE[1]}</Comment>
				</span>
			</div>
			<div
				style={{
					...MONO,
					display: "flex",
					flexWrap: "wrap",
					columnGap: 22,
					rowGap: 8,
					marginTop: 40,
					fontSize: 22,
					color: MUTED,
				}}
			>
				{LIBRARIES.map((name) => (
					<span key={name}>{name}</span>
				))}
			</div>
		</Frame>
	);
}

/**
 * The home-screen icon: the mark on ink, placed as `favicon.svg` places
 * it.
 */
export function TouchIcon() {
	return (
		<div
			style={{
				display: "flex",
				width: "100%",
				height: "100%",
				backgroundColor: INK,
			}}
		>
			{/* The favicon's square around the mark, in the logo's units. */}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="-123.5 -39.8 636 636"
				width="100%"
				height="100%"
			>
				<path fill={LIME} d={BRACE_PATH} />
				<path fill={LIME} d={DOT_PATH} />
			</svg>
		</div>
	);
}

/**
 * Draws an image as a PNG response, or, for the prerender, as base64 text
 * (see {@link IMAGE_AS_BASE64}). Link previews by default.
 */
export async function imageResponse(
	element: ReactNode,
	request: Request,
	size: { width: number; height: number } = OG_SIZE,
): Promise<Response> {
	const image = await render(element, {
		...size,
		format: "png",
		fonts: FONTS,
		// Drawn from the fonts, so a build never fetches emoji images.
		emoji: "from-font",
	});
	if (request.headers.has(IMAGE_AS_BASE64)) {
		let binary = "";
		for (const byte of image) binary += String.fromCharCode(byte);
		return new Response(btoa(binary), {
			headers: { "Content-Type": "text/plain; charset=utf-8" },
		});
	}
	return new Response(image, {
		headers: { "Content-Type": "image/png" },
	});
}
