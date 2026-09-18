# omi-vector-bot

Discord support helper for Omi. Customers see it as **Omi Support**. Answers from a small FAQ. When it cannot see the data (orders, refunds, the phone or computer app), it hands the thread to a person and only then says that it did.

## Setup

```
cp .env.example .env
npm install
npm test
npm run ask -- "How do I pair my Omi?"
npm run ask -- "Where is my order?"
```

Never commit `.env`. Order and refund questions should print `ESCALATE` unless Shopify read-only env is set.

If `SHOPIFY_STORE` and `SHOPIFY_ACCESS_TOKEN` are set (Railway only, not GitHub), Vector looks up paid / shipped / tracking from an order number or the email on the order. The channel reply never includes street, phone, name, or email. Refunds, cancels, and address changes still go to a person. The Handoff card gets city/country so staff can check the lookup.

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

The user reply only claims a ping if one of those sends succeeded. Optional `STAFF_USER_IDS` / `STAFF_ROLE_ID` mention staff on the card. `AREA_OWNERS` (example `shop:ID,app:ID`) pings the named owner on hard tickets. Empty means no extra ping.

The card shows **Area** (`shop` / `app` / `desktop` / `firmware` / `privacy`). Tech tickets can show a **File issue** button when `GITHUB_TOKEN` is set. Staff click it; Vector does not auto-file. Duplicates get the existing issue link instead.

In a Handoff thread, `/done` marks it resolved and archives it. Only named staff (or anyone in `#vector-test` if the staff list is empty). Vector never auto-closes from GitHub or from a community reply.

If `GITHUB_WEBHOOK_SECRET` is set, `POST /github-webhook` posts one line when a linked issue is closed or a PR that closes it is merged. It does not run `/done`.

Do not set `HELP_FORUM_CHANNEL_ID` until these lanes work in `#vector-test`. Order, email, and privacy questions stay on a private Handoff even if that flag is set later.

In the Handoff thread, reply as a person (Vector stays quiet). To save a fact for later questions:

```
faq: Teal LED means charging and connected.
```

Saved facts live in memory on the host (and Postgres if `DATABASE_URL` is set). On boot, Vector also reloads `faq:` lines already sitting in Handoff threads in the test channel, so a Railway redeploy does not wipe them.
