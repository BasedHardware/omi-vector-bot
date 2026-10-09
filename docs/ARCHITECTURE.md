# Omi Support Bot Architecture

Omi Support Bot solves documented problems and routes unresolved cases toward a person. Customer reassurance must describe actions and evidence the system can verify. The workflow foundation described below is implemented on the working branch; production rollout is tracked separately in [the roadmap](../ROADMAP.md). The recording-diagnostics gateway remains a target design, not newly granted access. The existing official-source answer and review pipeline remains in place.

## Current capabilities and gaps

The bot already retrieves official knowledge, checks answers, reads verified Shopify orders, sends private staff cards, and supports staff-approved GitHub filing. It has no customer recording-diagnostics integration. Personal access to GCP does not authorize the bot.

The implemented foundation addresses these audited workflow gaps:

- Postgres now holds shared claims, case leases, repeat fingerprints and encrypted verification/throttle state. Memory remains a development/evaluation mode only (`supportRuntime.js`, `supportIdentityStore.js`).
- Durable cases distinguish delivery, actual staff acceptance and closure. `/done` and Telegram resolve only after customer delivery; customer-authorized reopening protects newer cases (`supportCases.js`, `commands.js`, `telegram.js`).
- Three leased worker slots bound execution. Excess requests persist metadata-only references for recovery; shutdown drains accepted work and queues work that has not started. Started requests with uncertain delivery are not blindly replayed (`supportRuntime.js`, `index.js`).
- An explicit order miss no longer substitutes another order; returned facts must match both the requested number and verified owner. Historical-order pagination/access remains follow-up work (`shopify.js`, `orderFlow.js`).
- Encrypted engineering proposals and private case/source/repository links survive restart. Staff author a technical summary, inspect the exact public payload and confirm its revision; atomic claims prevent parallel publication. Unknown remote outcomes stay held for read-only reconciliation, not automatic retries (`supportApprovals.js`, `supportIssueLinks.js`, `githubFlow.js`).
- Full Discord staff delivery and GitHub controls require a verified staff-only audience and bot send permission. An unknown direct member grant fails closed; no broader member intent or permission is added (`discordPrivacy.js`, `handoff.js`).

A complete delivery outbox, retained cumulative case summary, staff queue and customer diagnostic gateway remain implementation work, not guarantees of this foundation.

A bounded October 6–9, 2026 sample contained ten timed replies and ten escalation log lines. Three of nine sampled bot-authored help-thread messages contained inability/access wording. The sample excluded archived threads and was not a census or answer-quality grade; it does not establish that most replies have this problem.

## Workflow ownership

Keep one application-controlled pipeline. The model interprets the question and drafts language; application policy controls access, execution, delivery, and case transitions.

```text
Discord event → durable claim and case context → intent and access policy
    → official evidence and permitted diagnostic checks → answer and review
    → privacy-safe delivery → verified handoff or resolution → follow-up
```

Use the existing Postgres database for support cases, jobs, claims, and delivery records. Separate the Discord adapter, case service, policy checks, knowledge retrieval, tool adapters, and worker responsibilities through module boundaries. A rewrite or separate service for every responsibility is unnecessary. Put the new privileged diagnostics boundary inside the Omi backend, not inside the model process.

## Minimal access boundary

| Capability | Information allowed | Boundary |
| --- | --- | --- |
| Official knowledge | Help Center, product/developer docs, official source, approved incidents and releases | Read only; record source and freshness. A merged PR alone does not prove deployment or resolution. |
| Order lookup | Exact verified order, fulfillment/tracking facts and observation time | Existing email verification; private response only. No refund, cancellation, address or fulfillment writes. |
| Recording diagnostics | Upload/session/sync/finalization states, bounded error codes, storage availability metadata | New Omi sign-in and explicit case-bound diagnostic grant; no transcript, audio, summary, or photos. |
| Support cases | Case status, delivery receipt, staff acceptance, resolution | Write only the support system's records. Do not treat delivery as acceptance or resolution. |
| GitHub | Relevant issues, releases and official source; staff-authored, sanitized technical summaries | Narrow repository access. Staff approve the exact public issue/comment revision; no automatic raw customer forwarding, code, merge, Actions, secrets, or deployment permissions. |
| Discord | Trigger message, authorized continuation, customer thread and staff destination | Preserve mention-only behavior outside support spaces. No Administrator, role management, or ambient server-wide ingestion. |

Do not give the bot project Owner/Editor, backend impersonation credentials, general Firestore access, audio-bucket download permission, full customer conversation scopes, arbitrary log queries, shell execution, or Railway administration. Read-only credentials can still leak private information.

### Backend diagnostics gateway

Introduce a backend-owned `diagnose_recording` capability. Authenticate both the bot service and the customer. Omi sign-in issues a short-lived, revocable grant bound to the customer, case, permitted operation and expiry. Derive the customer UID on the server; a UID, email, order number or Discord staff role supplied in chat is not proof of ownership. The existing Shopify email binding is not an Omi account authorization.

The gateway accepts an opaque case/recording handle and a bounded time window. It checks ownership of every session, conversation and job, reads pure metadata projections, and returns an allowlisted response: observation time, pipeline stage, status, bounded reason code, available evidence, uncertainty, and a supported next action. Distinguish `unknown`, `not_found`, `expired`, and verified failure. No event found does not prove a recording never existed or cannot be recovered.

Keep identifiers, credentials and authorization tokens outside model inputs. Exclude raw logs/exceptions, audio/transcripts, titles/summaries, photos, object paths, signed URLs and unrelated customers. Render private facts only in an authorized private customer response or staff case; a public mention never authorizes publishing them.

The backend already has useful session, sync, finalization and storage metadata. Do not proxy existing endpoints blindly: sync polling can change stale-job state; recording-existence checks can download audio; existing conversation reads can decrypt content. Add genuinely read-only projections and a diagnostics-only permission instead. Recovery, reprocessing and deletion remain separate human-authorized operations.

For later log correlation, a dedicated gateway identity can read only an approved support log view. A view limits entries but does not automatically redact their contents or enforce customer ownership; the gateway must normalize results and apply case policy. Google supports [view-scoped access](https://docs.cloud.google.com/logging/docs/logs-views). Do not grant project-wide Logs Viewer to the bot. Prefer short-lived workload credentials where the actual hosting identity supports [Workload Identity Federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation); Railway federation support has not been established here.

## Customer workflows

### Documented questions

Use the current question plus relevant case context. Retrieve official evidence, answer the actual goal, and retain the review and source formatting checks. Preserve what the customer tried; do not repeat failed steps. Pure thanks receive no reply. Clarify only when the missing detail changes the answer.

### Missing recordings

Acknowledge the impact and immediately protect potentially unsynced data. Provide a private verification step, obtain diagnostic consent, and inspect the permitted pipeline metadata. Explain observed facts without guessing root cause or promising recovery. If unresolved, deliver one staff case containing the diagnostic timeline, attempted steps and missing information. Logs can locate a failure stage; they cannot recreate absent audio.

### Orders and other person-required requests

Use the exact verified order privately when available. Refund, replacement, billing, account and privacy decisions remain with staff. Give safe documented steps where applicable and one next step. Once staff delivery succeeds, do not also tell the customer to email another channel. If delivery fails, use the existing honest fallback.

### Human handoff and closure

The current case states are `queued`, `delivered`, `accepted`, `resolved`, and `closed`, with an explicit reopening transition. An authenticated staff acceptance records its actor and time; delivery alone does not count. Delivery failure is an attempt outcome, not resolution. Staff get the current intake and a link to the conversation; a retained cumulative summary and a distinct `awaiting_customer` state are follow-up work. Reminders and target response times belong to a real staffed queue; do not publish an SLA before an owner commits to it.

### Staff-approved engineering work

An application-owned proposal is bound to the case, customer, original source message, private staff destination, bot identity, repository and fixed target. Its sanitized payload is encrypted with the existing `DATA_ENCRYPTION_KEY`; database failure does not downgrade to a process-local publication map. Missing encryption configuration disables this optional capability while the human handoff remains available.

The original bot card opens a single-use, staff-bound editor. Staff enter a technical summary in their own words; only that sanitized summary is used for related-work search. The bot presents the exact public payload privately and binds its message, revision and payload hash to the confirming staff member. Editing invalidates earlier previews. Related work is background, not proof of deployment or a reason to silently retarget the approved action.

Publication proceeds under one atomic claim. Save the verified GitHub receipt and a private repository/case/customer/source link. A successful POST followed by a failed local save is an uncertain boundary, not a reason to send another POST. A later check verifies the opaque operation marker, exact approved bytes, fixed target and saved GitHub App provenance through the official API. Missing proof remains held; a matching public marker alone establishes neither ownership nor authorization. A confirmed receipt can repair a private link without writing to GitHub again.

Important later evidence in the owning customer's dedicated thread can stage a new comment proposal only when exactly one engineering issue is linked. Staff still write and approve the public summary. Ambiguous multi-issue cases and shared-channel follow-ups require manual selection. Search similarity alone does not create a case link. Webhook notices in shared channels reply only to the verified original customer message; thread fallback needs dedicated customer/handoff ownership. Legacy internal thread links support status notices only for actual threads in the original repository; public issue-body markers are not imported as new customer ownership. Historical public issues are not rewritten by this change. A merge notice names the pull request, not its referenced issue, and explicitly does not claim a released fix.

Pending proposals expire for editing/publication after seven days and editors after ten minutes; uncertain actions remain reconcilable. Expiry does not yet purge stored ciphertext. Automated retention/deletion and a general delivery outbox remain roadmap work. Customer tracking notices are best-effort and do not imply staff acceptance, release or resolution.

## Communication policy

Lead with acknowledgment and a useful action, not repeated capability disclaimers. Use one clear next step and the customer's language. State important limits briefly without concealing uncertainty or data-loss risk. Never invent an investigation, staff receipt, acceptance, fix, deadline or guaranteed outcome.

For example, before verification: “Losing a meeting recording is frustrating. Please don't reinstall or clear storage yet. Verify your Omi account privately so we can check its upload and processing status.” This wording is usable only after that verification/check workflow exists. After confirmed delivery: “I've sent the details to the support team. The next update belongs in this thread.” Do not say someone has accepted the case until that acceptance is recorded.

## Reliability and audit controls

Use transactional message claims with leases, per-case ordering, bounded worker concurrency, and a durable delivery outbox. Record accepted sends and identifiers; reconcile uncertain outcomes before retrying. Do not promise exactly-once delivery across Discord and the database without handling that boundary. Shutdown stops new claims and lets accepted work finish or safely resume.

Enforce customer isolation, authorization, time/result bounds, output schemas and rate limits outside the model. Treat documents and tool results as untrusted input, not instructions. Use feature flags for each capability, a kill switch for private diagnostics, separate development/production identities, and revocation and credential-rotation procedures.

Operational logs contain opaque case/request references, stage times, token counts, tool outcome codes, escalation reasons and delivery state—not customer content or secrets. Keep diagnostic/audit retention deliberate and approved. Public diagnostics remain disabled until isolation, privacy, restart, overlap and real-delivery tests pass.

See [the implementation checklist](IMPLEMENTATION_PLAN.md) for rollout order and acceptance gates.
