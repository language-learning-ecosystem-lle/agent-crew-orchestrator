/**
 * THE TELEGRAM TRANSPORT — the first plugin of the protocol's notification seam
 * (R4, thread `016-protocol-roadmap`).
 *
 * IT IS A SEPARATE PACKAGE BECAUSE THE BOUNDARY IS THE POINT. `agent-protocol` is
 * designed as a foreign package and will move into a repository of its own; a chat
 * vendor is not part of any protocol, and a core that imported one would make every
 * repository carrying the protocol carry Telegram too. Keeping the first transport
 * outside from the very first commit is what proves the seam is real — a boundary
 * that has never had anything on the far side of it is a promise, not a design.
 *
 * NO SCOPE IN THE NAME, for the same reason `agent-protocol` has none (the micro-choice
 * of 2026-07-23): the pair travels together, and the name is the most-referenced thing
 * about a package — a project scope would mean the move starts with a rename.
 *
 * WHAT IT KNOWS AND WHAT IT REFUSES TO KNOW: it knows the Bot API and the two
 * variables that address it. It does NOT know what a thread is, who john is, or what
 * the text it delivers means — the text arrives rendered, from the project's
 * templates. That is why there is no formatting, no emoji and no wording here.
 *
 * THE TOKEN NEVER LEAVES THIS FILE. It is in the URL of every request, so an error
 * that quotes a URL is a token in a log for ever — the reason the bash predecessor
 * printed nothing but an HTTP code. Two things enforce that here: the outcome lines
 * are built from the status code alone, and `redactSecrets` scrubs anything that
 * still slipped through (a `cause` chain from `fetch`, a DNS error carrying the host
 * and the path). Both are tested, because "we are careful" is not a mechanism.
 */
import type { Transport, TransportInput, TransportOutcome } from "agent-protocol";

/** The two variables that address a bot. The names are Telegram's own convention. */
export const TOKEN_VAR = "TELEGRAM_BOT_TOKEN";
export const CHAT_VAR = "TELEGRAM_CHAT_ID";

const API = "https://api.telegram.org";

/** The wire timeout: a notifier that hangs is a cron job that piles up. */
const TIMEOUT_MS = 15_000;

/**
 * Scrub the secrets out of anything about to be printed. Substring replacement
 * rather than a pattern: we know the exact values, and a pattern for "something
 * token-shaped" would both miss and over-match.
 */
export const redactSecrets = (text: string, secrets: readonly string[]): string =>
  secrets
    .filter((secret) => secret !== "")
    .reduce((acc, secret) => acc.replaceAll(secret, "***"), text);

export type TelegramTransportInput = TransportInput & {
  /** Injected for the tests; the default is the platform's own. */
  readonly fetch?: typeof globalThis.fetch;
};

/**
 * Build the transport. Missing credentials give `unconfigured` AT SEND TIME rather
 * than a throw at construction: "nobody set this box up to notify" is a legitimate
 * state of a machine (the rule inherited from `bin/notify.sh` — notifications are a
 * superstructure, not a dependency), and the caller reports it as a fact instead of
 * as a failure to be investigated.
 */
export const createTransport = (input: TelegramTransportInput): Transport => {
  const token = input.secrets[TOKEN_VAR] ?? "";
  const chat = input.secrets[CHAT_VAR] ?? "";
  const send = input.fetch ?? globalThis.fetch;
  const hide = (text: string): string => redactSecrets(text, [token, chat]);

  return {
    send: async (text: string): Promise<TransportOutcome> => {
      const missing = [...(token === "" ? [TOKEN_VAR] : []), ...(chat === "" ? [CHAT_VAR] : [])];
      if (missing.length > 0) {
        return {
          state: "unconfigured",
          detail: `telegram: ${missing.join(" and ")} not set — nothing was sent (set them in the machine's secrets file)`,
        };
      }

      let response: Response;
      try {
        response = await send(`${API}/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ chat_id: chat, text }).toString(),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        // The message of a network error can carry the URL, and the URL carries the
        // token. Redacted, always — including the cause chain node happens to attach.
        return {
          state: "failed",
          detail: `telegram: the request did not complete — ${hide(String((error as Error).message ?? error))}`,
        };
      }

      if (response.ok) return { state: "sent", detail: "telegram: delivered" };
      // The BODY of a Telegram error is descriptive ("chat not found", "bot was
      // blocked") and does not contain the token — but it is a response we do not
      // control, so it goes through the same scrub as everything else.
      let body = "";
      try {
        body = (await response.text()).slice(0, 200);
      } catch {
        body = "";
      }
      return {
        state: "failed",
        detail: `telegram: HTTP ${response.status}${body === "" ? "" : ` — ${hide(body)}`}`,
      };
    },
  };
};
