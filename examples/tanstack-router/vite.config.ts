import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		tanstackRouter({ target: "react", autoCodeSplitting: true }),
		react(),
	],
	// session-kit is linked from the workspace: keep one copy of React and the router.
	resolve: { dedupe: ["react", "react-dom", "@tanstack/react-router"] },
});
