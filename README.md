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

Refunds/shipping should print `ESCALATE` and must not claim a human was already pinged.

## Discord (private test channel)

Needs `DISCORD_TOKEN`. Optional `VECTOR_TEST_CHANNEL_ID` (answers every message there). If no channel is set, it answers when @mentioned.

```
npm start
```

Do not put it in the public help forum until that private channel looks right.

Create the Discord app: Developer Portal → New Application → Bot → enable **Message Content Intent** → copy token. Then:

```
npm run invite
```

Invite the bot to a **private test channel**, not the public help forum.
