import { useState } from "react";
import { Button, Text, TextInput, View } from "react-native";

import { signInWithPassword } from "../src/auth";

export default function Login() {
	// DummyJSON's documented test user.
	const [username, setUsername] = useState("emilys");
	const [password, setPassword] = useState("emilyspass");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	async function submit() {
		setError("");
		setBusy(true);
		try {
			await signInWithPassword(username, password);
			// No navigation here. Once signed in, Stack.Protected leaves this
			// screen, and SessionGate opens the deep link the user was headed to.
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not sign in");
		} finally {
			setBusy(false);
		}
	}

	return (
		<View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 12 }}>
			<Text accessibilityRole="header">Sign in</Text>
			<TextInput
				accessibilityLabel="Username"
				value={username}
				onChangeText={setUsername}
				autoCapitalize="none"
				autoComplete="username"
			/>
			<TextInput
				accessibilityLabel="Password"
				value={password}
				onChangeText={setPassword}
				secureTextEntry
				autoComplete="current-password"
			/>
			{error ? <Text accessibilityRole="alert">{error}</Text> : null}
			<Button
				title="Sign in"
				onPress={() => void submit()}
				disabled={busy}
			/>
		</View>
	);
}
