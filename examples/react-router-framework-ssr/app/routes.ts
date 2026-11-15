import {
	index,
	layout,
	route,
	type RouteConfig,
} from "@react-router/dev/routes";

export default [
	route("login", "routes/login.tsx"),
	layout("routes/protected.tsx", [index("routes/home.tsx")]),
	// The session route the browser's client calls.
	route("auth/session", "routes/auth.session.ts"),
] satisfies RouteConfig;
