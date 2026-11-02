import { Button, Text, View } from "react-native";

import { Link } from "expo-router";

import { useAuth, useAuthClient } from "../../src/auth";

export default function Home() {
	const firstName = useAuth((state) => state.user?.firstName);
	const auth = useAuthClient();
	return (
		<View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 12 }}>
			<Text accessibilityRole="header">Welcome, {firstName}</Text>
			<Link href="/profile">Profile</Link>
			{/* Stack.Protected then removes this screen and shows the sign-in screen. */}
			<Button
				title="Sign out"
				onPress={() => void auth.signOut().catch(() => {})}
			/>
		</View>
	);
}
