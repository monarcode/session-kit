import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installedAtLeast } from "./docs-pages.mjs";

// The CI job for the oldest supported peers installs React Router 7.0, which
// `./react-router` supports and `./react-router/server` doesn't: its
// middleware needs 7.9.
if (!installedAtLeast("react-router", "7.9")) {
	console.log(
		"- tests/react-router-middleware.ts skipped: it needs react-router 7.9 or later",
	);
} else {
	const tsc = fileURLToPath(
		new URL("../node_modules/typescript/bin/tsc", import.meta.url),
	);
	for (const project of [
		"tests/tsconfig.react-router-middleware.json",
		"tests/tsconfig.react-router-middleware.bundler.json",
	])
		execFileSync(process.execPath, [tsc, "-p", project], {
			stdio: "inherit",
		});
}
