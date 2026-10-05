import { createStart } from "@tanstack/react-start";

// Auth lives in the browser: no route's guards or loaders run on a server,
// whichever server answers the request. The shell still prerenders.
export const startInstance = createStart(() => ({
	defaultSsr: false,
}));
