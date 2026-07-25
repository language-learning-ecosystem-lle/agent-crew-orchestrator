# transport-telegram

A notification transport for [`agent-protocol`](../agent-protocol/README.md): it
delivers an already-rendered text to a Telegram chat through the Bot API.

It is a package of its own because the boundary is the point — the protocol is
designed as a foreign package and a chat vendor is not part of any protocol. The core
produces events and renders the words; this one only knows how to put a string into a
chat. No scope in the name, for the same reason `agent-protocol` has none: the pair
travels together, and a project scope would mean the move starts with a rename.

## Use

```json
// agent-protocol.json of the repository that carries the protocol
"notifications": {
  "transport": { "module": "transport-telegram", "options": {} }
}
```

Two variables address the bot, and they come from the machine's secrets file
(`secrets.envFile` of `~/.config/agent-protocol/local.json`), never from a config in
git:

```
TELEGRAM_BOT_TOKEN=1234567890:AA...
TELEGRAM_CHAT_ID=123456789
```

Getting them: [@BotFather](https://t.me/BotFather) → `/newbot` for the token; then
write any message to your bot (a bot cannot speak first) and read the chat id off
`https://api.telegram.org/bot<TOKEN>/getUpdates`.

## Two properties worth knowing

- **Missing credentials are `unconfigured`, not a failure.** A machine nobody set up
  to notify is a legitimate machine; reporting that as a breakage sends an operator
  looking for one that is not there.
- **The token never leaves this package.** It sits in the URL of every request, so a
  network error that quotes a URL would leak it into a cron log for ever — every line
  this transport emits is built from the status code and then scrubbed of both
  secrets. That is a test, not a promise.
