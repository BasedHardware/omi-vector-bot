# Omi Support Bot Operations Runbook

Operate the capabilities that are actually enabled. The [roadmap](../ROADMAP.md) distinguishes implemented, validated and deployed work. Never paste credentials, verification codes, customer messages, private identifiers or raw backend logs into public issues or operational chat.

## Startup and deployment

Production uses the existing `DATABASE_URL` for support state as well as knowledge. Startup applies additive, repeatable schemas before Discord login. If database initialization fails, the process must not start answering with a memory-only coordination or identity store. Development/evaluation without `DATABASE_URL` uses isolated in-memory stores.

Keep one primary running service. Shared claims and worker slots protect overlap, but the platform still needs an adequate termination grace period. The bot stops taking new work and waits up to 90 seconds for accepted replies/interactions and active Telegram polling. Unstarted work is returned to the queue; a timed-out, started request is an uncertain outcome that must not be automatically replayed.

Before deploying, pass PR tests and relevant answer-quality checks, finish the existing smoke-test prerequisite, and record the current successful deployment as the rollback target. Verify the new deployment, health endpoint, Discord login, staff receipt and actual customer replies. Configuration presence is not a staff-delivery test. Do not change unrelated Railway variables or cloud permissions during rollout.

## Customer verification

Order links are customer-owned, encrypted in Postgres, and expire after 30 days. Codes expire after ten minutes by default, have five attempts, and are limited to three sends per hour per Discord-user/email pair. Those limits survive restart. `/unlink` revokes the binding and pending challenge, even if Shopify/email delivery is unavailable; it does not reset the anti-abuse limit.

If verification fails, use the public command's private response; never ask for codes or payment/address details in a public thread. Inspect only outcome categories and the email provider's authorized delivery status. A changed encryption key can make existing links unreadable: rotate with a migration, not by overwriting the old key and assuming the data survives.

## Staff case handling

Full staff cards contain a case reference, the source message link and the safe intake information. Customer-visible cards do not expose case identifiers, private acceptance controls or order facts.

An authorized staff member can use **Accept case** in the configured staff channel. Acceptance records the first accepting staff identity/time; a delivered card is not accepted merely because it exists. Replies in the staff channel still do not reach the customer. Follow the card's Jump link and reply in the customer's thread, or to the linked customer message when there is no thread.

Discord full-card delivery now checks the actual destination, not just `STAFF_ALERT_CHANNEL_ID`. Use a guild text/announcement channel hidden from `@everyone`, with access limited to configured `STAFF_USER_IDS`/`STAFF_ROLE_ID`, moderation/admin authority and this bot's managed role. The bot needs View Channel and Send Messages. An ordinary audience role is not trusted merely because the bot also has it. Unknown direct member grants fail closed; configure the named staff user/role or repair the audience rather than requesting a broader member intent. Fixed ACL outcome codes contain no customer or permission identifiers. Telegram destination verification remains follow-up work; continue using only the existing private staff chat.

Use `/done` in the resolved customer/Handoff thread. The customer notice must send before the database case and linked escalation close. “Still need help” is restricted to the owning customer and reopens the linked case/thread when possible. A newer active case prevents an old rating from replacing it.

The closing card separates internal resolution feedback from an optional honest app review. Both store links are shown to everyone before any feedback selection; never require a positive vote or a particular star rating. App Store opens Omi's review destination. Google Play opens its official listing, where the customer selects “Write a review.” Store link clicks do not change support dashboard counts, and the bot cannot verify that a public review was submitted. If feedback storage fails, the response must say so; unavailable aggregate counts are not zero.

Telegram replies must target an escalation actually sent by this bot. The case reference selects the exact customer case in shared channels. A failed Discord delivery leaves the case open; fix delivery before claiming resolution. Poll shutdown waits for a reply already being delivered instead of cutting it off.

## Engineering approvals and uncertain GitHub writes

In a verified private staff channel, use **Review technical summary**, then **Write technical summary**. Read the original customer evidence privately and enter symptoms, reproduction steps and versions in your own words. Do not enter contacts, order/payment details, recordings, private screenshots or raw logs. The sanitized staff summary is sent to GitHub search and shown in a private public-payload preview; inspect it before pressing **Publish reviewed issue/update**. Related work must be checked, but it does not silently change the target or prove a shipped fix.

The preview belongs to the editing staff member and exact revision. Editing invalidates old confirmations. Drafts and receipts survive restart in Postgres; a seven-day proposal expiry prevents further editing/publication, and a ten-minute editor expiry requires reopening the original review control. Old process-local File buttons cannot be verified and are refused. Keep the existing `DATA_ENCRYPTION_KEY` stable until a migration is prepared. Missing/invalid encryption configuration disables publication while staff can still handle the customer case.

If GitHub rejects a request, inspect the configuration/draft before a deliberate retry. If its outcome is uncertain, **do not publish again**. The original approving staff member can reopen the original private card and use **Check GitHub result**: the bot performs bounded reads and requires the exact payload, target, operation marker and recorded GitHub App provenance. Missing/ambiguous proof remains held for manual investigation. If GitHub accepted a post but saving a private link failed, **Check recorded result** repairs the link from the receipt without another POST. Do not reset the approval table or replace the immutable case/source/repository scope.

Tracking notices are best-effort, not an outbox. If a customer notice is unconfirmed, reply through the original customer message link. Read-only reconciliation does not automatically replay a potentially delivered customer notice. Important follow-ups from the owning customer's dedicated thread can stage a separate private comment approval only when one linked issue is unambiguous; shared channels and multi-issue cases require manual handling. Historical public GitHub bodies and markers are not rewritten by this milestone.

## Backlog and uncertain delivery

The worker pool has three globally leased slots. Waiting work is bounded in memory; excess requests persist only original Discord message/customer/channel references and a text fingerprint. A ready bot fetches those original messages and rechecks opt-in/ownership before processing. Deleted, inaccessible or no-longer-authorized messages are retired. No surrounding general-channel conversation is fetched.

Review queue/claim states only in an authorized private operations environment. `queued` is safe to dispatch. `processing` with an expired lease or `failed` can have an unknown send outcome. Inspect the original Discord thread and delivery records before deciding whether to retry. Do not reset claim tables, replay all history, or rerun every failed request: that can repeat answers and staff cards. A full delivery outbox/reconciliation interface remains a roadmap item.

Ordinary answers and full Discord staff cards additionally use `support_deliveries`. `accepted` records a verified message ID, not a human acceptance. `unknown` or expired `dispatching` means **do not resend**. Matching own-bot Gateway receipts may repair uncertainty; if the event was missed, absence is not proof the message failed. There is no automatic history search or late POST. A private read-only summary is available:

```sh
node scripts/inspect-support-deliveries.js --limit 20
```

Use only the existing private database environment. The command makes no external sends or database writes and prints opaque ledger IDs, kind/state, age, attempt count and receipt/projection presence—not source/customer/channel identifiers, nonce, credentials or content. Use the opaque `[Delivery] id=... kind=... state=...` log entry to correlate a hold. Do not run the command as a public bot action or paste private database rows into chat. Repair an uncertain operation manually only after independent receipt proof; this slice deliberately provides no reset/replay command.

An accepted staff receipt with pending local effects is repaired using the exact saved bot message and fresh staff ACL, not another card. The immutable receipt scope names its approval; if the original binding failure removed its review control, repair can restore it with an idempotent edit of that same private card after binding succeeds. Local repair uses backoff capped at 15 minutes. A changed destination/audience, missing card, mismatched customer or failed approval binding leaves it held for operator investigation. Closed cases and prior generations are retired from projection; they never reopen or deliver a newer case. Recent accepted answer IDs restore scoped continuation ownership after restart. Retention cleanup requires a reviewed policy and must not delete active holds to force retry.

The isolated sender bounds each ledgered POST to 15 seconds, disables hidden transport retries and declines long rate-limit waits. Definite rejection permits at most three deliberate attempts in ten minutes; the bot does not automatically regenerate/repost an answer after access or validation rejection. A missing reply reference can use a distinct same-channel fallback only after that specific rejection is proven. Reused-handoff messages, `/done`, ephemeral commands, Telegram and other notices remain outside this ledger and require their existing manual checks.

A transient coordination error produces a short honest fallback where possible and does not permanently disable later requests. Persistent database failures require the operator to repair the connection/service; there is no silent memory downgrade in production.

## Provider or staff delivery failure

Keep the existing safe fallback and private staff delivery paths. Only accepted staff delivery permits the “sent to the team” next step. If no private destination accepts the card, use the email fallback; never turn a public card or a customer-thread send into proof that staff received it.

If Discord staff delivery is uncertain, withhold other destination sends to avoid a duplicate case and tell the customer that staff receipt could not be confirmed, with one email next step. A later receipt repair does not automatically send a new customer notice. Do not describe a transport timeout as definite non-delivery or claim someone accepted the case.

Inspect counts and fixed outcome messages rather than request bodies. Escalation signals and timing/token lines are metadata. Do not forward raw exception strings if they may contain provider credentials or private inputs. Fix capability failures independently from answer wording; changing the tone must not hide a broken delivery path.

## Recording investigations

The bot does not yet have a recording diagnostic grant or gateway. Staff can use their own authorized backend tools, but those permissions must not be copied into the public bot. Preserve potentially unsynced recordings; do not recommend reinstall, logout or clearing local storage to a customer reporting missing recordings.

The planned gateway will verify the Omi account, obtain explicit case-bound permission and return pure metadata only. Until that workflow is implemented and enabled, do not claim the bot checked upload/processing/storage or that a recording can be recovered.

## Verification commands

```sh
npm test
EVAL_NO_MODEL=1 node scripts/customer-eval.js
node scripts/verify-support-db.js
```

The database check requires `SUPPORT_TEST_DATABASE_URL` for a **local**, dedicated database named `omi_support_test` (or an explicitly named suffix). It rejects production/non-local URLs. CI supplies a disposable Postgres service; no model, Discord or customer credentials are needed. The optional `--pglite /absolute/path/to/module` mode exercises SQL in a temporary PostgreSQL engine, without adding a production dependency. Its single-connection execution is not a substitute for the multi-connection CI job.

Run live evaluations only when spending provider quota is intentional. Never open held-out questions or change implementation to fit them.
