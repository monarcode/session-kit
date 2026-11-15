import type { ReactNode } from "react";

import { session } from "../lib/auth/session";
import { Providers } from "./providers";

export const metadata = { title: "session-kit with Next.js" };

export default async function RootLayout({
	children,
}: {
	children: ReactNode;
}) {
	const current = await session.get();
	return (
		<html lang="en">
			<body>
				<Providers session={current}>{children}</Providers>
			</body>
		</html>
	);
}
