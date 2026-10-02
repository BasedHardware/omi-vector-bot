# Omi Support bot

Discord support agent for Omi. Customers see it as **Omi Support**. It answers product questions from retrieved Omi sources, verifies model-written answers against those sources, and hands account or device-specific work to a person without inventing a status or a ping.

## Answer pipeline

1. A deterministic router protects private orders, money, privacy, app failures, and device failures before model output can change the lane. Informational exceptions still use the grounded answer pipeline.
2. An interpretation pass identifies the customer’s actual goal, facts they supplied, and every point the response must answer. It then rewrites follow-ups into a standalone question and several short search queries. Non-English questions are translated for retrieval while names, places, prices, device names, versions, and error codes are preserved.
3. PostgreSQL full-text search retrieves small, overlapping passages instead of whole truncated pages. Results from multiple queries are combined and labeled by source trust.
4. The answer model receives only the most relevant evidence, the same-thread history, and any staff-approved `faq:` facts.
5. A separate review model checks the interpretation against the raw message, confirms that the evidence actually applies, verifies every factual claim, and rejects generic replies that do not answer the customer’s goal. An irrelevant or unverified answer fails closed and goes to a person.
6. Deterministic honesty filters remove invented pings, diagnoses, shipped-fix claims, and unsupported steps before Discord receives the reply.

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

Money, orders, privacy, account deletion, app crashes, and device faults require a person. A successful handoff creates or reuses a customer-specific Discord thread. The bot only says that someone was notified when Discord actually accepted the handoff.

Staff may save a durable support fact inside a Handoff thread:

```text
faq: Teal LED means charging and connected.
```

Only configured staff can save facts. Customer messages and empty staff lists never become facts automatically.

## GitHub workflow

Technical handoffs can show a proposed issue card. The bot searches existing issues and pull requests first, but it does not open a public issue by itself. Staff must press **File**. Only threads linked by the bot receive signed GitHub webhook updates, and later customer messages are not copied to the issue.

Repository contributions follow [CONTRIBUTING.md](CONTRIBUTING.md). CI is intentionally deferred until the scored answer-quality set is a release gate.

## HTTP endpoints

- `GET /health` — process health
- `GET /ratings` — aggregate helpful / still-needs-help counts
- `POST /github-webhook` — signed GitHub events for bot-linked support threads
