/**
 * THE TRANSPORT CONTRACT — the seam between "the turn has passed" and "a phone
 * buzzed" (R4, thread `016-protocol-roadmap`).
 *
 * The core produces events and text; DELIVERY is a plugin, and it is a plugin for a
 * stated reason rather than for tidiness: this package is designed as a foreign one,
 * and Telegram is not part of any protocol. A core that imported a chat vendor would
 * make every repository carrying the protocol carry that vendor too, and the second
 * team would start by removing it. The first implementation lives in its own
 * workspace package (`transport-telegram`) precisely so that the boundary is proved
 * by construction rather than promised in a doc.
 *
 * THE PLUGIN IS NAMED IN THE CONFIG AND LOADED BY `import()`. The config is in git
 * behind a PR, which is the same trust boundary the package itself sits on: a module
 * specifier there is reviewed like any other line. The alternative — a registry of
 * known transports inside the core — is the thing being avoided: it would put the
 * list of vendors back into the neutral package.
 *
 * THREE OUTCOMES, NOT A BOOLEAN, and the middle one is the load-bearing one:
 * `unconfigured` means the transport exists but nobody gave it credentials on this
 * machine. That is a LEGITIMATE state (the rule inherited from `bin/notify.sh`:
 * notifications are a superstructure, not a dependency — no env file, no network,
 * and the circuit is not affected), and it must not be reported as a delivery
 * failure, because a failure is something one goes and investigates.
 *
 * WHAT A TRANSPORT MUST NOT DO: put a secret into its `detail`. The strings here are
 * printed to a log that lives in a cron mailbox; a token in a URL or in an error
 * message is a token in a log file for ever. The rule is stated here because the
 * core cannot enforce it — the transport is somebody else's code.
 */

export type TransportOutcome = {
  /** `sent` — delivered; `unconfigured` — nothing to deliver with; `failed` — it tried and could not. */
  readonly state: "sent" | "unconfigured" | "failed";
  /** One line for the operator's log. MUST NOT contain secrets. */
  readonly detail: string;
};

export type Transport = {
  readonly send: (text: string) => Promise<TransportOutcome>;
};

export type TransportInput = {
  /** Non-secret parameters from the protocol config, verbatim. */
  readonly options: Readonly<Record<string, string>>;
  /**
   * Secrets as an ENVIRONMENT-SHAPED map: the transport knows which variables it
   * needs and the core does not. It is passed rather than read from `process.env`
   * inside the plugin so that the source of a secret is one decision made in one
   * place (the machine, see `secrets.ts`) — and so that a transport is testable
   * without setting environment variables on whoever runs the tests.
   */
  readonly secrets: Readonly<Record<string, string | undefined>>;
};

export type TransportFactory = (input: TransportInput) => Transport;

export class TransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransportError";
  }
}

/** What a transport module is obliged to export. One name, said once, here. */
export const TRANSPORT_EXPORT = "createTransport";

/**
 * Turn a loaded module into a transport, loudly. A module that is on disk but does
 * not export the factory is a REFUSAL and not a fallback to silence: the operator
 * named it in the config, so the only honest answers are "it works" and "it is
 * wrong, here is which name is missing".
 */
export const transportFrom = (
  module: unknown,
  specifier: string,
  input: TransportInput,
): Transport => {
  const factory = (module as Record<string, unknown> | null)?.[TRANSPORT_EXPORT];
  if (typeof factory !== "function") {
    throw new TransportError(
      `the transport '${specifier}' does not export '${TRANSPORT_EXPORT}' — a transport module exports a factory (options, secrets) => { send }`,
    );
  }
  return (factory as TransportFactory)(input);
};

/**
 * Load the module named in the config and build the transport from it. The import
 * failure is re-thrown with the specifier quoted: `ERR_MODULE_NOT_FOUND` on its own
 * does not say which config line put that name there.
 */
export const loadTransport = async (
  specifier: string,
  input: TransportInput,
): Promise<Transport> => {
  let module: unknown;
  try {
    module = await import(specifier);
  } catch (error) {
    throw new TransportError(
      `the transport '${specifier}' was not loaded: ${(error as Error).message} — it is named in the config as notifications.transport.module and must be a dependency of the repository`,
    );
  }
  return transportFrom(module, specifier, input);
};
