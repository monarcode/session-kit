# Expo Router

session-kit runs in Expo Router apps on iOS and Android. It saves the session
in the iOS keychain or Android Keystore-encrypted storage, holds the splash
screen while the session is restored, re-checks the session when the app
returns to the foreground, and opens a deep link after the sign-in that it was
waiting on. Expo Router's `Stack.Protected` does the guarding.

This guide builds the [`expo-router` example app](../examples/expo-router),
which signs in against [DummyJSON's auth API](https://dummyjson.com/docs/auth),
so it runs as written. Read the [README](../README.md) first for how the
client, refresh, and errors work; this guide covers what differs on Expo.

## Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [1. Create the client](#1-create-the-client)
- [2. Gate the root layout](#2-gate-the-root-layout)
- [3. Keep deep links](#3-keep-deep-links)
- [4. Add the sign-in screen](#4-add-the-sign-in-screen)
- [5. Add the signed-in screens](#5-add-the-signed-in-screens)
- [6. Show unavailable access](#6-show-unavailable-access)
- [Secure storage](#secure-storage)
- [SessionGate](#sessiongate)
- [Deep links](#deep-links)
- [Debugging](#debugging)
- [Locking](#locking)
- [Not supported](#not-supported)

## Requirements

- Expo SDK 53 or newer: Expo Router 5 or newer, and React Native 0.79 or
  newer.
- iOS and Android only. Expo web is not supported: on the web, use a
  [web router setup](../README.md#supported-setups) with `webStorage()`.
- Expo Go, which includes `expo-secure-store` and `expo-file-system`, or a
  development build with both installed.

## Installation

Install the package, its Expo peers, and a schema library. `npx expo install`
picks the peer versions that match your SDK:

```sh
npx expo install @monarcode/session-kit expo-secure-store expo-file-system zod
```

An Expo Router app already has `expo-router` and `react-native`. Add the
`expo-secure-store` config plugin to `app.json`, so Android Auto Backup leaves
the session out of backups:

```json
{
  "expo": {
    "scheme": "myapp",
    "plugins": ["expo-router", "expo-secure-store"]
  }
}
```

`scheme` is what custom-scheme deep links such as `myapp://profile` use.

## 1. Create the client

`secureStorage()` replaces `webStorage()`; the rest of the client is the same
as on the web.

<!-- file: src/auth.ts -->

```ts
import { createAuth } from "@monarcode/session-kit";
import { secureStorage } from "@monarcode/session-kit/expo";
import { createAuthFetch } from "@monarcode/session-kit/http";
import { createAuthHooks } from "@monarcode/session-kit/react";
import { z } from "zod";

const API = "https://dummyjson.com";

export const userSchema = z.object({
  id: z.number(),
  username: z.string(),
  email: z.string(),
  firstName: z.string(),
});

const tokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
const loginResponseSchema = tokensSchema.extend(userSchema.shape);

export const auth = createAuth({
  name: "my-app",
  user: userSchema,
  storage: secureStorage(),
  refresh: async ({ refreshToken, signal }) => {
    const response = await fetch(`${API}/auth/refresh`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    // DummyJSON answers 401 or 403 when the refresh token is no good.
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw new Error(`Refresh failed (${response.status})`);
    return tokensSchema.parse(await response.json());
  },
});

export const { AuthProvider, useAuth, useAuthClient } =
  createAuthHooks<typeof auth>();

export const authFetch = createAuthFetch(auth, `${API}/`);

export async function signInWithPassword(username: string, password: string) {
  const response = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(`Sign-in failed (${response.status})`);
  const { accessToken, refreshToken, ...user } = loginResponseSchema.parse(
    await response.json(),
  );
  await auth.signIn({ accessToken, refreshToken, user });
}
```

## 2. Gate the root layout

`SessionGate` goes inside `AuthProvider`, around the root navigator. Guard the
screens with `Stack.Protected`: signed-in users see the `(app)` group, and
everyone else sees `login`.

<!-- file: app/_layout.tsx -->

```tsx
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
  // `status`, not `user`: a locked session keeps its user. See Locking.
  const status = useAuth((state) => state.status);
  const signedIn = status === "authenticated" || status === "refreshing";
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
```

`RootStack` is its own component so that `useAuth` runs inside
`AuthProvider`. The navigator mounts only once the session is restored, so the
guards never see `initializing`.

If the first screen needs more than the session, such as fonts, pass `ready`:
the splash screen then stays up until both are done.

```tsx
const [fontsLoaded] = useFonts(fonts);

<SessionGate
  ready={fontsLoaded}
  unavailable={(props) => <Unavailable {...props} />}
>
  <RootStack />
</SessionGate>;
```

## 3. Keep deep links

`Stack.Protected` sends a link to a guarded screen to the first screen the
user may see, so a signed-out user who opens `myapp://profile` lands on the
sign-in screen and the link is lost. `rememberDeepLink` keeps it, and
`SessionGate` opens it after the sign-in. Expo Router calls
`redirectSystemPath` with every URL that opens the app, before routing:

<!-- file: app/+native-intent.tsx -->

```tsx
import { rememberDeepLink } from "@monarcode/session-kit/expo";

import { auth } from "../src/auth";

export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}) {
  rememberDeepLink(auth, path);
  return path;
}
```

Return `path` unchanged: the link still goes to Expo Router, which shows it
right away when the user is signed in.

## 4. Add the sign-in screen

<!-- file: app/login.tsx -->

```tsx
import { useState } from "react";
import { Button, Text, TextInput, View } from "react-native";

import { signInWithPassword } from "../src/auth";

export default function Login() {
  // DummyJSON's documented test user.
  const [username, setUsername] = useState("emilys");
  const [password, setPassword] = useState("emilyspass");
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    try {
      await signInWithPassword(username, password);
      // No navigation: Stack.Protected leaves this screen, and
      // SessionGate opens the deep link the user was headed to.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in");
    }
  }

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 12 }}>
      <TextInput
        accessibilityLabel="Username"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
      />
      <TextInput
        accessibilityLabel="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      <Button title="Sign in" onPress={() => void submit()} />
    </View>
  );
}
```

Don't navigate after `signIn`. Once the user is signed in, `Stack.Protected`
removes the sign-in screen, and a `router.replace` of your own would race the
deep link `SessionGate` opens.

## 5. Add the signed-in screens

Screens inside the guarded group read the user with `useAuth`, and call the
API with `authFetch`, which attaches the access token and refreshes after a 401.

<!-- file: app/(app)/_layout.tsx -->

```tsx
import { Stack } from "expo-router";

export default function AppLayout() {
  return <Stack />;
}
```

<!-- file: app/(app)/index.tsx -->

```tsx
import { useEffect, useState } from "react";
import { Button, Text, View } from "react-native";

import { authFetch, useAuth, useAuthClient } from "../../src/auth";

export default function Home() {
  const firstName = useAuth((state) => state.user?.firstName);
  const auth = useAuthClient();
  const [email, setEmail] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    authFetch("auth/me", { signal: controller.signal })
      .then((response) => response.json())
      .then((body: { email: string }) => setEmail(body.email))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 12 }}>
      <Text accessibilityRole="header">Welcome, {firstName}</Text>
      <Text>{email}</Text>
      {/* Stack.Protected then shows the sign-in screen. */}
      <Button
        title="Sign out"
        onPress={() => void auth.signOut().catch(() => {})}
      />
    </View>
  );
}
```

## 6. Show unavailable access

Access is `unavailable` when the session exists but can't be used: a refresh
failed, often because the device is offline, or the keychain couldn't be
read. `SessionGate` then renders `unavailable` instead of the navigator:

<!-- file: src/unavailable.tsx -->

```tsx
import { Button, Text, View } from "react-native";

import type { UnavailableProps } from "@monarcode/session-kit/expo";

import { auth } from "./auth";

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
```

Without `unavailable`, `SessionGate` hides the splash screen and throws the
error to the root layout's `ErrorBoundary`. The boundary's `retry` only
renders again, and a failed refresh stays failed until `auth.retry()`, so
have the boundary call both.

## Secure storage

`secureStorage()` saves the session with `expo-secure-store`: in the iOS
keychain, and encrypted with an Android Keystore key.

| Option               | Default | Meaning                                                                         |
| -------------------- | ------- | ------------------------------------------------------------------------------- |
| `clearOnReinstall`   | `true`  | Remove a session an earlier install left in the iOS keychain before reading it. |
| `keychainAccessible` | None    | When iOS lets the app read the session, passed to SecureStore unchanged.        |

- **Large sessions.** Two JWTs and a user often exceed SecureStore's
  2048-byte value limit, so longer values are split across keys. The new value
  replaces the old one only once every piece is written, so an app killed
  mid-write keeps the previous session whole.
- **Synchronous reads.** With a synchronous user schema, the session is
  restored before the first frame. Writes and removals are asynchronous, and
  applied in order.
- **Reinstalls.** iOS keeps keychain items after the app is deleted. A marker
  file in the app's documents directory, which deleting the app removes, tells
  a fresh install apart, so by default a reinstalled app starts signed out.
  `clearOnReinstall: false` restores the old session instead. Android removes
  the data with the app either way.
- **Locked keychain.** SecureStore's default `keychainAccessible` is
  `WHEN_UNLOCKED`. While the keychain can't be read, the session is
  `unavailable`, never signed out. An app that refreshes in a background task
  before the device's first unlock needs
  `keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK`.
- **Android backups.** Data Android can't decrypt, as after Auto Backup
  restores it onto another device, reads as signed out and is removed. The
  `expo-secure-store` config plugin keeps the session out of backups in the
  first place.
- **One context.** An app has one JavaScript context, so there are no tabs to
  follow and no refresh lock: one refresh runs at a time in the client itself.

## SessionGate

`SessionGate` adds what `Stack.Protected` lacks:

- **While the session is restored**, and until `ready` is `true`, it renders
  nothing, so the splash screen stays up, then hides the splash screen. Call
  `SplashScreen.preventAutoHideAsync()` at the top of the root layout, or the
  splash screen hides before the session is restored. The navigator mounts
  only then, so a cold-start deep link isn't sent to the sign-in screen
  first. `ready` defaults to `true`, and counts only until the splash screen
  is first hidden: setting it to `false` later changes nothing on screen.
- **While access is unavailable** it renders `unavailable({ error, retry })`
  instead of the navigator.
- **When the app returns to the foreground** it re-checks the session, because
  timers don't run while iOS suspends the app. An access token that expired in
  the background is refreshed then.
- **While locked** it renders the navigator, so your guards can show an
  unlock screen. Neither unlocking nor a password sign-in from the lock
  screen remounts the navigator.
- **When one account replaces another** without a sign-out between them, it
  remounts the navigator, so no screen keeps the previous account's component
  state. The screens that were open stay open, as the URL does on the web. A
  sign-out already removes the guarded screens.

It takes the nearest `AuthProvider`'s client, or a `client` prop, and mounts
it, so it also works without `AuthProvider`.

## Deep links

`rememberDeepLink(auth, path)` keeps the link for later, and `SessionGate`
decides what to do with it:

- Signed in already: the link is dropped, and Expo Router opens it as usual.
- Signed out: once the user signs in, and `ready` is `true`, `SessionGate`
  opens it with `router.replace`.
- Locked: the same, once the user unlocks or signs in with a password.
- A link to a screen anyone may see, such as the sign-in screen, is dropped
  once it is shown. If the app launched with it, it is dropped at the sign-in
  instead, unopened, since the screen was already showing.

Links are checked with `safeReturnTo`, so the root, the sign-in path, and
anything that could leave the app are ignored. Pass
`rememberDeepLink(auth, path, { loginPath: "/sign-in" })` if your sign-in
screen isn't `/login`. A newer link replaces an older one.

There is no `?redirectTo=` parameter on Expo: the link waits in memory, not in
the URL, and an app restart forgets it.

## Debugging

Turn on the client's `debug` option to see what session-kit does in Metro's
logs: restores, refreshes and why they ran, timers, storage operations, state
changes, and why a session ended.

```ts
export const auth = createAuth({
  // ...
  debug: __DEV__,
});
```

`SessionGate` and deep links report through the same option: why the splash
screen is held (restoring, or waiting for `ready`), when it hides, and what
happened to a remembered link. `secureStorage()` adds what only it can see,
such as removing a session an earlier install left, or discarding data
Android can't decrypt.

Events leave out tokens, saved values, user fields, deep links' query strings,
and errors' causes. `debug: { sensitive: true }` puts them in, so keep it to development
builds. A function, `debug: (event) => ...` or `debug: { log }`, receives each
event instead of the console, for example to add Sentry breadcrumbs.

## Locking

A returning user can be asked to unlock before the app opens: a
"Welcome back" screen with Face ID, Touch ID, or a fingerprint, and the
password as a fallback. With `locking`, a saved session restores as `locked`,
with `user` and `sessionId` set and its tokens sealed by a key your app holds.
The [README](../README.md#locking) covers the behaviour; this is the Expo
side.

Keep a random key in a SecureStore item that needs biometrics to read, and
seal the tokens with AES-GCM. This example uses `@noble/ciphers` and
`expo-crypto`, your app's dependencies, not session-kit's:

<!-- file: src/session-key.ts -->

```ts
import type { AuthLocking } from "@monarcode/session-kit";
import { gcm } from "@noble/ciphers/aes.js";
import {
  bytesToHex,
  bytesToUtf8,
  hexToBytes,
  utf8ToBytes,
} from "@noble/ciphers/utils.js";
import { getRandomBytes } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const KEY_ITEM = "session-key";
// Whether the key needs biometrics: it must be read the way it was saved.
const BIOMETRIC_ITEM = "session-key-biometric";

function keyOptions(biometric: boolean): SecureStore.SecureStoreOptions {
  return biometric
    ? {
        requireAuthentication: true,
        authenticationPrompt: "Unlock your account",
      }
    : {};
}

// In memory from an unlock or a password sign-in until the app locks.
let key: Uint8Array | undefined;

/**
 * Saves the key behind the device's biometrics, or, on a device with none
 * enrolled, without them. On Android, saving shows the prompt.
 */
async function saveKey(next: Uint8Array): Promise<void> {
  const biometric = SecureStore.canUseBiometricAuthentication();
  await SecureStore.setItemAsync(
    KEY_ITEM,
    bytesToHex(next),
    keyOptions(biometric),
  );
  await SecureStore.setItemAsync(BIOMETRIC_ITEM, String(biometric));
}

/** Reads the key, which shows the prompt when it needs biometrics. */
async function readKey(): Promise<string | null> {
  const biometric = await SecureStore.getItemAsync(BIOMETRIC_ITEM);
  if (biometric === null) return null;
  return SecureStore.getItemAsync(KEY_ITEM, keyOptions(biometric === "true"));
}

/**
 * Loads the key to unlock. Throws when the user cancels the prompt, or when
 * the device's biometrics changed and the key can't be read.
 */
export async function loadKey(): Promise<void> {
  const saved = await readKey();
  if (saved) {
    key = hexToBytes(saved);
    return;
  }
  // A session saved before locking was added has no key yet. Make one: on
  // iOS, saving doesn't prompt, so read it back to show the prompt.
  const next = getRandomBytes(32);
  await saveKey(next);
  if (Platform.OS === "ios" && !(await readKey()))
    throw new Error("Could not read the new session key");
  key = next;
}

/**
 * Signs in with a new key, and saves it only once the sign-in succeeds: a
 * failed sign-in keeps the key that the saved session is sealed with.
 */
export async function withNewKey<T>(signIn: () => Promise<T>): Promise<T> {
  const previous = key;
  const next = getRandomBytes(32);
  key = next;
  let result: T;
  try {
    result = await signIn();
  } catch (error) {
    if (key === next) key = previous;
    throw error;
  }
  try {
    await saveKey(next);
  } catch (error) {
    // The session works until the app closes; then the password unlocks it.
    console.warn("Could not save the session key", error);
  }
  return result;
}

/** Forgets the key in memory, once `auth.lock()` has settled. */
export function dropKey(): void {
  key = undefined;
}

function loadedKey(): Uint8Array {
  if (!key) throw new Error("The session key isn't loaded");
  return key;
}

/** AES-256-GCM: a random 12-byte nonce, then the ciphertext, as hex. */
export const sessionLocking: AuthLocking = {
  seal(payload) {
    const nonce = getRandomBytes(12);
    const sealed = gcm(loadedKey(), nonce).encrypt(utf8ToBytes(payload));
    return bytesToHex(nonce) + bytesToHex(sealed);
  },
  open(sealed) {
    const bytes = hexToBytes(sealed);
    const nonce = bytes.subarray(0, 12);
    return bytesToUtf8(gcm(loadedKey(), nonce).decrypt(bytes.subarray(12)));
  },
};
```

A device with no biometrics enrolled can't save an item that needs them, so
there the key is saved without them, and unlocking asks for nothing beyond
the device's own lock screen. If your app needs more on those devices, sign
out instead of locking.

Pass it to the client, and sign in with a new key, so the new session is
sealed with it:

```ts
export const auth = createAuth({
  // ...
  locking: sessionLocking,
});

export async function signInWithPassword(username: string, password: string) {
  // ...
  await withNewKey(() => auth.signIn({ accessToken, refreshToken, user }));
}
```

Guard the screens by `status`, since a locked session keeps its user. The
unlock screen comes before the sign-in screen, so a locked app opens on it,
and the sign-in screen stays open to a locked user for the password path:

```tsx
function RootStack() {
  const status = useAuth((state) => state.status);
  const signedIn = status === "authenticated" || status === "refreshing";
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={status === "locked"}>
        <Stack.Screen name="welcome-back" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}
```

The unlock screen reads the key, which shows the biometric prompt, then
unlocks:

<!-- file: app/welcome-back.tsx -->

```tsx
import { Link } from "expo-router";
import { useState } from "react";
import { Button, Text, View } from "react-native";

import { auth, useAuth } from "../src/auth";
import { loadKey } from "../src/session-key";

export default function WelcomeBack() {
  const name = useAuth((state) => state.user?.firstName);
  const [failed, setFailed] = useState(false);

  async function unlock() {
    setFailed(false);
    try {
      await loadKey();
      await auth.unlock();
      // No navigation: Stack.Protected leaves this screen, and
      // SessionGate opens the deep link the user was headed to.
    } catch {
      // Cancelled, or the biometrics changed: offer the password. A refresh
      // that failed after unlocking leaves the session `unavailable`, which
      // SessionGate shows instead.
      if (auth.state.get().status === "locked") setFailed(true);
    }
  }

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 12 }}>
      <Text>Welcome back{name ? `, ${name}` : ""}</Text>
      <Button title="Unlock" onPress={() => void unlock()} />
      {failed ? <Text accessibilityRole="alert">Could not unlock</Text> : null}
      <Link href="/login">Use your password</Link>
    </View>
  );
}
```

To lock again after some time in the background, lock when the app returns
to the foreground, then drop the key:

```ts
let backgroundedAt: number | undefined;
AppState.addEventListener("change", (next) => {
  if (next === "background") backgroundedAt = Date.now();
  else if (next === "active" && backgroundedAt !== undefined) {
    if (Date.now() - backgroundedAt > 5 * 60_000)
      void auth.lock().then(dropKey);
    backgroundedAt = undefined;
  }
});
```

Call `dropKey()` after `auth.signOut()` too. While locked, `SessionGate`
re-checks nothing on a return to the foreground, and requests through
`authFetch` reject with `LOCKED` until the user unlocks.

## Not supported

- **Expo web.** `secureStorage()` and `SessionGate` are for iOS and Android.
- **`requireAuthentication`.** `secureStorage()` doesn't pass SecureStore's
  biometric prompt: a session that refreshes on its own can't ask for a face
  or fingerprint on every read and write. Keep a key behind the prompt
  instead, and seal the session with it: see [Locking](#locking).
- **Network status.** session-kit doesn't watch connectivity. When your app
  learns the device is back online, for example from
  `@react-native-community/netinfo`, call `auth.retry()`, or the `retry` that
  `unavailable` receives.
