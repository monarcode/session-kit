import { Button, Text, View } from "react-native";

import { useAuth, useAuthClient } from "@monarcode/session-kit/react";
import { Link } from "expo-router";

export default function Home() {
	const firstName = useAuth((state) => state.user?.firstName);
	const auth = useAuthClient();
	return (
		<View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 12 }}>
			<Text accessibilityRole="header">Welcome, {firstName}</Text>
			<Link href="/profile">Profile</Link>
			{/* No navigation: Stack.Protected then shows the sign-in screen. */}
			<Button
				title="Sign out"
				onPress={() => void auth.signOut().catch(() => {})}
			/>
		</View>
	);
}
