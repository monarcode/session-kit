import {
	index,
	layout,
	route,
	type RouteConfig,
} from "@react-router/dev/routes";

export default [
	route("login", "routes/login.tsx"),
	layout("routes/protected.tsx", [index("routes/home.tsx")]),
	// Resource routes the browser's client calls.
	route("auth/session", "routes/auth.session.ts"),
	route("auth/credentials", "routes/auth.credentials.ts"),
] satisfies RouteConfig;
