# Omi Support Bot: master product plan

Updated October 18, 2026 (IST). Owner: Codex implementation, Aryan product decisions, Omi authorization and named staff operational review.

## The goal stays the same

Make support useful for a person who knows nothing about the technology: a short, understandable answer, one clear next step, remembered attempts, and a real person when needed. Make the whole path reliable. Improve from observed problems through checked, reviewed fixes, without making Aryan manufacture routine tests.

A friendly name is not the goal. Neither are a faster benchmark, more features, passing unit tests, or closing a particular pull request. Success is a customer getting correct help without repeating themselves, being misled, losing private information, or disappearing between the bot and staff.

This is the controlling product checklist. [ROADMAP.md](../ROADMAP.md) records dated execution/evidence; [ARCHITECTURE.md](ARCHITECTURE.md) explains the integrated system; [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) maps engineering work; [RUNBOOK.md](RUNBOOK.md) governs operations. Older dated release instructions remain evidence, not the current product direction. Explicit user instructions and safety/privacy/release restrictions still take precedence.

## How review feedback is handled

1. Map each finding to an item below and establish the customer failure it prevents.
2. Check the evidence; accept, adapt, defer or reject the recommendation with a reason. A second opinion is input, not an automatic replacement for the goal.
3. Fix the cause, add a failing regression first, verify the whole affected workflow, and record the evidence.
4. Return to the next unfinished product item. Do not silently drop an item because a new review arrived.
5. If scope or order genuinely changes, record the decision and its effect on the remaining checklist. Do not add disconnected features or rewrite the system unnecessarily.

Code, tests, approval and production are different states. **A master checkbox is complete only when its acceptance checks and required rollout are verified.** Marking code implemented elsewhere does not complete it here. A blocked item stays visible with the exact missing approval; work on independent safe tasks can continue. There is no promise that an outside party will approve something or that every customer can be helped automatically.

## Current checkpoint

- Release 1 draft [#47](https://github.com/BasedHardware/omi-vector-bot/pull/47), runtime `e7601a3`, combines #42's routing/retrieval/clipping/intake and #45's concise voice/default-off memory. Local 755/755 tests, offline 8/8 and isolated SQL pass; hosted Node 20/24/Postgres pass. This is implementation/testing evidence, not customer-quality approval or deployment.
- Typing repair [#46](https://github.com/BasedHardware/omi-vector-bot/pull/46) merged as `273550c`; it is in both comparison arms. Merge is not deployment.
- First comparison attempt is preserved but incomplete: main completed 162 rows, candidate 46. macOS recorded lid-closed sleep at 00:48:57 IST for 963 seconds despite active keep-awake assertions; the runner's no-progress watchdog sent SIGTERM on wake. Completed candidate rows had no crash/empty/error flags and a maximum 54.226-second latency, not a verified provider hang. No protected input was inspected. Aryan explicitly authorized a fresh same-day two-arm rerun with the Mac plugged in and lid open; both versions/harness remain frozen. Do not grade the partial comparison or tune from it.
- #45's memory privacy repair passed 702 local tests and hosted checks at `d60236c`: delete-before-first-capture and non-starvable expiry cleanup are covered. Capture, contextual reuse and the future fix inbox are **off**. No real conversation retention, training job or new private capability is enabled.
- #41 has accepted live workflow evidence. The retained #43 deployment record still has live localization/reopen smoke pending. #28's last audience preflight stopped at `untrusted_role_can_view`; do not rerun until Aryan confirms permissions fixed. #29/#30 are not shipped.
- Product progress is **not** a made-up percentage. The unfinished acceptance checklist below is the remaining work.

## A. Short, clear, humane and correct answers

- [ ] **A1 — One consistent voice and identity, verified live.** Normally 40–80 words, simple language, short paragraphs and one useful next action. Acknowledge the actual disruption and avoid repetitive greetings/apologies. Use the working name Mira with a visible AI label, not a fictional employee. Preserve necessary warnings, uncertainty, sources and requested parts; detailed developer questions can be longer. Verify English, Spanish and Chinese examples without declaring prompt instructions a guarantee.
- [ ] **A2 — Correct help, not automatic technical handoffs.** Navigation/confusion and hypothetical conditions are not failures; independent crashes, missing recordings and other actual failures remain failures. Money/account/privacy/replacement decisions still need a person. Retrieve each supported part of a multipart question within the existing evidence cap; preserve whole steps and source URLs when clipping. Damage intake asks for damage photos/video, private purchase email and delivery date, not unnecessary tracking details. Review real answer quality as well as routing flags.
- [ ] **A3 — Complete the Release 1 gate and rollout.** Deliver both fresh result JSONs, all changed cases/runs, signals, judge problems, word-count median/p90 and provenance for independent grading. Relative gate: pass-both ≥ main −2, p50 ≤ main +2 s, p95 ≤ main +6 s; also require fewer false how-to handoffs, no missed protected handoffs and no mid-item clipping. After approval, release one version, record rollback, verify customer answers/staff receipt and preserved existing behavior. Do not deploy merely because CI is green.
- [ ] **A4 — Honest progress while waiting.** Verify the refreshed typing indicator and cosmetic-error isolation after release. Never invent an investigation, accepted case, deadline, recovery or fix to fill the wait. Retain evidence for the previously pending localized closing/reopen smoke before calling it verified.

Implementation: shared voice, routing, retrieval, answer/review, honesty filters and delivery remain one pipeline. Research and its limitations are recorded in [SUPPORT_EXPERIENCE.md](SUPPORT_EXPERIENCE.md); research findings are not an Omi performance forecast.

## B. Reliable support from question to real follow-through

- [ ] **B1 — Verify the staff audience.** After Aryan confirms the permission repair, run only #28's approved read-only preflight. Stop unless it returns `private_staff_destination`. Do not broaden allowlists or permissions to manufacture a pass. Review before pushing/merging/releasing the prepared workflow.
- [ ] **B2 — Keep one durable, truthful case.** Preserve customer ownership, private intake/approved issue drafts, actual staff receipt, first acceptor, accepted/in-progress/waiting/closed state, customer-language pickup notice and safe reopening. Preserve suggested specialist versus actual owner. Verify restarts, duplicate clicks, access loss and notice failure; never recreate intentionally deleted staff cards.
- [ ] **B3 — Finish queued delivery recovery.** Review #29's same-nonce retries, database-ledger-outage send behavior and a staff-visible alert for every held/blocked customer reply. Then review #30's close/reopen behavior. Test uncertain-send windows, overlapping workers, boot/drain failures and repeated actions. Do not claim global exactly-once delivery without resolving the database/Discord boundary.
- [ ] **B4 — Operate the workflow, not just the code.** Establish a named staff owner and a usable queue/alert route. Surface failed delivery and unconfirmed pickup notices with a concrete staff action. Confirm who sees the alert and how outages are handled; do not promise response times without a staffed commitment. Record rollback/kill-switch behavior and one-release-at-a-time verification.

Keep existing verified private order self-service working. Do not add broad customer-account access as a shortcut for reliable handoffs.

Inspected B2 follow-up: `utils.js` still uses “a person ... has this now” for a delivery-confirmed handoff, while `caseCards.js` has a separate durable acceptance notice naming the real acceptor. Review the delivery acknowledgment against that distinction: delivery copy must not imply an individual accepted the case. Cover delivered-but-unaccepted, accepted, repeated follow-up and failed-delivery wording in the customer's language. Do not change the currently frozen candidate or silently reuse its grade for a later canned-copy change.

## C. Remember the case safely

- [ ] **C1 — Clear the real data-use/security gates.** Obtain Omi approval for the necessary retention period (proposed maximum 30 days), accurate published privacy/retention/deletion notice, processor terms, backup erasure procedure, encryption/key-risk review and any required platform review. An environment flag or a pinned sentence is not approval. Resolve or explicitly authorize remaining security risks before new capture. Do not rotate encryption keys without preserving existing data.
- [ ] **C2 — Verify a private capture-only pilot.** Use an explicitly approved private test forum; capture only the post owner, named staff and this bot, with bounded encrypted/redacted text and no attachment contents. Context reuse stays off. Observe at least 48 clean hours **and** verify edits, deletion before/after writes, bulk/thread deletion, `/forget-support-history`, restart, expiry, full queues and storage/key outages. Elapsed time alone is not a pass.
- [ ] **C3 — Verify contextual replies separately.** With explicit approval, enable owner-scoped reuse in the test forum. Revalidate older messages live, cap extra reads/time, omit inaccessible/deleted content and preserve earlier attempts across restart. Test a second participant, wrong customer/guild, prompt injection, staff intervention and a revoked/deleted message. Conversation text is never authoritative product knowledge.
- [ ] **C4 — Expand only with evidence and control.** After reviewed pilot results and an accurate public notice, approve the help-forum scope separately. Keep capture/context kill switches and keyless deletion/expiry available; monitor missing coverage. Tell customers exactly what the command removes, what it does not remove, and how broader erasure is requested. Do not promise an exhaustive archive or retain everything forever.

This is case memory, not model training. Public visibility, server administration, consent or simple redaction alone is not permission to train on Discord API messages. No scraping, fine-tuning, training set or identifiable case export is part of this plan.

## D. Turn observed problems into reviewed improvements

Build as a separate `feat/fix-inbox` change on the approved foundation, default `SUPPORT_FIX_INBOX=0`. Test with synthetic data before any approved real-data pilot. Preserve one knowledge/review/publication pipeline rather than a parallel ungoverned FAQ store.

- [ ] **D1 — Detect useful signals, not assumed mistakes.** Owner-scoped events: “Still need help”/reopening, substantially repeated questions within 24 hours, English/Spanish “didn't work / was wrong” reports, named-staff intervention within 24 hours, rejected answer review, absent official evidence, and a how-to handoff. Deduplicate and preserve missing-coverage/outage information. A handoff, repeat or staff reply is a review signal, not proof the answer was wrong or the customer was solved.
- [ ] **D2 — Group safely and minimize review work.** Apply an approved de-identification process, then group by actual issue rather than broad area alone. A daily 09:45 IST staff digest has at most five groups: plain summary, a safe one-line bot response summary, safe staff-response summary if available, and suggested next action. No customer names, IDs, email/order/phone data or attachments in the digest. Internal provenance is scoped, expiring and deletion-aware. Verify the destination and permissions before sending.
- [ ] **D3 — Draft the right kind of correction.** A proposed fact needs official evidence, exact source link, affected product/version, uncertainty/conflicts, owner and freshness. Staff/customer messages identify what to investigate; they do not establish the product fact. A source contradiction goes to the documentation owner. A routing, retrieval, delivery or code bug goes to engineering, not a fabricated fact that hides it. No source means an evidence-gap proposal, not invented guidance.
- [ ] **D4 — Enforce review outside the model.** Authorized named staff get Approve, Edit (modal), Reject and Snooze seven days. Approvals record the actual actor and internal provenance; rejection suppresses the issue for 30 days. Persist decisions, deduplicate across restarts/copies, recheck authorization and handle stale/double clicks honestly. Review is private, not a public GitHub write.
- [ ] **D5 — Validate, publish, recheck and undo.** Extend the existing named-staff `faq:` path with provenance, versioning, official evidence and a 90-day recheck. Approval starts automatic validation; publish/use immediately **after** checks pass, not before. Add a genuinely synthetic regression question, never a copied customer message. Preserve source ranking and the independent answer gate. Support rejection/revocation, expiry, correction rollback and cache invalidation. Approval does not edit code/model weights or guarantee a mistake can never recur.
- [ ] **D6 — Close the loop automatically.** Run the synthetic regression set nightly offline, including approved-fact retrieval and revoked/expired facts. Alert the verified staff destination on regressions and make job/alert failures visible. Separate provider-based quality evaluation/cost approvals from offline checks. Maintain a tested kill switch; held failures must not silently publish a correction or claim successful improvement.

The existing aggregate report is a foundation only: **it does not complete any of D1–D6.** Staff review is intentional; the system automates detection, preparation, checks and follow-up, not blind learning from chat.

Implementation finding (October 18): the current `faq:` handler saves a bounded in-process staff note and can rebuild notes from named-staff messages at startup. Its legacy database table has no author/provenance/expiry and is deliberately excluded from model lookup. Simply inserting an approved fix there would neither make a durable reviewed fact usable nor support reliable revocation. D5 must add structured durable approval/source/version/expiry state to the existing knowledge service, make its normal lookup consume only eligible reviewed records, and prevent startup hydration/caches from resurrecting revoked or expired fixes. Preserve existing staff-note behavior and keep legacy unreviewed rows excluded; do not activate all old notes as a migration shortcut. This is an inspected dependency, not completed implementation.

Inspected D3 dependency: official Help Center articles 9942181 and 13154896 currently disagree about simultaneous multi-language transcription; the January 2026 app guide also describes multi-language support. Exact links/dates and the documentation-owner action are recorded in [SUPPORT_EXPERIENCE.md](SUPPORT_EXPERIENCE.md). Newer dates alone do not establish behavior for every app version. No Help Center edit or product-fact override has been made.

## E. Know whether customers are actually helped

- [ ] **E1 — Honest weekly scorecard.** Monday report: answered without *observed* staff intervention, still-need-help clicks/rate with its denominator, repeat questions, approved/published fixes and three unresolved topics. Include traffic, coverage gaps and unknown outcomes. No staff reply, a positive click, or a quiet thread is not verified resolution. Raw counts are not accuracy or causal proof of improvement.
- [ ] **E2 — Automatic checks replace routine manual probes.** CI covers existing workflows, synthetic multi-turn cases, languages, source conflicts, injection, privacy/ownership, edits/deletes, restarts, concurrent clicks, delivery failures, provider outages and rollback. Keep protected cases sealed, preserve baseline/provenance and require independent release grading. Aryan should not have to write test posts for unit/regression evidence. Only necessary authorized staging/live checks remain.
- [ ] **E3 — Demonstrate the finished workflow.** After staged enablement, verify one end-to-end path from question → correct short reply or real handoff → remembered follow-up → truthful closure/reopen → review signal → sourced correction → authorized approval → passing regression → controlled publication → later use → revocation. Record operational failures and representative quality outcomes. Do not call the product complete just because its component PRs merged.

## What is needed from Aryan / Omi

Ask only when the relevant stage reaches the gate; do not repeatedly request manual test conversations.

- Independent Release 1 grade and subsequent release approval.
- Omi's authorized privacy/security decision, an accurate policy/notice and the necessary retention/deletion/processor arrangements before capture.
- Confirmation that the staff-channel audience is repaired, plus an approved private pilot destination.
- A named staff reviewer/operational owner for the digest and exceptions. Mira remains the working name unless Aryan changes it; a naming discussion does not block synthetic implementation.
- Documentation-owner action for verified official-source conflicts. Never invent authority to edit the Help Center.

No new account/backend access, permission changes, secret rotation, production variables or deployment is implied by this checklist. Keep 24 clean hours between deployments unless Aryan explicitly grants an exception, and the separate 48-hour memory-pilot acceptance condition.

## Definition of complete and intentionally separate work

The first product version is complete only when A–E are checked with evidence, required gates are cleared, rollout is verified and operating ownership exists. Until then, report the next open item and exact blockers; retain this plan across reviews and chat handoffs. Codex owns maintaining and progressing it, not asking Aryan to restate the goal.

Potential future capabilities—customer-authorized backend diagnostics, refunds/account writes, a native app or training on separately licensed data—are not hidden prerequisites for this version and are not authorized here. Keep them in the existing roadmap/access ladder until separately scoped and approved. This plan improves the existing ecosystem; it is not a rewrite or an unlimited feature wishlist.
