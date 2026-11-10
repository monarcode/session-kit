import { createStart } from "@tanstack/react-start";

// The session lives in browser storage, so guards and loaders must run in the
// browser, even when Start's server answers the request. The shell still
// prerenders.
export const startInstance = createStart(() => ({
	defaultSsr: false,
}));
