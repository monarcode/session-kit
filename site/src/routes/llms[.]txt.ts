import { createFileRoute } from "@tanstack/react-router";

import { SITE_URL } from "@/lib/shared";
import { currentFolder, docsLlms } from "@/lib/source";

export const Route = createFileRoute("/llms.txt")({
	server: {
		handlers: {
			GET: () => {
				const folder = currentFolder();
				return new Response(
					[
						"# Session kit",
						"",
						"> Schema-driven auth state and sessions for React. It stores the tokens your backend issues and manages the session around them: restoring, refreshing, expiring, locking and syncing tabs. It never signs users in.",
						"",
						`Each link is a page as Markdown, in the order the docs read. [llms-full.txt](${SITE_URL}/llms-full.txt) has every page in one file. They cover the newest release of \`@monarcode/session-kit\`.`,
						"",
						...(folder.index ? [docsLlms.indexNode(folder.index)] : []),
						...folder.children.map((node) => docsLlms.indexNode(node)),
					].join("\n"),
					{ headers: { "Content-Type": "text/plain; charset=utf-8" } },
				);
			},
		},
	},
});
