# Omi Support Bot Architecture

Product acceptance is governed by [SUPPORT_MASTER_PLAN.md](SUPPORT_MASTER_PLAN.md), not a succession of unrelated review fixes. The target loop is scoped support → sourced answer/review → confirmed delivery/case state → approved case context → minimized review signals → officially evidenced correction → staff authorization → automatic regression validation → controlled publication/revocation → honest outcome measurement. The memory and fix-inbox stages remain disabled/unimplemented as recorded below; this is the coherent target pipeline, not a claim that the loop is live. New review findings map back to a master-plan item and its evidence.

Omi Support Bot solves documented problems and routes unresolved cases toward a person. Customer reassurance must describe actions and evidence the system can verify. Reports 1–3 passed. The retained October 12 release record has #43 merged at `dad2505` and deployed as `a6c7c577-4cc5-47b9-bf05-ba63444425e4`, with its live Spanish/Chinese close/reopen smoke still pending. This branch does not perform a new production check or release. The recording-diagnostics gateway remains a target design, not newly granted access. The existing official-source answer and review pipeline remains in place.

Closing-card language follows the same persisted `context.replyLanguage` used by acceptance notices: case lookup → deterministic localized card → confirmed customer send → durable case closure → thread archive. `closingCopy.js` covers the acceptance language set with an English fallback. Feedback identity, ownership, review URLs and optional-review semantics are unchanged; staff locale does not override the customer language. Localization covers card content only, not `/done` acknowledgments or subsequent feedback responses.

## Draft support-experience integration — not enabled in production

October 18 persona revision: the latest review replaces the earlier elegant/charming instruction with **calm, warm and practical** and retains visible **Mira · Omi AI support**. One shared `SUPPORT_PERSONALITY` reaches every answer lane and the reviewer; the existing fictional portrait is unchanged. This is a narrow change in the existing voice/identity pipeline, not a new conversation or training system. It does not replace evidence, privacy, actual case state, customer language or handoff controls. Serious cases remain calm and non-playful; no flirtation, pet names, personal biography or human-employee claim. [The personality guide](MIRA_PERSONALITY.md) records research, six observed red checks followed by eight focused/760 full/eight offline passes, and prompt-test limits. Release 1 is already live and accepted; this changed reply contract is not deployed, and its comparison waits for #48 grading. No profile mutation or optional flag change accompanies this correction.

`supportVoice.js` provides one plain-language, concise answer/reviewer contract and the proposed Mira identity, with an explicit AI label. Existing policy, source ranking, deterministic safety checks and human-controlled case transitions still govern correctness. Aryan's updated Release 1 brief combines #42 and #45 via merge commits: topic lanes escalate only on reported failure, navigation/conditional grammar does not manufacture failures, complete-item clipping preserves citations/warnings, multipart coverage uses at most four pages within the existing 9,000-character evidence cap, and damaged-item intake requests damage evidence, private purchase email and delivery date. The old separate 1,500-character prompt budget is removed in favor of the shared voice contract. #46's non-blocking, refreshed typing indicator is in the main baseline and candidate. The authorized fresh comparison completed October 18 and subsequent independent review approved deployment, explicitly accepting the borderline increased handoff flag. Actual rollout/staff-audience verification remain open; nothing is deployed by this integration. See the roadmap for results and limitations.

### Release 2 target — references only, not yet implemented

Aryan approved 30-day support memory and replaced the encrypted-text design below. Implement after Release 1's deployment on `feat/memory-references` from main. Persist only scoped guild/forum/thread/owner/message references, role, message time/expiry and text-free outcomes. Migrate away memory ciphertext/IV/tag idempotently without touching encrypted identity/order state. Minimal customer/forum suppression state is still necessary to honor opt-out; identifiers and outcomes remain protected customer-related data.

The optional context adapter finds at most two other recent posts by the same owner in the same allowlisted forum/guild, then validates live scope/ownership and reads the live title, last three owner messages and this bot's last reply. It never enters staff/handoff channels or another owner's post. Mark it `conversation_only`, excluded from official evidence/citations; it only avoids repeated intake or already-tried steps. The whole extra lookup/read path has a 1.5-second deadline, fixed metadata-only diagnostics and normal current-post fallback. A timeout must prevent late content from entering the answer. Core `/health` and delivery do not depend on this optional path.

The existing capture/policy/context/forum flags remain off by default. Turning off capture/context stops new writes/use while erasure and mandatory expiry remain available. Forgetting removes all of that owner's forum references/signals and blocks future/queued saving across posts and restarts. Live deletion errors remove references; denied/unavailable reads merely omit context. No text, prompt, title, attachment, embedding or raw exception is added to memory tables. Outcome categories feed the reviewed improvement loop, never automatic product knowledge or training.

```text
Scoped support event → existing answer/review/delivery pipeline
         └─ optional observer → bounded queue → expiring references + outcomes
New owner post → scoped pointer lookup → live Discord reads (≤1.5 s)
              → untrusted remembered attempts, or current-post fallback
Review signals → authorized reviewer → sourced fix → regression → publication
```

The replacement requires unit/SQL/CI checks, memory-off comparison and independent grading before merge/deploy. Enabled behavior needs an approved isolated test runtime or reviewed test-only deployment, then 48 clean hours **and** functional checks before reviewed help-forum expansion. The notice is drafted, not confirmed pinned. This is the target architecture; the encrypted-text foundation below describes the code still present and disabled.

### Existing disabled foundation — superseded for enablement

```text
Scoped support event ──→ existing answer/review/delivery pipeline
         └─ optional observer → bounded write queue → encrypted case text
Customer follow-up → separately gated, owner-scoped/live-validated context
Operational outcomes → private metadata events → aggregate review actions
                                               (no auto-publication)
```

`supportMemory.js` enforces guild/thread/customer isolation, permitted authors, redaction, message age and AES-GCM authenticated encryption. Ciphertext is bound to the scope, message and role. `supportMemoryStore.js` uses the same Postgres service with per-thread advisory transactions, idempotent versions and deletion tombstones; no database-error fallback to process memory exists. The in-memory adapter is for tests only. New tables are additive and contain no attachment contents. Proposed text retention is at most 30 days from message creation, with 200 messages per thread, 2,000 redacted characters per message and bounded cleanup batches. Regex redaction is defense in depth, not complete anonymization.

`supportLearning.js` observes configured forum posts only, including otherwise quiet staff messages, without broadening reply triggers. Only the post owner, explicitly named staff and this bot are captured. Retained context never crosses customers and is untrusted conversation history, not an official fact or an instruction. Each older message used in a reply is revalidated with an uncached Discord read; denied/missing reads omit it. Context retrieval uses a two-second deadline and at most five older references. Missed events, caps, dropped optional writes, unavailable Discord and expiry can reduce coverage; this is not an exhaustive archive or a guarantee against all deleted-data retention.

The capture kill switch does not disable deletion/expiry cleanup for known stored posts. Invalid encryption disables the optional capture/context capability, not core support. Physical cleanup runs in bounded batches even with capture off; inaccessible/expired text is never eligible for contextual reads. Per-post opt-out intentionally keeps only the minimum suppression identifiers needed to prevent recapture.

Deletion events in the explicitly enabled capture pilot persist a tombstone even before a queued first capture has registered its post. Outside that pilot, deletion handling remains restricted to previously stored posts, avoiding ambient deletion metadata. Expiry sweeps bypass the optional capture queue and concurrent local sweeps coalesce, so a full queue cannot drop mandatory retention cleanup.

Capture requires `SUPPORT_MEMORY_ENABLED=1`, `SUPPORT_MEMORY_POLICY_APPROVED=1`, an explicit `SUPPORT_MEMORY_FORUM_IDS` subset of the configured help/test forums, durable storage and a valid encryption key. No forum is included by default. Reply reuse additionally requires `SUPPORT_MEMORY_CONTEXT_ENABLED=1`. All are disabled by default and remain so here. The first enablement is a reviewed, limited shadow pilot, not automatic public context use. Customer `/forget-support-history` is private and owner-checked; it deletes the post's retained text/signals and persists only the suppression identifiers needed to prevent recapture. It works after capture is disabled and does not delete Discord messages.

Outcome collection uses fixed categories, not text, exception messages or private tool results. Those case-bound records support operational follow-through; only aggregate category/area counts enter improvement suggestions. `scripts/support-quality-report.js` is operator-only and read-only. Suggestions always need review and cannot change prompts, product instructions, routing, model weights or deployments. A fully reviewed knowledge-proposal worker, provenance/freshness approval UI and automatic regression promotion remain future work.

The reviewed-fix target must extend `knowledge.js`, not blindly call the legacy database insertion. Current `index.js:searchKnowledge` deliberately excludes unprovenanced legacy database notes; `handleFaqSave` adds a bounded in-process note, and boot hydration can reconstruct notes from named-staff `faq:` messages. The future durable record therefore needs source evidence, actual approver, version, publication/revocation state, expiry/recheck and internal deletion-aware provenance. Normal retrieval and startup hydration must enforce that state so a revoked/expired fix cannot return from an older Discord note or cache. Migration must preserve existing behavior without promoting legacy rows. This is an architectural prerequisite for the fix inbox, not a newly enabled knowledge path.

## Current capabilities and gaps

The bot already retrieves official knowledge, checks answers, reads verified Shopify orders, sends private staff cards, and supports staff-approved GitHub filing. It has no customer recording-diagnostics integration. Personal access to GCP does not authorize the bot.

The implemented foundation addresses these audited workflow gaps:

- Postgres now holds shared claims, case leases, repeat fingerprints and encrypted verification/throttle state. Memory remains a development/evaluation mode only (`supportRuntime.js`, `supportIdentityStore.js`).
- Durable cases distinguish delivery, actual staff acceptance and closure. `/done` and Telegram resolve only after customer delivery; customer-authorized reopening protects newer cases (`supportCases.js`, `commands.js`, `telegram.js`).
- Three leased worker slots bound execution. Excess requests persist metadata-only references for recovery; shutdown drains accepted work and queues work that has not started. Started requests with uncertain delivery are not blindly replayed (`supportRuntime.js`, `index.js`).
- An explicit order miss no longer substitutes another order; returned facts must match both the requested number and verified owner. Historical-order pagination/access remains follow-up work (`shopify.js`, `orderFlow.js`).

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
| GitHub | Relevant issues, releases and official source; redacted proposed issues | Narrow repository access. Staff approve public writes; no code, merge, Actions, secrets, or deployment permissions. |
| Discord | Trigger message, authorized continuation, customer thread and staff destination | Preserve mention-only behavior outside support spaces. No Administrator, role management, or ambient server-wide ingestion. |

Do not give the bot project Owner/Editor, backend impersonation credentials, general Firestore access, audio-bucket download permission, full customer conversation scopes, arbitrary log queries, shell execution, or Railway administration. Read-only credentials can still leak private information.

### Incremental access and shadow boundary

The [roadmap's access ladder](../ROADMAP.md#access-ladder-and-support-voice) orders new work: reviewed public issues/releases and product facts, private verified order facts, linked-account metadata, then recording diagnostics. Public records remain sourced, versioned and freshness-checked; staff authorship alone does not prove a fact or deployment.

Every new adapter starts with synthetic/customer-independent validation and an authorized staff-only shadow pilot. The application enforces customer/case ownership, consent, read-only operation, bounded output and a fixed schema before staff see a result. Keep private facts out of model inputs and normal thread posts. Kill switches and metadata audits are per capability; shadow mode neither grants authorization nor guarantees confidentiality. Existing ephemeral order commands continue to work. Account sign-in/metadata requires backend agreement and privacy review before implementation, just as diagnostics does. An unavailable offline-device count is unknown, not zero.

Support-state writes and staff-approved redacted GitHub filing remain controlled exceptions for the bot's own workflow, not write permissions over customer orders, accounts or recordings. No new capability is enabled by this documentation.

### Backend diagnostics gateway

Introduce a backend-owned `diagnose_recording` capability. Authenticate both the bot service and the customer. Omi sign-in issues a short-lived, revocable grant bound to the customer, case, permitted operation and expiry. Derive the customer UID on the server; a UID, email, order number or Discord staff role supplied in chat is not proof of ownership. The existing Shopify email binding is not an Omi account authorization.

The gateway accepts an opaque case/recording handle and a bounded time window. It checks ownership of every session, conversation and job, reads pure metadata projections, and returns an allowlisted response: observation time, pipeline stage, status, bounded reason code, available evidence, uncertainty, and a supported next action. Distinguish `unknown`, `not_found`, `expired`, and verified failure. No event found does not prove a recording never existed or cannot be recovered.

Keep identifiers, credentials and authorization tokens outside model inputs. Exclude raw logs/exceptions, audio/transcripts, titles/summaries, photos, object paths, signed URLs and unrelated customers. Render private facts only in an authorized private customer response or staff case; a public mention never authorizes publishing them.

The backend already has useful session, sync, finalization and storage metadata. Do not proxy existing endpoints blindly: sync polling can change stale-job state; recording-existence checks can download audio; existing conversation reads can decrypt content. Add genuinely read-only projections and a diagnostics-only permission instead. Recovery, reprocessing and deletion remain separate human-authorized operations.

For later log correlation, a dedicated gateway identity can read only an approved support log view. A view limits entries but does not automatically redact their contents or enforce customer ownership; the gateway must normalize results and apply case policy. Google supports [view-scoped access](https://docs.cloud.google.com/logging/docs/logs-views). Do not grant project-wide Logs Viewer to the bot. Prefer short-lived workload credentials where the actual hosting identity supports [Workload Identity Federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation); Railway federation support has not been established here.

## Customer workflows

### Documented questions

Use the current question plus relevant case context. Retrieve official evidence, answer the actual goal, and retain the review and source formatting checks. Preserve what the customer tried; do not repeat failed steps. Pure thanks receive no reply. Clarify only when the missing detail changes the answer.

Phase 4 separates technical topics from reported failures. APP/DESKTOP/FIRMWARE still select their retrieval lane, but a deterministic handoff requires an observed failure or an independently protected person-required signal. Capability questions and diagnostic-guide topics are not failures by themselves; a real fault inside a question still is. Model/reviewer rejection, human requests and data-loss signals remain independent handoff grounds, not suppressed by a how-to label. Navigation/confusion predicates are removed as failure signals, not the rest of the message. Conditional clauses do not assert a fault; independent main-clause failures still do, including when the customer omits a comma.

Multipart planning retains bounded neutral `{question, query}` pairs in the requested order. With more than three distinct parts, retrieval selects up to four complementary pages, without increasing the eight-chunk/9,000-character output budget. Stored and in-memory evaluation corpora use the same coverage selector before formatting; the ordinary concatenation path remains untouched. Grounded multipart citations may include four exact retrieved URLs, while ordinary replies retain two. Release 1's shared plain-language word contract replaces the earlier separate 1,500-character prompt budget. Overflow presentation keeps complete bullets/steps or prose sentences plus the intact Source line; data-loss warnings use the same boundary and are never shortened away.

### Missing recordings

Acknowledge the impact and immediately protect potentially unsynced data. Provide a private verification step, obtain diagnostic consent, and inspect the permitted pipeline metadata. Explain observed facts without guessing root cause or promising recovery. If unresolved, deliver one staff case containing the diagnostic timeline, attempted steps and missing information. Logs can locate a failure stage; they cannot recreate absent audio.

### Orders and other person-required requests

Use the exact verified order privately when available. Refund, replacement, billing, account and privacy decisions remain with staff. Give safe documented steps where applicable and one next step. Once staff delivery succeeds, do not also tell the customer to email another channel. If delivery fails, use the existing honest fallback.

Phase 4 damaged-item/replacement intake requests photos or video, the order email privately and the delivery date. This requires a physical-item damage/replacement signal, not replacing an account field, receipt or redemption code. Ordinary missing-delivery intake keeps its tracking details; private order retention and public redaction boundaries are unchanged.

### Human handoff and closure

The current case states are `queued`, `delivered`, `accepted`, `resolved`, and `closed`, with an explicit reopening transition. An authenticated staff acceptance records its actor and time; delivery alone does not count. Delivery failure is an attempt outcome, not resolution. Staff get the current intake and a link to the conversation; a retained cumulative summary and a distinct `awaiting_customer` state are follow-up work. Reminders and target response times belong to a real staffed queue; do not publish an SLA before an owner commits to it.

### Live staff cards and acceptance updates (draft)

Keep the same five lifecycle states and active-case uniqueness rule. An accepted case has an optional `work_status` (`in_progress` or `waiting_customer`), set only through authorized staff actions. No activity/timer heuristic means a person is working. Reopening clears the previous acceptance/work state; the next acceptance gets its own generation ID while repeated clicks in that cycle retain the first actor/time.

`caseCards.js` projects this state into existing bot-authored private staff cards. `support_case_cards` stores only case/channel/message references and synchronization metadata, never intake text. State-change events update immediately; a bounded startup/30-second sweep repairs unsynchronized cards after restarts or transient failures. A per-case Postgres advisory lock serializes cross-copy edits, using the locked connection for all database reads/writes. Edits preserve intake and engineering controls; deleted cards are retired instead of recreated. Public copies strip every case control and private status/identity reference.

Acceptance posts a short localized update naming the actual acceptor in the bound customer destination, with all mentions disabled and no ETA or investigation/resolution claim. Shared-channel replies verify the original message's customer before sending. A durable per-acceptance-generation claim prevents repeated clicks from posting again; the Discord nonce is additional short-window deduplication, not a global exactly-once guarantee. Every unconfirmed notification result is surfaced in the accepting staff member's ephemeral response, explicitly asking them to reply in the customer's thread; a log line alone is not sufficient. Core case acceptance is not undone. This is a scoped case-state notification, not a second general delivery ledger or an extension of #29/#30.

## Communication policy

Lead with acknowledgment and a useful action, not repeated capability disclaimers. Use one clear next step and the customer's language. State important limits briefly without concealing uncertainty or data-loss risk. Never invent an investigation, staff receipt, acceptance, fix, deadline or guaranteed outcome.

For example, before verification: “Losing a meeting recording is frustrating. Please don't reinstall or clear storage yet. Verify your Omi account privately so we can check its upload and processing status.” This wording is usable only after that verification/check workflow exists. After confirmed delivery: “I've sent the details to the support team. The next update belongs in this thread.” Do not say someone has accepted the case until that acceptance is recorded.

## Reliability and audit controls

Use transactional message claims with leases, per-case ordering, bounded worker concurrency, and a durable delivery outbox. Record accepted sends and identifiers; reconcile uncertain outcomes before retrying. Do not promise exactly-once delivery across Discord and the database without handling that boundary. Shutdown stops new claims and lets accepted work finish or safely resume.

Enforce customer isolation, authorization, time/result bounds, output schemas and rate limits outside the model. Treat documents and tool results as untrusted input, not instructions. Use feature flags for each capability, a kill switch for private diagnostics, separate development/production identities, and revocation and credential-rotation procedures.

Operational logs contain opaque case/request references, stage times, token counts, tool outcome codes, escalation reasons and delivery state—not customer content or secrets. Keep diagnostic/audit retention deliberate and approved. Public diagnostics remain disabled until isolation, privacy, restart, overlap and real-delivery tests pass.

See [the implementation checklist](IMPLEMENTATION_PLAN.md) for rollout order and acceptance gates.
