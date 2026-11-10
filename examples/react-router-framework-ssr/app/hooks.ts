import { createAuthHooks } from "@monarcode/session-kit/react";

import type { AppAuth } from "./auth/client";

export const { AuthProvider, useAuth, useAuthClient } =
	createAuthHooks<AppAuth>();
