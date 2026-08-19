/**
 * ONE BASE FOR THE MAIL ROOT, TAKEN AT THE DOOR (thread 015).
 *
 * `--root` used to travel through a command as the caller typed it, and a RELATIVE value
 * was then resolved about two different bases: the planning half (`existsSync`, reading
 * the thread, writing the file) resolved it about the PROCESS's working directory, while
 * the delivery half staged it with `git -C <mail checkout> add -- <path>` — that is,
 * about the checkout. Measured live on a send from a role's workspace: the dry run
 * accepted the value and printed the plan, and `--write` died on `fatal: … is outside
 * repository` AFTER the message file had already been written.
 *
 * The trace was worse than the failure. The orphan file sat in the mail checkout
 * uncommitted, and delivery refuses a dirty checkout by design (`deliver.ts`) — so every
 * LATER send by every role failed with "the mail checkout has uncommitted changes", and
 * the role was left without the one exit it has (R3). One mistyped path, and the mail of
 * the circuit was shut until a hand cleaned it.
 *
 * So the value is made absolute HERE, at the entry of the command, before anything reads
 * it: whatever base the caller's shell meant, every phase afterwards sees the same path.
 * Nothing is checked about the path's existence — that is the command's own question, and
 * it asks it in its own words.
 */
import { isAbsolute, normalize, resolve } from "node:path";

/**
 * The mail root as an ABSOLUTE, normalized path.
 *
 * `cwd` is the base a relative value is measured from — the process's working directory,
 * which is what the caller's shell meant when they typed it. It is a parameter so the
 * resolution can be tested without moving the process.
 */
export const resolveMailRoot = (value: string, cwd: string = process.cwd()): string =>
  isAbsolute(value) ? normalize(value) : resolve(cwd, value);
