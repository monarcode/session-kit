import { SessionGate } from "@monarcode/session-kit/expo";
import { AuthProvider, useAuth } from "@monarcode/session-kit/react";
import { SplashScreen, Stack } from "expo-router";

import { auth } from "../src/auth";
import { Unavailable } from "../src/unavailable";

// Types `AuthProvider` and the hooks from `@monarcode/session-kit/react`
// with this client.
declare module "@monarcode/session-kit" {
	interface Register {
		auth: typeof auth;
	}
}

// Keeps the splash screen up until SessionGate hides it.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
	return (
		<AuthProvider client={auth}>
			<SessionGate unavailable={(props) => <Unavailable {...props} />}>
				<RootStack />
			</SessionGate>
		</AuthProvider>
	);
}

function RootStack() {
	// Check `status`, not `user`: a locked session keeps its user. SessionGate
	// handles `initializing` and `unavailable` before this renders.
	const signedIn = useAuth(
		(state) =>
			state.status === "authenticated" || state.status === "refreshing",
	);
	return (
		<Stack screenOptions={{ headerShown: false }}>
			<Stack.Protected guard={signedIn}>
				<Stack.Screen name="(app)" />
			</Stack.Protected>
			<Stack.Protected guard={!signedIn}>
				<Stack.Screen name="login" />
			</Stack.Protected>
		</Stack>
	);
}
