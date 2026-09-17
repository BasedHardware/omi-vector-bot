# omi-vector-bot

Omi Discord support helper. Brain is OpenCode. Discord is optional until we have a bot token.

## Right now

1. Copy `.env.example` to `.env` and put `OPENCODE_API_KEY` there. Never commit `.env`.
2. `npm install`
3. Ask a question in the terminal (no Discord):

```
npm test
npm run ask -- "How do I pair my Omi?"
npm run ask -- "I want a refund"
```

Refunds/shipping/order-status should print `ESCALATE` and must not claim a human was already pinged.

## Discord (private test channel)

Needs `DISCORD_TOKEN`. Optional `VECTOR_TEST_CHANNEL_ID` (answers every message there). If no channel is set, it answers when @mentioned.

```
npm start
```

Do not put it in the public help forum until that private channel looks right.

Host it (so it does not die when a laptop sleeps): Railway, `npm start`, health check `/health`. Set `DISCORD_TOKEN`, `OPENCODE_API_KEY`, and `VECTOR_TEST_CHANNEL_ID` in the host. Do not set `HELP_FORUM_CHANNEL_ID`. Stop any local `npm start` after the host is up, or two bots will answer the same message.

Create the Discord app: Developer Portal → New Application → Bot → enable **Message Content Intent** → copy token. Then:

```
npm run invite
```

Invite the bot to a **private test channel**, not the public help forum.

## Handoff (do not bluff)

When Vector cannot finish the job (refunds, orders, tracking, firmware, production logs, hardware that dies on boot), it must notify a person and only then say that it did.

1. `STAFF_ALERT_CHANNEL_ID` — private staff channel (best).
2. Else it opens a `Handoff · username` thread on the user message (needs **Create Public Threads**).
3. Else it posts a **Needs a human** card in the same channel (works with the current invite).
4. Optional Telegram (`TELEGRAM_TOKEN` + `TELEGRAM_CHAT_ID`) as a second copy.

If every path fails, the user reply stays honest: it has not pinged anyone.

Optional pings: `STAFF_USER_IDS` (comma-separated Discord user ids), `STAFF_ROLE_ID`.
Do not set `HELP_FORUM_CHANNEL_ID` until the private channel looks right.
