/** The longest delay `setTimeout` supports, about 24.8 days. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;
/** Proactive refresh starts this long before expiry, or halfway, if sooner. */
const REFRESH_LEAD_MS = 60_000;

/**
 * Like `setTimeout`, but a delay beyond the platform limit re-arms instead of
 * firing early. Each re-arm measures from the clock, not elapsed timer time,
 * so a wait that outlasts a suspended device stays anchored to its deadline.
 * Returns a function that cancels the timer.
 */
export function setLongTimeout(
	callback: () => void,
	delay: number,
): () => void {
	const deadline = Date.now() + delay;
	let timer: ReturnType<typeof setTimeout>;
	const arm = () => {
		const remaining = deadline - Date.now();
		timer =
			remaining > MAX_TIMER_DELAY_MS
				? setTimeout(arm, MAX_TIMER_DELAY_MS)
				: setTimeout(callback, Math.max(remaining, 0));
	};
	arm();
	return () => clearTimeout(timer);
}

/** How long to wait before refreshing a token that expires in `remaining` ms. */
export function proactiveRefreshDelay(remaining: number): number {
	return remaining - Math.min(REFRESH_LEAD_MS, remaining / 2);
}
