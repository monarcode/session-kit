import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { RootProvider } from "fumadocs-ui/provider/tanstack";

import SearchDialog from "@/components/search";
import { SITE_URL } from "@/lib/shared";

import appCss from "@/styles/app.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "Session kit",
			},
			// The image a link to any page shows when shared.
			{ property: "og:type", content: "website" },
			{ property: "og:site_name", content: "Session kit" },
			{ property: "og:image", content: `${SITE_URL}/og.png` },
			{ property: "og:image:width", content: "1200" },
			{ property: "og:image:height", content: "630" },
			{ name: "twitter:card", content: "summary_large_image" },
			{ name: "twitter:image", content: `${SITE_URL}/og.png` },
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
			{ rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
		],
	}),
	component: RootComponent,
});

function RootComponent() {
	return (
		// Dark only: the class is in the prerendered HTML, so no page flashes
		// light before the theme script runs.
		<html
			lang="en"
			className="dark"
			style={{ colorScheme: "dark" }}
			suppressHydrationWarning
		>
			<head>
				<HeadContent />
			</head>
			<body className="flex flex-col min-h-screen">
				<RootProvider
					search={{ SearchDialog }}
					theme={{
						forcedTheme: "dark",
						enableSystem: false,
						hotKey: false,
					}}
				>
					<Outlet />
				</RootProvider>
				<Scripts />
			</body>
		</html>
	);
}
