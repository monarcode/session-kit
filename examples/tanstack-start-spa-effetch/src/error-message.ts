import type { DecodeError, HttpError, NetworkError } from "@monarcode/effetch";
import type { AuthFailure } from "@monarcode/session-kit/effect";
import * as Cause from "effect/Cause";
import * as Match from "effect/Match";
import * as Option from "effect/Option";

import type { ApiErrorBody } from "./api-client";

type ApiCallError =
	| HttpError.With<ApiErrorBody>
	| NetworkError
	| DecodeError
	| AuthFailure;

/**
 * The message to show for a failed API call, preferring DummyJSON's own. A
 * cause without a failure, such as a bug or an interruption, gets `fallback`.
 */
export const apiErrorMessage = (
	cause: Cause.Cause<ApiCallError>,
	fallback: string,
) =>
	Option.match(Cause.findErrorOption(cause), {
		onNone: () => fallback,
		onSome: Match.valueTags({
			HttpError: (error) => error.body?.message ?? `HTTP ${error.status}`,
			NetworkError: () => "Check your network connection",
			DecodeError: () => "Unexpected response from the server",
			// The session's failure, not the request's: `REFRESH_FAILED`, for
			// one, when an expired token couldn't be replaced.
			AuthFailure: (error) => error.message,
		}),
	});
