import { z } from "zod";
import {
	createRootRouteWithContext,
	createRouter,
} from "@tanstack/react-router";
import { createAuth, createRefreshFn } from "../dist/index.js";
import { connectAuth, useAuth, useAuthClient } from "../dist/react/index.js";
import { createAuthFetch } from "../dist/http/index.js";

const auth = createAuth({
	name: "type-test",
	userSchema: z.object({ id: z.string(), email: z.string() }),
	refresh: createRefreshFn(async () => ({ accessToken: "new-token" })),
});
const root = createRootRouteWithContext<{ auth: typeof auth }>()({});
const router = createRouter({ routeTree: root, context: { auth } });
declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

connectAuth(router);
createAuthFetch(auth, "https://api.example.com");

function Component() {
	const email: string | undefined = useAuth((state) => state.user?.email);
	const client = useAuthClient();
	const all = useAuth();
	// @ts-expect-error User fields come from the schema.
	useAuth((state) => state.user?.missing);
	// @ts-expect-error signIn requires schema-compatible user input.
	void client.signIn({ accessToken: "token", user: { id: 42 } });
	return { email, all };
}
void Component;

type IsAny<T> = 0 extends 1 & T ? true : false;
type AssertFalse<T extends false> = T;
export type ClientMustNotBeAny = AssertFalse<
	IsAny<ReturnType<typeof useAuthClient>>
>;
type State = ReturnType<ReturnType<typeof useAuthClient>["state"]["get"]>;
export type UserMustNotBeAny = AssertFalse<IsAny<State["user"]>>;
const wrongRefresh = createRefreshFn(async () => ({
	accessToken: "token",
	user: { id: 42 },
}));
createAuth({
	name: "bad",
	userSchema: z.object({ id: z.string() }),
	// @ts-expect-error Refresh results must match the schema input.
	refresh: wrongRefresh,
});
