import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { RootProvider } from "fumadocs-ui/provider/tanstack";

import SearchDialog from "@/components/search";

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
				title: "session-kit",
			},
		],
		links: [{ rel: "stylesheet", href: appCss }],
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
