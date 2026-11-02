import { Button, Text, View } from "react-native";

import type { UnavailableProps } from "@monarcode/session-kit/expo";

import { auth } from "./auth";

/**
 * Shown instead of the app when the session exists but can't be used: a
 * refresh failed (often offline), or the keychain couldn't be read.
 */
export function Unavailable({ error, retry }: UnavailableProps) {
	return (
		<View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 12 }}>
			<Text accessibilityRole="header">Can't reach your account</Text>
			<Text>{error?.message ?? "Check your connection and try again."}</Text>
			<Button title="Try again" onPress={retry} />
			{/* Works offline: it clears the session on this device. */}
			<Button
				title="Sign out"
				onPress={() => void auth.signOut().catch(() => {})}
			/>
		</View>
	);
}
