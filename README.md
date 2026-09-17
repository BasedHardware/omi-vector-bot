# omi-vector-bot

Discord support helper for Omi. Answers from a small FAQ. When it cannot see the data (orders, refunds, logs, firmware), it hands the thread to a person and only then says that it did.

## Setup

```
cp .env.example .env
npm install
npm test
npm run ask -- "How do I pair my Omi?"
npm run ask -- "Where is my order?"
```

Never commit `.env`. Order and refund questions should print `ESCALATE`.

## Discord

Private test channel first. Do not set `HELP_FORUM_CHANNEL_ID` until that channel looks right.

```
npm run invite
npm start
```

Needs `DISCORD_TOKEN`, `OPENCODE_API_KEY`, and `VECTOR_TEST_CHANNEL_ID`. Host with `npm start` and health check `/health`. Stop any local process once the host is up, or two bots will answer the same message.

## Handoff

1. `STAFF_ALERT_CHANNEL_ID` — private staff channel.
2. Else a `Handoff · username` thread on the user message (needs Create Public Threads).
3. Else a **Needs a human** card in the same channel.
4. Optional Telegram: `TELEGRAM_TOKEN` and `TELEGRAM_CHAT_ID`.

The user reply only claims a ping if one of those sends succeeded. Optional `STAFF_USER_IDS` / `STAFF_ROLE_ID` mention staff on the card.

In the Handoff thread, reply as a person (Vector stays quiet). To save a fact for later questions:

```
faq: Order and tracking lookups need a person. Vector cannot see Shopify.
```

Saved facts live in memory on the host (and Postgres if `DATABASE_URL` is set). A Railway redeploy clears memory unless Postgres is on.
