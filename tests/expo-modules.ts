import { registerHooks } from "node:module";

/**
 * Points Expo's native modules at the in-memory mocks in `mocks/`. Import
 * this first, then import `@monarcode/session-kit/expo` dynamically: static
 * imports are resolved before any module runs, so before these hooks exist.
 */
const mocks: Record<string, string> = {
	"expo-secure-store": new URL("./mocks/expo-secure-store.ts", import.meta.url)
		.href,
	"expo-file-system/next": new URL(
		"./mocks/expo-file-system.ts",
		import.meta.url,
	).href,
};

registerHooks({
	resolve(specifier, context, nextResolve) {
		const url = mocks[specifier];
		return url
			? { url, shortCircuit: true }
			: nextResolve(specifier, context);
	},
});
