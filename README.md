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

If `SHOPIFY_STORE` and `SHOPIFY_ACCESS_TOKEN` are set (Railway only, not GitHub), Vector still does not look up an order from a number or email typed in chat. `/order` verifies the email on the order with a one-time code, binds that email to the Discord user, then looks up only that user's orders (ephemeral). Until Shopify + Resend + `DATA_ENCRYPTION_KEY` are set, `/order` tells them to email help@omi.me. Replies never include street, phone, name, or email. Refunds, cancels, and address changes still go to a person.

## Discord

Private test channel first. Leave `HELP_FORUM_CHANNEL_ID` empty until you want Vector to answer public help posts. Staff can still `/done` a forum post without that flag.

```
npm run invite
npm start
```

Needs `DISCORD_TOKEN`, `OPENCODE_API_KEY`, and `VECTOR_TEST_CHANNEL_ID`. Host with `npm start` and health check `/health`. Stop any local process once the host is up, or two bots will answer the same message.

## Handoff

1. `STAFF_ALERT_CHANNEL_ID` — private staff channel.
2. Else a `Handoff · app · Daily reports…` thread on the user message (area + short title; needs Create Public Threads).
3. Else a **Needs a human** card in the same channel.
4. Optional Telegram: `TELEGRAM_TOKEN` and `TELEGRAM_CHAT_ID`.

The user reply only claims a ping if one of those sends succeeded. The staff card names a specialist in plain text and does not ping anyone. Shop and app: Mohsin. Desktop: Aryan. Firmware: TuEmb. Privacy: David. Anything else: Aryan, David, undivisible. A how-to stays with the bot.

The card shows **Labels** and **Area** (`shop` / `app` / `desktop` / `firmware` / `privacy`). Tax, duties, customs, refunds, and orders stay off GitHub. They get a Discord shop ticket card; updates stay in that Handoff. Chat never looks up Shopify from a guessed order number. `/order` after email OTP is the lookup path. Refunds, cancels, and address changes still need a person.

App, desktop, and firmware bugs get a Discord issue card. GitHub filing uses a **GitHub App** installation token when `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, and `GITHUB_APP_PRIVATE_KEY` are set, so issues show as the app, not a person. A personal `GITHUB_TOKEN` still works as a fallback and should not be used. If the app is set, Vector files that card on GitHub (or links a duplicate) and stamps the Handoff id in the issue body. The File button remains as a staff fallback. Tax and shop tickets are never filed.

In a Handoff thread or a public help-forum post, `/done` posts a closed-ticket card with the Omi logo, applies the forum **Resolved** tag when that tag exists, then archives it. Named staff (`STAFF_USER_IDS` / `STAFF_ROLE_ID`) or anyone with Manage Threads. The bot also needs **Manage Threads** to archive and to set moderated tags. In `#vector-test`, anyone can `/done` if that list is empty. Vector never auto-closes from GitHub, from a community reply, or in bulk. Set `HELP_FORUM_CHANNEL_ID` only when you want Vector to answer in that forum. Order, email, and privacy still go to a private Handoff.

If `GITHUB_WEBHOOK_SECRET` is set, point GitHub at `POST /github-webhook`. Vector posts one line in the linked Handoff when the issue is opened, closed, reopened, commented on, or a closing PR is merged. It does not paste GitHub comment text and it does not run `/done`.

In the Handoff thread, reply as a person (Vector stays quiet). To save a fact for later questions:

```
faq: Teal LED means charging and connected.
```

Saved facts live in memory on the host (and Postgres if `DATABASE_URL` is set). On boot, Vector also reloads `faq:` lines already sitting in Handoff threads in the test channel, so a Railway redeploy does not wipe them.
