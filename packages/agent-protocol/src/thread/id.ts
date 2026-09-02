/**
 * THE FORM OF A THREAD ID — and the ONE place it is written down.
 *
 * The walker of the conversations directory takes a directory as a thread only if its
 * name matches this pattern (see `loadThreads` in `fs/comms.ts`). Everything else is
 * simply not a thread as far as the mail is concerned: `_instances/` is kept outside it
 * on purpose, and so is anything else the branch happens to carry.
 *
 * WHY THE PATTERN LIVES HERE AND NOT BESIDE THE WALKER (thread 086, measured in 047).
 * The door that WRITES a thread never asked the pattern, and the two sets — ids accepted
 * on a write and ids visible on a read — drifted apart SILENTLY. The live case:
 *
 *     new-thread --id 047.1-devops-enablement-acceptance … --write
 *         opened … committed and pushed to origin/comms          ← success
 *     thread show --thread 047.1-devops-enablement-acceptance
 *         thread '047.1-devops-enablement-acceptance' not found  ← and it is in the branch
 *
 * The statement of work sent that way reached nobody, raised nobody, and said nothing
 * about it: `--write` reported a delivery it had genuinely made into a directory the
 * reader does not look at. The fix is that the writing doors refuse BEFORE the write —
 * and that they ask THIS value rather than a copy of it, because two copies of the
 * regexp are the same defect again in six months under a different thread number.
 *
 * NOTHING NEW IS DECLARED HERE. The form `^NNN-<slug>` was already the norm; sub-threads
 * (`NNN.M`) are a new kind of address, that is a norm, and a norm is john's to move.
 */

/** The name of a directory the thread walker reads as a conversation. */
export const THREAD_ID = /^\d{3}-/;

/** Whether the mail's reader would see a thread under this id at all. */
export const isReadableThreadId = (id: string): boolean => THREAD_ID.test(id);

/**
 * The refusal for an id the reader will never see, or `undefined` when there is none.
 *
 * It names the three things a refusal in this package owes its reader: WHAT came in,
 * WHAT is required, and WHY — the "why" being the whole point here, because the id looks
 * perfectly reasonable to the human who typed it and the damage is invisible.
 */
export const unreadableThreadId = (id: string): string | undefined =>
  isReadableThreadId(id)
    ? undefined
    : `thread id '${id}' is not a thread the mail can read: the walker of the conversations directory takes only names matching ${THREAD_ID.source} — three digits and a dash — so the required form is '<NNN>-<slug>' (e.g. '086-thread-id'). A thread written under '${id}' would be committed and pushed and then stay invisible to 'thread show', to 'mail' and to the tick that raises roles: whatever is sent into it reaches nobody, and nobody is told. Sub-thread numbering ('NNN.M') is not a form this protocol has — a new form of address is a change of the norm, not of this id`;
