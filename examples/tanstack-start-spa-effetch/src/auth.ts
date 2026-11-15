import {
	createAuth,
	fromAccessToken,
	webStorage,
} from "@monarcode/session-kit";
import * as Schema from "effect/Schema";

import { SessionUser } from "./backend";
import { refreshSession } from "./refresh";

export const auth = createAuth({
	name: "session-kit-example",
	user: fromAccessToken(Schema.toStandardSchemaV1(SessionUser)),
	storage: webStorage(),
	refresh: ({ refreshToken, signal }) => refreshSession(refreshToken, signal),
});

// Registered once, so every `Auth` Effect, and the hooks, carry this
// client's user.
declare module "@monarcode/session-kit" {
	interface Register {
		auth: typeof auth;
	}
}
