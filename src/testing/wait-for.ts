/**
 * WAIT FOR A STATE, WITH A CEILING FOR A REAL HANG — never a deadline that the
 * runner's mood can miss.
 *
 * The distinction two flakes were made of (the SIGTERM test of `run.process.test.ts`,
 * twice on different commits — msg-100 and msg-123 of `016-protocol-roadmap`; then the
 * dead-remote daemon test, thread `022-watch-dead-remote-flake`): what a process test
 * asserts is "the state ARRIVES", not "it arrives within twenty seconds". A tight
 * deadline turns a slow machine into a red run, and a red run people have learned to
 * restart stops being a fact — which is what rule #14 rests on. So the ceiling here is
 * sized for a HANG (a state that will never arrive), and the wait returns the moment
 * the state does.
 *
 * It lives here rather than in either test file because both of them need it, and a
 * convention that is copied is a convention that drifts — the same lesson as
 * `process-sandbox.ts`, where four files each forgot the same line independently.
 */

/** A wait this long is not a slow machine — it is something that is never coming. */
export const HANG_CEILING_MS = 120_000;

/**
 * Poll `state` until it holds. Returns whether it arrived: a caller that wants a
 * failure of its own (with the output and the journal in it) reads the result, and a
 * caller whose next `expect` says everything can ignore it.
 */
export const waitFor = async (
  state: () => boolean,
  ceilingMs: number = HANG_CEILING_MS,
): Promise<boolean> => {
  const until = Date.now() + ceilingMs;
  for (;;) {
    if (state()) return true;
    if (Date.now() >= until) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};
