import { useEffect, useRef, useState } from "react";

import type { MirrorAuth } from "../core/mirror.js";
import { watchVersion } from "../core/revalidate.js";
import type { Session } from "../core/types.js";
import { sameSession } from "../core/user.js";

/**
 * Creates the mirror once per mount from the session the server rendered,
 * adopts each different session a server render brings, and calls `render`
 * when the browser's session moves away from the one last rendered, so the
 * server renders again and its redirects run.
 */
export function useServerSession<U, C extends MirrorAuth<U>>(
	create: (session: Session<U> | null) => C,
	session: Session<U> | null,
	render: () => unknown,
): C {
	const [auth] = useState(() => create(session));
	const latestRender = useRef(render);
	// The session the server last rendered, which the client follows.
	const rendered = useRef(session);
	useEffect(
		function trackRender() {
			latestRender.current = render;
		},
		[render],
	);
	useEffect(
		function followServer() {
			const previous = rendered.current;
			rendered.current = session;
			// Only a change: a render begun before a change in the browser
			// mustn't undo it.
			if (!sameSession(previous, session)) auth.adopt(session);
		},
		[auth, session],
	);
	useEffect(
		function renderOnChange() {
			const unwatch = watchVersion(auth, () => {
				const { sessionId, user } = auth.state.get();
				const current = sessionId === null ? null : { sessionId, user };
				if (!sameSession(current, rendered.current))
					return latestRender.current();
			});
			return function stopRendering() {
				unwatch();
			};
		},
		[auth],
	);
	return auth;
}
