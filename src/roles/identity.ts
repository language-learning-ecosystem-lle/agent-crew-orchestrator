/**
 * WHO A COMMIT IS BY, WHEN THE ONE WHO WROTE IT IS A ROLE (thread `027`, john's
 * decision of 2026-07-27).
 *
 * THE DEFECT. Every commit an agent makes — code in a role's workspace, a message in
 * the mail — is signed by the OWNER OF THE MACHINE, because that is whose name sits in
 * `~/.gitconfig`. So the history answers "whose box was this raised on" while the
 * question everybody actually asks of it is "who wrote this". In the mail it is worse
 * than useless: the header of a message says `from: dev-core` and the commit that
 * carries it says the machine owner, so the two halves of one act disagree.
 *
 * WHAT AN IDENTITY IS HERE: the role id as the name, and a NON-DELIVERABLE address as
 * the email. The domain is `.invalid` — reserved by RFC 2606 and guaranteed never to
 * resolve — because these addresses exist to be READ, never written to; an address
 * that could receive mail would invite somebody to send some.
 *
 * WHY ONE DOMAIN FOR THE PACKAGE AND NOT A CONFIG FIELD. It is a constant of the
 * PROTOCOL, not of the project: nothing about a repository changes what "an agent's
 * address does not exist" means, and a field would mean every project choosing a
 * spelling for the same non-answer. It is one line to promote to config the day a
 * project wants its commits branded — and not before (MVP-discipline, rule 1).
 *
 * THE TWO WAYS IT IS APPLIED, and they are different on purpose:
 *  - A ROLE'S WORKSPACE has ONE writer for its whole life, so the identity belongs to
 *    the DIRECTORY: git config, set at every launch (`orchestrator/workspace.ts`).
 *  - THE MAIL CHECKOUT is shared by every role on the box, so there is no such thing
 *    as its identity: it goes on the COMMIT, through the environment of that one git
 *    call (`thread/deliver.ts`).
 *
 * WHY THE ENVIRONMENT AND NOT `git -c user.name=…` FOR THE SECOND ONE: `GIT_AUTHOR_*`
 * outranks configuration, so an operator who happens to export those variables cannot
 * silently take the signature back from the role. The same reason applies in reverse
 * to the workspace, where nobody exports anything and the directory is the durable
 * place.
 *
 * WHAT IS DELIBERATELY NOT FIXED HERE (named in the statement of work): curator's
 * writes through the GitHub API keep the owner of the token as their author — the
 * Contents API has an `author` field but the proxy in between does not pass it
 * through. The executor's signature already lives in the `worker:` header of the
 * message, so nothing is lost that the thread does not already say.
 */

/** A git author/committer: a name to read and an address that goes nowhere. */
export type GitIdentity = {
  readonly name: string;
  readonly email: string;
};

/**
 * The address space of every agent in the protocol. Reserved by RFC 2606, so it is
 * guaranteed not to resolve anywhere, on any network, ever.
 */
export const IDENTITY_DOMAIN = "agents.invalid";

/** The signature of a role: its id, exactly as the config and the mail spell it. */
export const roleIdentity = (role: string): GitIdentity => ({
  name: role,
  email: `${role}@${IDENTITY_DOMAIN}`,
});

/**
 * THE SIGNATURE OF THE MACHINERY ITSELF — the instance digest (R13) is written by the
 * daemon rather than by anybody's role, and signing it with a role would be a lie
 * about who acted. The commit subject already names which box it is about, so the
 * author only has to say "this is bookkeeping, not a turn in a conversation".
 */
export const ORCHESTRATOR_IDENTITY: GitIdentity = {
  name: "agent-protocol",
  email: `orchestrator@${IDENTITY_DOMAIN}`,
};

/**
 * The identity as environment for ONE git invocation. Committer as well as author:
 * they are separate variables and git falls back to the config for whichever is left
 * out, which would leave the machine owner on half of every commit.
 */
export const identityEnv = (identity: GitIdentity): Readonly<Record<string, string>> => ({
  GIT_AUTHOR_NAME: identity.name,
  GIT_AUTHOR_EMAIL: identity.email,
  GIT_COMMITTER_NAME: identity.name,
  GIT_COMMITTER_EMAIL: identity.email,
});
