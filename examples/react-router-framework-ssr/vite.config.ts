import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [reactRouter()],
	// session-kit is a workspace link: keep one copy of React and the router.
	resolve: { dedupe: ["react", "react-dom", "react-router"] },
});
