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

## Discord (later)

Needs `DISCORD_TOKEN` and `HELP_FORUM_CHANNEL_ID`, then `npm start`. Do not run this in the live Omi help forum until it has been smoked in a private test channel.
