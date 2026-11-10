import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	// SPA mode: no server rendering; the build prerenders only an HTML shell.
	plugins: [tanstackStart({ spa: { enabled: true } }), react()],
	// session-kit is a workspace link: keep one copy of React, the router and
	// Effect.
	resolve: {
		dedupe: [
			"react",
			"react-dom",
			"@tanstack/react-router",
			"effect",
			"@monarcode/effetch",
			"@monarcode/effetch-query",
			"@effect/atom-react",
		],
	},
});
