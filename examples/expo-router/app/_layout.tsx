import { SessionGate } from "@monarcode/session-kit/expo";
import { SplashScreen, Stack } from "expo-router";

import { auth, AuthProvider, useAuth } from "../src/auth";
import { Unavailable } from "../src/unavailable";

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
	// `user` is set exactly while authenticated or refreshing.
	const signedIn = useAuth((state) => state.user !== null);
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
