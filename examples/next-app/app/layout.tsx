import type { ReactNode } from "react";

import { getSession } from "../lib/auth/session";
import { Providers } from "./providers";

export const metadata = { title: "session-kit with Next.js" };

export default async function RootLayout({
	children,
}: {
	children: ReactNode;
}) {
	const session = await getSession();
	return (
		<html lang="en">
			<body>
				<Providers session={session}>{children}</Providers>
			</body>
		</html>
	);
}
