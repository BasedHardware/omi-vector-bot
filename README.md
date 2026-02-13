# omi-vector-bot

Discord support bot that answers help forum threads using OpenClaw AI, escalates to Telegram when unsure, and builds a knowledge base over time.

## Setup

1. Copy `.env.example` to `.env` and fill in all values
2. Install dependencies:
   ```
   npm install
   ```
3. Ensure Postgres is running and `DATABASE_URL` is set (tables are created automatically on startup)
4. Start the bot:
   ```
   npm start
   ```

## How It Works

- Monitors threads in the configured help forum channel
- Sends user questions + thread history + knowledge snippets to OpenClaw `/agent`
- If confidence is high enough, replies directly in-thread
- If confidence is low, contains escalation keywords, or OpenClaw flags escalation — sends to Telegram for manual review
- Aarav replies on Telegram with `A: <answer>` (and optionally `KB: <snippet>`) — bot posts the answer back to Discord and saves the snippet

## Telegram Reply Format

Reply to an escalation message with:
```
A: Your answer here
KB: Optional knowledge snippet to save for future questions
```

## Environment Variables

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Discord bot token |
| `TELEGRAM_TOKEN` | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Telegram chat ID for escalations |
| `OPENCLAW_URL` | Base URL for OpenClaw API |
| `DATABASE_URL` | Postgres connection string |
| `HELP_FORUM_CHANNEL_ID` | Discord forum channel ID to monitor |
| `PORT` | Health endpoint port (default: 3000) |

## Deployment

Designed for Railway. The `/health` endpoint returns `OK` for health checks.
