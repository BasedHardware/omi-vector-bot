# Omi Support bot

Discord support agent for Omi. Customers see it as **Omi Support**. It answers product questions from retrieved Omi sources, verifies model-written answers against those sources, and hands account or device-specific work to a person without inventing a status or a ping.

## Answer pipeline

1. A deterministic router protects private orders, money, privacy, app failures, and device failures before model output can change the lane. Informational exceptions still use the grounded answer pipeline.
2. An interpretation pass identifies the customer’s actual goal, facts they supplied, and every point the response must answer. It then rewrites follow-ups into a standalone question and several short search queries. Non-English questions are translated for retrieval while names, places, prices, device names, versions, and error codes are preserved.
3. PostgreSQL full-text search retrieves small, overlapping passages instead of whole truncated pages. Results from multiple queries are combined and labeled by source trust.
4. The answer model receives the most relevant evidence, same-thread history, and explicit notes saved by named staff with `faq:`. Legacy database notes with unknown authorship are not loaded into this path.
5. Deterministic honesty filters run on the draft. A separate review model then checks the interpretation against the raw message and official evidence, verifies claims, and can restore relevant supported details. An irrelevant or unverified answer fails closed and goes to a person.
6. The reviewed answer receives only the no-false-ping guard and Discord formatting/length limits; sentence-deleting claim filters do not run after review. Staff notes are never pasted directly into the final answer.

Source priority:

1. `help.omi.me` — official customer-support instructions
2. `docs.omi.me` — official product and developer documentation
3. Current official BasedHardware/Omi repository source — product behavior not yet covered by customer docs
4. `omi.me` — official product and policy pages
5. BasedHardware/Omi releases — version and release-note questions
6. `feedback.omi.me` — public issue/request status and customer-reported symptoms only; never product instructions
7. Discord help history — discovery and corroboration only; never sufficient for a factual claim

The source catalog refreshes in the background, including the support-relevant providers and services in the public Omi app source. Relevant public Featurebase posts are fetched on demand from the Feedback sitemap; only the post and portal metadata are retained, not authors, emails, comments, or old bot replies. A live repository search is used as an optional supplement when its GitHub credentials permit it. GitHub issues and pull requests are used only to identify existing engineering work; unlike repository source, they are not product documentation.

## Local setup

Requires Node.js 20 or newer.

```sh
cp .env.example .env
npm install
npm test
npm run ask -- "How do I pair my Omi?"
```

Set `CMD_API_KEY` in ignored `.env` for the CommandCode Provider API. `CMD_MODEL`,
`CMD_REVIEW_MODEL`, `CMD_API_URL`, and `CMD_TIMEOUT_MS` are optional overrides.
The bot requires `CMD_API_KEY`; an old provider key cannot be used as a fallback.
Never commit or log a real key.

For human handoffs, production must have either `STAFF_ALERT_CHANNEL_ID` pointing
to a private staff-only Discord text channel, or both `TELEGRAM_TOKEN` and
`TELEGRAM_CHAT_ID` pointing to the private staff chat. A customer-visible
Handoff card does not count as delivery. If both staff routes fail, the bot
tells the customer to email `help@omi.me`; `/health` reports `staffHandoff:
"missing"` without exposing any IDs. Check that staff can receive a test ticket
before enabling public support.

## Live answer evaluation

`node scripts/live-eval.js --runs 3 --concurrency 2` evaluates the built-in
support cases through the real answer path with Discord and staff delivery
stubbed. It spends CommandCode quota but does not log in to Discord, send staff
messages, look up private orders, or file GitHub issues. Use `--root
/absolute/path/to/checkout` to evaluate a separate `main` checkout with the
same key and model; `--cases id1,id2` selects a focused subset. `--cases-file
/absolute/path/to/cases.jsonl` accepts a held-out JSONL file outside the repo
with `{"id":"...","ask":"...","first":"answer|person|none"}` or `turns`
instead of `ask`. Held-out cases receive structural checks only. Every reply
and stage time is saved in ignored `eval/results/`; a case passes at 2 of 3
runs, with inconsistent cases listed as flaky.

Only the local `main` comparison adapter maps its old variable names to the
CommandCode endpoint. The current bot never falls back to OpenCode.

The runner loads current official Help Center and Omi website pages and uses
the production chunking/ranking functions in memory. It does not exercise
production Postgres storage or the `scripts/fill-db.js` scheduler, so compare
the scores with that limitation in mind. Do not merge on a single run.

Never commit `.env` or the local `railway.toml`. Do not run a local Discord process while the hosted process is active, or two bots may answer the same message.

## Quality checks

```sh
npm test
EVAL_NO_MODEL=1 node scripts/customer-eval.js
node scripts/customer-eval.js
```

The final command uses the configured model key and should only be run when a live-model check is intentional. Customer-facing behavior changes need a focused regression test. A green rules suite alone does not prove answer quality; retrieved evidence and the final answer must both be evaluated.

To rebuild the stored source catalog:

```sh
node scripts/fill-db.js --force
```

Without `--force`, each source is refreshed only when its freshness window has elapsed.

## Discord behavior

- New posts in the configured help forum are answered; historical posts are not replayed.
- Other bots, greetings, acknowledgements, and thanks are ignored.
- Follow-ups inside the same thread keep their thread context.
- Outside support threads, Omi Support answers only an explicit bot-user mention or a same-customer direct reply to that answer. It never reads surrounding channel conversation for context.
- Sensitive order, email, address, phone, and privacy content is not repeated publicly.
- `/done` closes a support thread and asks the original customer whether the answer helped.
- `/order`, `/orders`, and `/unlink` are public customer commands. Responses are ephemeral, and order access requires a code sent to the email on the Shopify order; Discord staff status is never used as authorization.

## Human handoff

Money, orders, privacy, account deletion, app crashes, and device faults require a person. The full handoff card, including Shopify facts, is sent only to the configured staff channel. If that fails, the bot prefers a private customer-and-staff thread when Discord supports one; any customer-visible thread or channel receives only a minimal card without customer text, order data, or Shopify facts. The bot only says that someone was notified when Discord actually accepted the handoff.

Named staff may save an explicit support note inside a Handoff thread:

```text
faq: Teal LED means charging and connected.
```

Only configured staff user IDs can save notes. Ordinary staff replies are not learned automatically. On restart, the bot reloads `faq:` lines only from named staff in test-channel Handoff threads. Legacy database notes are ignored because they lack author provenance. Notes are not a substitute for official-source verification.

An authenticated Telegram escalation reply may also include `KB: short support note` after its `A:` answer. The note enters the same in-memory pool as Discord `faq:` and is subject to the same official-source review before a customer sees an answer. Telegram notes are not written to the legacy database and do not survive a restart.

## GitHub workflow

Technical handoffs can show a minimal proposed issue card. The bot searches existing issues and pull requests first, but it does not open a public issue by itself. Staff must press **File**. Filing redacts contacts, addresses, order numbers, Discord identities, and secrets from the public issue; attachments are represented only by a count and the Discord thread link. Only threads linked by the bot receive signed GitHub webhook updates, and later customer messages are redacted before any GitHub comment.

Repository contributions follow [CONTRIBUTING.md](CONTRIBUTING.md). CI is intentionally deferred until the scored answer-quality set is a release gate.

## HTTP endpoints

- `GET /health` — process health
- `GET /ratings` — aggregate helpful / still-needs-help counts
- `POST /github-webhook` — signed GitHub events for bot-linked support threads
