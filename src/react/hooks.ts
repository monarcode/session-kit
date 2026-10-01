import { useRouter, type Register } from "@tanstack/react-router";
import { useSelector } from "@tanstack/react-store";

export type RegisteredAuth = Register extends {
	router: { options: { context: { auth: infer Client } } };
}
	? Client
	: never;

export type RegisteredAuthState = RegisteredAuth extends {
	state: { get: () => infer State };
}
	? State
	: never;

type AuthSource = {
	state: {
		get: () => unknown;
		subscribe: (listener: (value: unknown) => void) => {
			unsubscribe: () => void;
		};
	};
};

function assertAuthSource(value: unknown): asserts value is AuthSource {
	if (
		typeof value !== "object" ||
		value === null ||
		!("state" in value) ||
		typeof value.state !== "object" ||
		value.state === null ||
		!("get" in value.state) ||
		typeof value.state.get !== "function" ||
		!("subscribe" in value.state) ||
		typeof value.state.subscribe !== "function"
	) {
		throw new Error(
			"Provide an auth client in Router context before using auth hooks",
		);
	}
}

function useContextAuth(): AuthSource {
	const router = useRouter();
	const auth: unknown = router.options.context?.auth;
	assertAuthSource(auth);
	return auth;
}

export function useAuthClient(): RegisteredAuth {
	return useContextAuth() as RegisteredAuth;
}

export function useAuth(): RegisteredAuthState;
export function useAuth<T>(selector: (state: RegisteredAuthState) => T): T;
export function useAuth<T>(selector?: (state: RegisteredAuthState) => T) {
	const auth = useContextAuth();
	return useSelector(auth.state, (value) => {
		const state = value as RegisteredAuthState;
		return selector ? selector(state) : state;
	});
}
