import { createAuthHooks } from "@monarcode/session-kit/react";

import type { auth } from "./auth";

export const { AuthProvider, useAuth, useAuthClient } =
	createAuthHooks<typeof auth>();
