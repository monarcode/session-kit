import { createAuthHooks } from "@monarcode/session-kit/react";
import { useRouterAuth } from "@monarcode/session-kit/tanstack-router";

// Reads the client from Router context, so no provider is needed.
export const { useAuth, useAuthClient } = createAuthHooks({
	useClient: useRouterAuth,
});
