/**
 * The parts of `react-native` session-kit uses, in memory. `appState.change`
 * moves the app between states the way the operating system does.
 */

type Listener = (state: string) => void;

const listeners = new Set<Listener>();

export const appState = {
	/** Change listeners currently subscribed. */
	get listeners() {
		return listeners.size;
	},
	/** Sets the state and tells every listener, as React Native does. */
	change(next: string) {
		AppState.currentState = next;
		for (const listener of listeners) listener(next);
	},
	reset(state: string | null = "active") {
		listeners.clear();
		AppState.currentState = state;
	},
};

export const AppState = {
	currentState: "active" as string | null,
	addEventListener(type: string, listener: Listener) {
		if (type !== "change")
			throw new Error(`Unexpected AppState event ${type}`);
		listeners.add(listener);
		return { remove: () => listeners.delete(listener) };
	},
};
