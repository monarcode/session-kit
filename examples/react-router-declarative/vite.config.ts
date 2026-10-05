import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	// session-kit is linked from the workspace: keep one copy of React and the router.
	resolve: { dedupe: ["react", "react-dom", "react-router"] },
});
