/**
 * In-memory stand-in for the `File` and `Paths` parts of
 * `expo-file-system/next`. Clearing `files` is what deleting the app does to
 * its documents directory, while the iOS keychain keeps its items.
 */

export const fileSystem = {
	files: new Set<string>(),
	/** Makes every file operation throw. */
	failing: false,
	reset() {
		this.files.clear();
		this.failing = false;
	},
};

type Location = string | { uri: string };

function guard() {
	if (fileSystem.failing) throw new Error("File system unavailable");
}

export const Paths = {
	get document() {
		return { uri: "file:///documents" };
	},
};

export class File {
	readonly uri: string;

	constructor(...uris: Location[]) {
		this.uri = uris
			.map((part) => (typeof part === "string" ? part : part.uri))
			.join("/");
	}

	get exists(): boolean {
		guard();
		return fileSystem.files.has(this.uri);
	}

	create(): void {
		guard();
		if (fileSystem.files.has(this.uri))
			throw new Error(`${this.uri} already exists`);
		fileSystem.files.add(this.uri);
	}
}
