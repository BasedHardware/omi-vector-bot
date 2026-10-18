# Omi Support Bot Operations Runbook

Operate the capabilities that are actually enabled. The [roadmap](../ROADMAP.md) distinguishes implemented, validated and deployed work. Never paste credentials, verification codes, customer messages, private identifiers or raw backend logs into public issues or operational chat.

October 12 release holds: #42's fresh comparison is complete and meets numerical limits, but factual/how-to/protected-escalation/clipping review is pending; do not approve it from pass-both or latency alone. #43 closing-card localization is a separate draft. #28's actual read-only preflight returned `untrusted_role_can_view`, so stop its rollout and obtain administrator/direction review of the real audience; never add unverified roles, change permissions or silently repeat a failed private-destination check. No deployment accompanied these checks.

## Startup and deployment

The October 17 updated brief authorizes combining #42/#45 into Release 1 and running a fresh same-day comparison after #46's verified merge (`273550c`). It does not authorize deployment before independent grading, memory enablement or model training. #28's audience check stays stopped. Keep capture/context switches off; Release 2's approved private pilot is separate. The retained #43 release record and its pending live smoke are not overwritten by unit/SQL results.

### Release 2 approval and replacement — do not enable existing text retention

Aryan approved 30-day support memory and is the daily fix-card reviewer. The approved target saves references, not message text; it is **not implemented yet**. Start its branch from main after Release 1's deployment. Current channel permissions are explicitly not fixed, so Release 1's staff-only smoke and #28 preflight remain stopped. Do not repeat the check or change permissions without the required confirmation.

Before enabling Release 2, independently review the replacement, no-text schema migration, same-owner cross-post isolation, 1.5-second failure fallback, forum-wide erasure/opt-out and creation-based 30-day pruning. Preserve the four existing capture/policy/context/forum controls with no enabled defaults and no dependency on the identity encryption key. The live two-post scenario requires an approved isolated test runtime or the reviewed test-only deployment; never start an extra production bot to test an ungraded branch. Memory-off comparison success does not verify enabled context.

After grading, release to the private test forum only; verify edits/deletes, opt-out across posts, restart, expiry, timeouts and immediate switch-off behavior, and observe at least 48 clean hours before reviewed expansion. Review processor/privacy/backup-erasure and any required platform arrangements; no repeat retention approval is needed. Publish the following exact notice when the behavior is implemented and the help-forum expansion is approved; it is **drafted, not confirmed pinned**:

> I'm Mira, Omi's AI support assistant. So you don't have to repeat yourself, I can look back at your support posts from the last 30 days. I don't copy your messages or use them to train AI. Type /forget-support-history to clear this anytime.

Explain the command precisely in its private confirmation: remove the customer's references/signals across their forum posts and stop future saving, retaining only necessary opt-out state. It does not delete Discord posts or erase unrelated support systems/backups. References/outcomes still require data protection; avoiding message copies does not make them anonymous. Never log the fetched text.

### Existing optional text-memory foundation — disabled, superseded

The paragraphs below describe the old disabled implementation for maintenance/erasure, **not instructions to enable it**. Its valid encryption key does not clear the new references-only requirement or any release gate. Do not rotate or remove the key used by existing order/identity records as part of the memory replacement.

Before any future enablement, publish the accurate notice/deletion route, establish backup erasure, confirm processor restrictions and any Discord App Review requirement, and resolve applicable security risks. Do not set the approval flag as a substitute. Model training on Discord API message content still requires Discord's express permission. Do not scrape channel history or export identifiable cases into an evaluation/training set.

Capture is disabled unless `SUPPORT_MEMORY_ENABLED=1` and `SUPPORT_MEMORY_POLICY_APPROVED=1`, with `DATABASE_URL`, a valid existing encryption key and an explicit `SUPPORT_MEMORY_FORUM_IDS` allowlist. That allowlist can only select the configured help/test forums; the default is none. Use only the approved private test forum for the shadow pilot, not the public Help forum. Proposed `SUPPORT_MEMORY_RETENTION_DAYS` defaults to 30 and is capped at 30; edits cannot extend a message's creation-based expiry. `SUPPORT_MEMORY_CONTEXT_ENABLED` stays off until separate approval for customer reply use. Disabling capture also disables retained-context reuse; it does not itself erase retained data. Do not rotate the existing data key without preserving existing encrypted records.

Only configured help/test forum posts with an owner are supported. Capture includes that owner, named `STAFF_USER_IDS` and this bot, not all participants or all server channels. Text is redacted and encrypted; attachment contents and link URLs are not retained. Ordinary replies and handoff controls remain independent of this optional observer. Fixed `[SupportMemory]` error/queue-full lines indicate missing coverage and require operator review; they never prove that every message was retained. Extra context reads are uncached, limited to five and bounded by a two-second retrieval budget.

Customers can use `/forget-support-history` in their own support post. It deletes the retained post history and related outcome events, and retains only an opaque thread suppression reference so future messages do not silently restart capture. It remains available with capture disabled and needs no decryption key. Discord messages are unchanged. Broader account-wide erasure and backup deletion remain an operator privacy workflow; never claim this command erases those systems.

Capture being off does not stop expiry cleanup or deletes for previously known stored posts. If the encryption key is unavailable, only capture/context use is disabled with a fixed diagnostic; core answering and keyless erasure/expiry cleanup remain available. Restore a valid reviewed configuration before enabling memory again; never pretend missing encryption is a working capture mode.

Deleting a post/message in an enabled pilot takes precedence over its queued first capture. Outside the capture pilot, only previously stored posts get deletion records. Mandatory expiry sweeps are independent of optional observation capacity; simultaneous local sweeps coalesce rather than creating an unbounded backlog.

For approved local/private operations only, `node scripts/support-quality-report.js` reads aggregate outcome counts and prioritized review actions. It prints no case text/IDs, makes no model call and publishes nothing. Disabled is reported as disabled, and a database failure is unavailable—not zero events. Counts are event-level and incomplete after missed/dropped observations; they are not customer resolution, accuracy, or improvement-rate measurements. No prompt update or model retraining follows automatically.

Production uses the existing `DATABASE_URL` for support state as well as knowledge. Startup applies additive, repeatable schemas before Discord login. If database initialization fails, the process must not start answering with a memory-only coordination or identity store. Development/evaluation without `DATABASE_URL` uses isolated in-memory stores.

Keep one primary running service. Shared claims and worker slots protect overlap, but the platform still needs an adequate termination grace period. The bot stops taking new work and waits up to 90 seconds for accepted replies/interactions and active Telegram polling. Unstarted work is returned to the queue; a timed-out, started request is an uncertain outcome that must not be automatically replayed.

Before deploying, pass PR tests and relevant answer-quality checks, finish the existing smoke-test prerequisite, and record the current successful deployment as the rollback target. Verify the new deployment, health endpoint, Discord login, staff receipt and actual customer replies. Configuration presence is not a staff-delivery test. Do not change unrelated Railway variables or cloud permissions during rollout.

Remaining staged order is gated #42 → localized closing-card fix → #28 → #29 → #30, with one smoke report and 24 clean hours between releases unless Aryan explicitly says go. Aryan granted that exception for #41, which is live at main `b9eeb16`. Current deployment after the required same-image restart test is `4a8e93d5-771c-486e-91f6-335839f05be4`, created October 12 at 01:02:10 UTC / 06:32:10 IST; Phase 3's rollback target is `6ddd1673-2e45-4cac-9d0d-28c71a9107fd`. REPORT 3 was graded PASS; the reviewer accepted button removal plus tested database notice uniqueness without a live retest. The next deployment needs its own gates and 24 clean hours from this latest restart unless Aryan says go again. Verify the active deployment and interval before dispatch; never use a historical release's hard-coded rollback helper for a later release. No automatic rollout is booked.

## Customer verification

Order links are customer-owned, encrypted in Postgres, and expire after 30 days. Codes expire after ten minutes by default, have five attempts, and are limited to three sends per hour per Discord-user/email pair. Those limits survive restart. `/unlink` revokes the binding and pending challenge, even if Shopify/email delivery is unavailable; it does not reset the anti-abuse limit.

If verification fails, use the public command's private response; never ask for codes or payment/address details in a public thread. Inspect only outcome categories and the email provider's authorized delivery status. A changed encryption key can make existing links unreadable: rotate with a migration, not by overwriting the old key and assuming the data survives.

## Staff case handling

Full staff cards contain a case reference, the source message link and the safe intake information. Customer-visible cards do not expose case identifiers, private acceptance controls or order facts.

An authorized staff member can use **Accept case** in the configured staff channel. Acceptance records the first accepting staff identity/time; a delivered card is not accepted merely because it exists. Replies in the staff channel still do not reach the customer. Follow the card's Jump link and reply in the customer's thread, or to the linked customer message when there is no thread.

**Shipped in #41:** acceptance updates the shared card and posts one localized, no-ping notice naming the acceptor in the customer's thread. **Start work / Resume work** and **Waiting for customer** are explicit staff-controlled progress, not automatic inference. **Refresh status** rereads the durable case; `/done`, Telegram resolution and customer-authorized reopening update the same cards. The suggested specialist is not the actual accepting owner. Reopening clears old acceptance so a new staff member can pick up the next cycle.

The service repairs missed card edits at startup and every 30 seconds, bounded to 25 cases per sweep. It never recreates a deleted card. An unconfirmed customer notification gives the accepting staff member this ephemeral instruction: “The customer notice was not confirmed. Please reply in their thread yourself.” Use Jump and follow up yourself; do not repeat Accept to replay an uncertain send. A persisted acceptance does not prove a thread notice was delivered. No promised response time or recovery follows from any status.

Use `/done` in the resolved customer/Handoff thread. The customer notice must send before the database case and linked escalation close. “Still need help” is restricted to the owning customer and reopens the linked case/thread when possible. A newer active case prevents an old rating from replacing it.

The closing card separates internal resolution feedback from an optional honest app review. Both store links are shown to everyone before any feedback selection; never require a positive vote or a particular star rating. App Store opens Omi's review destination. Google Play opens its official listing, where the customer selects “Write a review.” Store link clicks do not change support dashboard counts, and the bot cannot verify that a public review was submitted. If feedback storage fails, the response must say so; unavailable aggregate counts are not zero.

**Retained #43 release record:** localization merged at `dad2505` and deployed as `a6c7c577-4cc5-47b9-bf05-ba63444425e4`; its Spanish/Chinese live close/reopen smoke remains pending. `/done` uses the stored case `context.replyLanguage` for the title, description, optional-review field and button labels, with English fallback. Custom IDs and links stay unchanged. Finish that smoke before treating localization as production-verified. This implementation performs no fresh production check or deployment.

Telegram replies must target an escalation actually sent by this bot. The case reference selects the exact customer case in shared channels. A failed Discord delivery leaves the case open; fix delivery before claiming resolution. Poll shutdown waits for a reply already being delivered instead of cutting it off.

## Backlog and uncertain delivery

The worker pool has three globally leased slots. Waiting work is bounded in memory; excess requests persist only original Discord message/customer/channel references and a text fingerprint. A ready bot fetches those original messages and rechecks opt-in/ownership before processing. Deleted, inaccessible or no-longer-authorized messages are retired. No surrounding general-channel conversation is fetched.

Review queue/claim states only in an authorized private operations environment. `queued` is safe to dispatch. `processing` with an expired lease or `failed` can have an unknown send outcome. Inspect the original Discord thread and delivery records before deciding whether to retry. Do not reset claim tables, replay all history, or rerun every failed request: that can repeat answers and staff cards. A full delivery outbox/reconciliation interface remains a roadmap item.

A transient coordination error produces a short honest fallback where possible and does not permanently disable later requests. Persistent database failures require the operator to repair the connection/service; there is no silent memory downgrade in production.

## Provider or staff delivery failure

Keep the existing safe fallback and private staff delivery paths. Only accepted staff delivery permits the “sent to the team” next step. If no private destination accepts the card, use the email fallback; never turn a public card or a customer-thread send into proof that staff received it.

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
