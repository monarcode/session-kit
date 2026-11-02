import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { z } from "zod";

import { authFetch, userSchema } from "../../src/auth";

const profileSchema = userSchema.extend({
	lastName: z.string(),
	gender: z.string(),
});

export default function Profile() {
	const [profile, setProfile] = useState<z.infer<typeof profileSchema>>();
	const [error, setError] = useState("");

	useEffect(() => {
		const controller = new AbortController();
		// Attaches the access token. After a 401 it refreshes and replays the GET once.
		authFetch("auth/me", { signal: controller.signal })
			.then(async (response) => {
				if (!response.ok)
					throw new Error(`Profile failed (${response.status})`);
				setProfile(profileSchema.parse(await response.json()));
			})
			.catch((cause: unknown) => {
				if (controller.signal.aborted) return;
				setError(cause instanceof Error ? cause.message : "Could not load");
			});
		return () => controller.abort();
	}, []);

	if (error) return <Text accessibilityRole="alert">{error}</Text>;
	if (!profile) return <Text>Loading…</Text>;
	return (
		<View style={{ padding: 24, gap: 8 }}>
			<Text accessibilityRole="header">
				{profile.firstName} {profile.lastName}
			</Text>
			<Text>{profile.email}</Text>
			<Text>{profile.gender}</Text>
		</View>
	);
}
