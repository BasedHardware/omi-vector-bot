# Omi Support Bot: master product plan

Updated October 18, 2026 (IST). Codex keeps this plan current; Aryan sets priorities and approves product decisions.

## Progress: 36 / 100 delivery milestones

**Built and tested: 12/25 · Reviewed: 8/25 · Verified live: 4/25.**

This measures delivery work, **not answer accuracy or model speed**. The earlier 5/100 hid partial work; changing the count does not mean more work suddenly shipped.

<details>
<summary>How the score is counted — evidence, not estimates</summary>

Each of the 25 milestones earns one point for being built, tested, independently reviewed and verified live: 100 possible points. Draft code is not a finished feature. This uses the same evidence as the earlier score, not 31 points of new work.

Keep these milestones fixed unless the product scope actually changes. Recalculate the score from the four columns whenever evidence changes. A yes in Built/Tested covers the named milestone only, not every requirement in its wider A–E workstream. Existing draft checks count as local evidence, not proof of current-main integration or live quality. Review does not mean deployment. Live means the relevant operation was actually verified; for read-only checks and evaluation tooling, it does not imply new bot behavior was deployed.

| # | Milestone / evidence | Built | Tested | Reviewed | Live |
| --- | --- | --- | --- | --- | --- |
| 1 | Short, plain replies — Release 1 / A1 | yes | yes | yes | — |
| 2 | How-to versus failure routing — Release 1 / A2 | yes | yes | yes | — |
| 3 | Multipart sources, whole-item clipping and damage intake — Release 1 / A2 | yes | yes | yes | — |
| 4 | Source-ranking/confidence follow-up — #48 / A2 | yes | yes | — | — |
| 5 | Consistent elegant Mira character — #59 / A1 | yes | yes | — | — |
| 6 | Typing and cosmetic-error isolation — #46 / A4 | yes | yes | yes | — |
| 7 | Production-configured read-only staff audience check — B1 | yes | yes | yes | yes |
| 8 | Durable staff-card lifecycle and restart refresh — #41 / B2 | yes | yes | yes | yes |
| 9 | Localized, deduplicated pickup notices and visible notice failures — #41 / B2 | yes | yes | yes | yes |
| 10 | Durable private engineering approvals and startup privacy checks — #28 / B2 | yes | yes | — | — |
| 11 | Queued reply recovery — #29 / B3; not reverified for this score | — | — | — | — |
| 12 | Close/reopen hardening — #30 / B3; not reverified for this score | — | — | — | — |
| 13 | Operational queue, alert ownership and coverage — B4 | — | — | — | — |
| 14 | References-only memory store — C1 | — | — | — | — |
| 15 | Bounded same-owner context reuse — C2 | — | — | — | — |
| 16 | Forum-wide forgetting, deletion, expiry and isolation — C3 | — | — | — | — |
| 17 | Reviewed memory pilot and controlled expansion — C4 | — | — | — | — |
| 18 | Versioned reviewed-fact store and revocation foundation — #49 / D5 | yes | yes | — | — |
| 19 | Owner-scoped problem signals — D1 | — | — | — | — |
| 20 | Private grouped daily review inbox and staff controls — D2/D4 | — | — | — | — |
| 21 | Real source/regression validator and controlled fact publication — D3/D5 | — | — | — | — |
| 22 | Nightly regression checks and visible job failures — D6 | — | — | — | — |
| 23 | Honest weekly outcome scorecard — E1 | — | — | — | — |
| 24 | Existing automated regression/SQL checks and independently graded comparison tooling — E2 | yes | yes | yes | yes |
| 25 | Full support → memory → reviewed fix → revocation demonstration — E3 | — | — | — | — |

Total: **12 built + 12 tested + 8 reviewed + 4 live = 36/100**. Full A–E acceptance remains **1/21**; no unfinished checkbox is changed by this score. Mira's name/portrait are live, but the whole character milestone still needs review and live reply checks. Existing automation does not complete all future E2 scenarios.

</details>

## Start here — priorities and status

The goal: **short, clear help that works, remembers what the customer already tried, and reaches a real person when needed.** Mira must be friendly and clearly identified as AI. Memory is not model training.

| Priority | Work | Status | Next step |
| --- | --- | --- | --- |
| **1 — Release reliability** | Check the update already running | **Live; customer tests pending** | Verify short answers, languages, staff delivery, typing and restart behavior in the test forum. Roll back on a new customer-visible failure. |
| **2a — Better answers** | [#48: choose the right source](https://github.com/BasedHardware/omi-vector-bot/pull/48) | **Local and hosted checks pass; not released** | Get review and run its new comparison after Release 1's live checks. Handoff rules are unchanged. |
| **2b — Consistent personality** | [#59: Mira's elegant, warm and charming voice](https://github.com/BasedHardware/omi-vector-bot/pull/59) | **Local and hosted checks pass; not released** | Review the shared answer/reviewer instructions and quality-check them. The portrait/name are already live; startup persistence is still pending. |
| **3 — Safe memory** | Remember earlier attempts across a customer's posts | **Not started; switched off** | After Release 1's checks pass, build references-only memory on main. Review and test before enabling it. |
| **4 — Learn from problems safely** | [#49: reviewed improvement inbox](https://github.com/BasedHardware/omi-vector-bot/pull/49) | **Review fixes pass locally and in hosted checks; switched off** | Get review, then build detection, daily review cards and automatic checks. No automatic facts or retraining. |
| **Release queue — reliability** | [#28](https://github.com/BasedHardware/omi-vector-bot/pull/28) → [#29](https://github.com/BasedHardware/omi-vector-bot/pull/29) → [#30](https://github.com/BasedHardware/omi-vector-bot/pull/30) | **#28 local and hosted checks pass; not shipped** | Independent review of the current-main integration; then reply recovery and close/reopen checks. No second release before Release 1's live checks. |

Local work can continue while a live test or review is waiting. **A review finding adds to this plan; it does not replace the goal.** No new release, data capture or private access is approved by a status update.

## Done — with limits clearly stated

- **Staff case tracking:** Report 3 passed. Acceptance, work/wait states, restart refresh and closure have accepted live evidence.
- **Private staff-channel check:** the production-configured check passed; the four required bot permissions are allowed. This does not mean all of #28 is released.
- **#28 current-main integration:** preserved Release 1's concise voice, typing, localized case closure, disabled memory cleanup and readiness checks alongside durable private engineering approvals. The combined suite passes 844/844, offline 8/8 and isolated SQL; a fresh production-configured read-only gate returns `private_staff_destination`. Hosted Node 20/24/Postgres checks pass at runtime merge `758808a`; independent review is still pending. No merge to main, deployment, settings/permission change or memory enablement.
- **Release 1:** reviewed, merged and deployed. It includes shorter, simpler answers, routing/retrieval fixes and the typing repair. Health/startup checks pass; the customer tests below still need to finish.
- **Memory decision:** 30 days approved; Aryan is the daily fix reviewer. The new references-only implementation is not built or enabled.
- **Parked work:** nine GitHub issues opened, [#50–#58](https://github.com/BasedHardware/omi-vector-bot/issues?q=is%3Aissue%20is%3Aopen%20%22Parked%3A%22). Nothing parked is marked complete.
- **Source-ranking correction:** draft #48 updated as `e8c4c6f`; 786 tests, offline 8/8 and hosted Node 20/24/Postgres checks pass. Eight new synthetic checks include six observed failures before the fix. This is test evidence, not a deployed quality improvement.
- **Mira's profile:** short name and selected fictional adult portrait applied and verified. AI disclosure remains in the profile. Draft #59 (`d913611`) passes 758 local tests, offline 8/8 and hosted Node 20/24/Postgres checks, but its elegant/charming reply contract is not deployed. Two name/disclosure checks and three personality checks had observed failures before their changes. Research, character rules and the exact portrait prompt are in #59's personality/asset documents.
- **Improvement-inbox review fixes:** #49 (`c491d9c`) now avoids database calls when off and preserves existing staff notes on a registry outage, excluding hashes already known to be governed. Six new checks failed before; 785 full tests, focused 29, offline 8/8, isolated SQL and hosted Node 20/24/Postgres checks pass. Unknown remote governance cannot be discovered during an outage or while off; do not claim otherwise. Independent review and the full inbox are still pending.

## Still needed for the live release

- [ ] English how-to: short answer, official link, no unnecessary handoff.
- [ ] Spanish answer; Spanish handoff followed by a Spanish closing card.
- [ ] Refund/order request: verified private staff delivery and an honest customer update.
- [ ] Three-part question: answer or hand off every part, without cutting a step in half.
- [ ] Slow answer: typing stays visible until the reply.
- [ ] Restart during a reply: one reply, no duplicate and no silent loss.

The English closing card after a Spanish **no-handoff** answer is a known older gap, accepted for this release and parked as [#50](https://github.com/BasedHardware/omi-vector-bot/issues/50). Customer answer languages are unchanged.

Native Discord input did not work reliably; the browser needs sign-in. Two test-post instructions were already sent. Their replies have not been verified. No extra manual posts are needed for local regression tests.

## What I need from Aryan / Omi now

- For the live checks only: the requested test posts or a signed-in test-forum browser. No repeat memory approval or permissions repair request is needed.
- Independent review of #48 after its correction and required comparison. No new comparison has started.
- Review of Mira's new reply character before release. The profile change does not approve the changed answer instructions or bypass the current release checks.
- Later: approve each memory/inbox pilot and publish its accurate notice. Existing approval does not turn the features on.

## Current release record

| Item | Evidence |
| --- | --- |
| Release 1 source | Main `7fe0e0a`; 755 local tests passed; hosted checks passed |
| Deployment | `e1f76a93-3b3c-41c8-9c59-267790c6432f`, October 18 at 12:05:32 pm IST |
| Startup | Deployment successful; Discord login; health HTTP 200 / `ok` |
| Rollback | `0eabf17b-9b43-4d33-8210-ead5320a84f2` |
| Memory / context / fix inbox | **All off** |
| Customer release tests | **Pending — not passed** |

Keep the full acceptance requirements below. Update this front page whenever implementation, tests, review, deployment or a blocker changes. Use **done / in progress / waiting / parked**, and always distinguish built from live.

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
6. Give parked work a durable GitHub issue with the customer failure, resumption gate and acceptance checks. Reuse an existing tracker/PR rather than duplicating it. Link the issue here; parking never means completed or approved. Public trackers contain no customer text, private identifiers, secret values or sensitive security findings.

Code, tests, approval and production are different states. **A master checkbox is complete only when its acceptance checks and required rollout are verified.** Marking code implemented elsewhere does not complete it here. A blocked item stays visible with the exact missing approval; work on independent safe tasks can continue. There is no promise that an outside party will approve something or that every customer can be helped automatically.

## Detailed evidence from earlier checkpoints

<details>
<summary>Engineering history — the status above supersedes older holds below</summary>

These are dated implementation/review records, not fresh instructions or current approval blockers. In particular, Release 1 is now deployed and the staff audience check has passed. Do not ask Aryan to repeat either approval.

- **Latest October 18 execution:** the production-configured audience gate now passes and all four required bot permissions are allowed. Aryan authorized Release 1: #47 merged as `7fe0e0a`, matching the approved tree, with 755 local tests and hosted Node 20/24/Postgres green. Manual deployment `e1f76a93-3b3c-41c8-9c59-267790c6432f` is SUCCESS, created 06:35:32 UTC / 12:05:32 IST; Discord login and HTTP 200 `/health`/status `ok`/staff route `configured` are confirmed. All memory/context/policy/fix-inbox flags remain off and no settings/permissions changed. Live smoke a–f is **pending**, not passed; user-created test posts were requested because native Discord input failed and the browser needs sign-in. ROLLBACK_1 is `0eabf17b`. An additional synthetic probe found English closure after a Spanish no-handoff answer; review confirmed the same gap in old production `dad2505` and explicitly accepted it as a non-regression. Aryan subsequently **parked the closing-language correction** and asked for issues for deferred work. No closing-language code/PR was implemented; the empty local branch is retained. Customer answers still use their existing language. #48's source-ranking correction is the active engineering item; its confidence-only handoff policy stays unchanged and no new comparison/merge/deploy is approved by this status. Earlier audience/release holds below are historical, superseded by this checkpoint.
- Release 1 draft [#47](https://github.com/BasedHardware/omi-vector-bot/pull/47), runtime `e7601a3`, combines #42's routing/retrieval/clipping/intake and #45's concise voice/default-off memory. Local 755/755 tests, offline 8/8 and isolated SQL pass; hosted Node 20/24/Postgres pass. This is implementation/testing evidence, not customer-quality approval or deployment.
- Typing repair [#46](https://github.com/BasedHardware/omi-vector-bot/pull/46) merged as `273550c`; it is in both comparison arms. Merge is not deployment.
- First comparison attempt is preserved but incomplete: main completed 162 rows, candidate 46. macOS recorded lid-closed sleep at 00:48:57 IST for 963 seconds despite active keep-awake assertions; the runner's no-progress watchdog sent SIGTERM on wake. Completed candidate rows had no crash/empty/error flags and a maximum 54.226-second latency, not a verified provider hang. No protected input was inspected. Aryan explicitly authorized a fresh same-day two-arm rerun with the Mac plugged in and lid open; both versions/harness remain frozen. Do not grade the partial comparison or tune from it.
- The authorized fresh comparison completed October 18, 02:20:53–03:27:52 UTC: main `273550c` and candidate `e7601a3`, each 81×2/concurrency 3, no invalid rows or recorded host sleep. Structural pass-both/flaky/fail-both: 70/4/7 → 71/3/7; unwanted-handoff flags 16 → 14, but missing-handoff flags **2 → 3**. Total p50/p95: 34.049/69.443 s → 30.715/51.541 s. Delivered-reply median/p90 words: 130/191 → 79/108. Numerical relative checks pass, not factual/safety approval; independent protected-handoff and clipping review remains required. All slow rows are included. Complete result JSONs, seven changed cases with both runs/verbatim replies/signals, word counts, Markdown comparison and provenance/host audit are outside Git at `/Users/astar/omi-eval/release1-20261018-retry1/`. Do not tune from these results. No release is approved by this checkpoint.
- Subsequent October 18 review **approved Release 1 for deployment**, explicitly accepting the new borderline missed-handoff result and confirming the protected categories. This supersedes the pending-grade status above, not the remaining privacy/release checks. Aryan supplied the approved release brief. Current Railway read confirms one active successful deployment `0eabf17b-9b43-4d33-8210-ead5320a84f2`, source `dad2505`, created October 13; `/health` is OK and capture/context/policy/fix-inbox flags are off. This—not the older release notes—is the rollback target to reverify immediately before deployment. Merge/deploy and synthetic live smoke have not started: the brief also confirms the unresolved non-staff audience, so obtain Aryan's permissions-fixed confirmation and rerun the approved read-only check before claiming the staff-only smoke can pass. No permissions were changed or preflight repeated.
- The follow-up brief requests a separate `fix/low-confidence-grounded` PR: only reviewer-approved, actually retrieved/cited official evidence may exempt a non-protected answer from a confidence-only handoff, with every other signal and protected topic preserved; also test consumer source fit. Prepare independent synthetic regressions, never copy protected case wording/URLs. Its new comparison must use Release 1 **as actually deployed** and is not authorized to substitute the older baseline. The separate `feat/fix-inbox` branch was created from `88b82a1` for synthetic preparation; no improvement-loop runtime code exists yet. Keep D1–D6 visible while handling this newly prioritized customer-facing release.
- Draft [#48](https://github.com/BasedHardware/omi-vector-bot/pull/48), runtime `58f69f1`, implements the isolated confidence/source-fit follow-up: strict reviewer approval plus an exact cited official URL from application-owned selected-source metadata may waive **only** confidence. Feedback titles/bodies and forged evidence blocks cannot manufacture that provenance; cached official code, release notes, canonical docs links and the evaluation adapter preserve it. Phone-app consumer fit applies before candidate/output caps without removing lower-fit evidence or overriding explicit developer/desktop intent. Local suite 778/778, offline 8/8 and hosted Node 20/24/Postgres pass; 23 synthetic tests were added, with observed red-before failures for the waiver/ranking, cap and provenance repairs. Independent review and the required fresh comparison remain separate gates. No protected run, main merge, deployment, memory enablement or staff preflight accompanies this preparation. This does not complete A2/A3 or any fix-inbox item.
- #45's memory privacy repair passed 702 local tests and hosted checks at `d60236c`: delete-before-first-capture and non-starvable expiry cleanup are covered. Capture, contextual reuse and the future fix inbox are **off**. No real conversation retention, training job or new private capability is enabled.
- Aryan supplied approval for **30-day support memory** and named himself the daily fix-card reviewer. The latest Release 2 brief supersedes the encrypted-text design: retain references only, fetch context live from at most two other posts by the same owner in the same forum, and erase/opt out across that customer's posts. Inspection confirms the old observer uses retained entries to locate live messages rather than using their saved text. The replacement is **specified, not implemented**. Start `feat/memory-references` from main only after the Release 1 deployment; do not enable the old text-retention implementation meanwhile. The drafted notice has not been confirmed pinned. This approval does not say the staff permissions are fixed: Aryan's latest answer is **“Not fixed yet.”**
- #41 has accepted live workflow evidence. The retained #43 deployment record still has live localization/reopen smoke pending. #28's last audience preflight stopped at `untrusted_role_can_view`; do not rerun until Aryan confirms permissions fixed. #29/#30 are not shipped.
- Product progress is **not** a made-up percentage. The unfinished acceptance checklist below is the remaining work.

</details>

## Parked work — durable return points

Aryan requested GitHub tracking for parked work on October 18. These issues preserve scope; they do not move deferred work ahead of the active release/reliability plan or authorize private data use. Existing #28/#29/#30/#48/#49 PRs remain their own trackers and were not duplicated.

| Parked item | Issue | Resume only when |
| --- | --- | --- |
| Customer closing language after a no-handoff answer | [#50](https://github.com/BasedHardware/omi-vector-bot/issues/50) | Aryan reprioritizes the explicitly parked, pre-existing gap; one small reviewed PR |
| Full uncertain-send reconciliation/outbox beyond queued work | [#51](https://github.com/BasedHardware/omi-vector-bot/issues/51) | Existing #29/#30 scope/evidence reviewed; no parallel delivery rewrite |
| Minimized cumulative case summaries | [#52](https://github.com/BasedHardware/omi-vector-bot/issues/52) | References-only context demonstrates a real gap and additional retention/security approval is obtained |
| Staff queue, operating ownership and reminders | [#53](https://github.com/BasedHardware/omi-vector-bot/issues/53) | Team agrees ownership/coverage; no invented response-time commitments |
| Cross-identity verification abuse controls | [#54](https://github.com/BasedHardware/omi-vector-bot/issues/54) | Scoped security review and synthetic checks, preserving existing ownership/limits |
| Telegram staff-destination verification | [#55](https://github.com/BasedHardware/omi-vector-bot/issues/55) | Approved read-only verification before any expanded private-data capability |
| Capability/outage/backlog/freshness monitoring | [#56](https://github.com/BasedHardware/omi-vector-bot/issues/56) | Alert ownership, coverage/denominators and privacy-safe thresholds agreed |
| Customer-authorized recording diagnostics | [#57](https://github.com/BasedHardware/omi-vector-bot/issues/57) | Omi backend agreement plus privacy/security authorization before implementation/access |
| Authorized credential lifecycle maintenance | [#58](https://github.com/BasedHardware/omi-vector-bot/issues/58) | Explicit owner authorization and the private security checklist; public issue is a neutral reminder only |

The public security reminder deliberately omits findings, severity, provider/identity inventories and access details. The retained private-context N12 decision remains unchanged; opening an issue does not resolve or downgrade it. None of these issues enables training, capture, access, monitoring, deployment or automatic work scheduling.

## Detailed acceptance checklist

<details>
<summary>Full requirements and safety checks — nothing unfinished is discarded</summary>

## A. Short, clear, humane and correct answers

- [ ] **A1 — One consistent voice and identity, verified live.** Normally 40–80 words, simple language, short paragraphs and one useful next action. Acknowledge the actual disruption and avoid repetitive greetings/apologies. Use Mira's elegant, warm, gently charming fictional feminine persona consistently across languages, without flirting, gender stereotypes or an invented biography. The short name and fictional portrait do not claim a human employee; keep explicit AI disclosure in the profile/introduction. Stay calm for serious problems. Preserve necessary warnings, uncertainty, sources and requested parts; detailed developer questions can be longer. Verify English, Spanish and Chinese examples without declaring prompt instructions a guarantee.
- [ ] **A2 — Correct help, not automatic technical handoffs.** Navigation/confusion and hypothetical conditions are not failures; independent crashes, missing recordings and other actual failures remain failures. Money/account/privacy/replacement decisions still need a person. Retrieve each supported part of a multipart question within the existing evidence cap; preserve whole steps and source URLs when clipping. Damage intake asks for damage photos/video, private purchase email and delivery date, not unnecessary tracking details. Review real answer quality as well as routing flags.
- [ ] **A3 — Complete the Release 1 gate and rollout.** Deliver both fresh result JSONs, all changed cases/runs, signals, judge problems, word-count median/p90 and provenance for independent grading. Relative gate: pass-both ≥ main −2, p50 ≤ main +2 s, p95 ≤ main +6 s; also require fewer false how-to handoffs, no missed protected handoffs and no mid-item clipping. After approval, release one version, record rollback, verify customer answers/staff receipt and preserved existing behavior. Do not deploy merely because CI is green.
- [ ] **A4 — Honest progress while waiting.** Verify the refreshed typing indicator and cosmetic-error isolation after release. Never invent an investigation, accepted case, deadline, recovery or fix to fill the wait. Retain evidence for the previously pending localized closing/reopen smoke before calling it verified.

Implementation: shared voice, routing, retrieval, answer/review, honesty filters and delivery remain one pipeline. Research and its limitations are recorded in [SUPPORT_EXPERIENCE.md](SUPPORT_EXPERIENCE.md); research findings are not an Omi performance forecast.

## B. Reliable support from question to real follow-through

- [x] **B1 — Verify the staff audience.** Aryan confirmed the permission repair and the approved production-configured read-only check returned `private_staff_destination`; all four required bot permissions are allowed. No permissions or allowlists were changed by this check. #28's implementation/review/release remain separate unfinished work, not completed by this audience result.
- [ ] **B2 — Keep one durable, truthful case.** Preserve customer ownership, private intake/approved issue drafts, actual staff receipt, first acceptor, accepted/in-progress/waiting/closed state, customer-language pickup notice and safe reopening. Preserve suggested specialist versus actual owner. Verify restarts, duplicate clicks, access loss and notice failure; never recreate intentionally deleted staff cards.
- [ ] **B3 — Finish queued delivery recovery.** Review #29's same-nonce retries, database-ledger-outage send behavior and a staff-visible alert for every held/blocked customer reply. Then review #30's close/reopen behavior. Test uncertain-send windows, overlapping workers, boot/drain failures and repeated actions. Do not claim global exactly-once delivery without resolving the database/Discord boundary.
- [ ] **B4 — Operate the workflow, not just the code.** Establish a named staff owner and a usable queue/alert route. Surface failed delivery and unconfirmed pickup notices with a concrete staff action. Confirm who sees the alert and how outages are handled; do not promise response times without a staffed commitment. Record rollback/kill-switch behavior and one-release-at-a-time verification.

Keep existing verified private order self-service working. Do not add broad customer-account access as a shortcut for reliable handoffs.

Inspected B2 follow-up: `utils.js` still uses “a person ... has this now” for a delivery-confirmed handoff, while `caseCards.js` has a separate durable acceptance notice naming the real acceptor. Review the delivery acknowledgment against that distinction: delivery copy must not imply an individual accepted the case. Cover delivered-but-unaccepted, accepted, repeated follow-up and failed-delivery wording in the customer's language. Do not change the currently frozen candidate or silently reuse its grade for a later canned-copy change.

## C. Remember the case safely

- [ ] **C1 — Complete the references-only replacement and data-use gates.** Thirty-day retention is approved; do not keep asking for that decision. After Release 1 is actually deployed, create `feat/memory-references` from main as one problem per PR. Remove message text/ciphertext/IV/tag from support memory with an idempotent, data-safe migration even if old rows exist. Keep only guild/thread/owner/message/role/time/expiry references and text-free outcome categories; memory must not depend on an encryption key. Preserve encryption for unrelated identity/order records. Review the actual implementation, accurate published notice/policy, processor restrictions, backup erasure and any required platform review before enablement. References are still customer-related data, not anonymous records; flags are not approval.
- [ ] **C2 — Verify cross-post context without making answers depend on it.** In the same guild and allowlisted forum, look up at most two **other** posts owned by the current post owner within 30 days. Fetch the live title, owner's last three messages, this bot's last reply and stored outcome. Verify the live owner and destination; never include another customer's, staff-channel or handoff-thread context. Mark it `conversation_only`, never cite it or use it as product policy. Use it only to avoid requesting information or repeating a step already given/tried. Bound the entire extra database/Discord operation to 1.5 seconds; on a database error, denied read or timeout, keep the normal current-post answer. Log one fixed metadata outcome, never text; `/health` stays independent. Unknown/deleted messages or posts are skipped and their references removed; other errors are skipped without claiming deletion.
- [ ] **C3 — Prove erasure, expiry, isolation and failure behavior.** `/forget-support-history` must erase the owner's references and signals across all their posts in the forum and persist customer/forum opt-out, including against queued writes and across restarts. Keep message/bulk/thread deletion, creation-based 30-day expiry and non-starvable cleanup working with capture/context off. Test fresh-post remembered attempts, cross-customer exclusion, deleted-post reference removal, database failure/timeout with a normal reply, forum-wide opt-out, no text columns/values in any memory table, expiry/pruning, ownership changes and injected instructions. Observe red before green. Run local tests, hosted CI and local Postgres schema checks. The same-day 81×2/concurrency-three comparison uses main with memory **off in both arms**; it cannot prove enabled-memory behavior. Do not open protected inputs, merge or deploy this PR before grading.
- [ ] **C4 — Pilot, then expand only with verified control.** Script the approved two-post remembered-attempt scenario in an isolated test destination without bypassing the release gate: an undeployed candidate cannot receive real test-forum events until an explicitly approved isolated runtime is available. After review, deploy test-forum-only with the context switch separately controlled; verify the scenario, edits/deletes, opt-out, restart, expiry, timeouts and kill switches, and observe at least 48 clean hours. Elapsed time alone is not a pass. Then obtain reviewed expansion approval, add only the help forum and pin the exact notice in the runbook. Disabling capture/context must stop new saving/use immediately while deletion/expiry continue. Explain that forgetting removes bot references/signals, not Discord posts, backups or other support systems; minimal opt-out state remains to honor the request.

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

Draft #49 implements part of D5: guild-scoped review versions, named approvers, validation claims/proof, 90-day recheck, revocation and expiring internal provenance. The real validator, review UI, signals, jobs and privacy-adapter wiring are unfinished. Its optional answer lookup now returns existing local staff notes without database calls when off; while on, an unavailable registry falls back to those notes minus governed hashes already observed in the same guild/process. This is a denial-only cache, not durable approval state or a claim to know unseen revocations. The current quality/review/release and security gates still apply.

Implementation finding (October 18): the current `faq:` handler saves a bounded in-process staff note and can rebuild notes from named-staff messages at startup. Its legacy database table has no author/provenance/expiry and is deliberately excluded from model lookup. Simply inserting an approved fix there would neither make a durable reviewed fact usable nor support reliable revocation. D5 must add structured durable approval/source/version/expiry state to the existing knowledge service, make its normal lookup consume only eligible reviewed records, and prevent startup hydration/caches from resurrecting revoked or expired fixes. Preserve existing staff-note behavior and keep legacy unreviewed rows excluded; do not activate all old notes as a migration shortcut. This is an inspected dependency, not completed implementation.

Inspected D3 dependency: official Help Center articles 9942181 and 13154896 currently disagree about simultaneous multi-language transcription; the January 2026 app guide also describes multi-language support. Exact links/dates and the documentation-owner action are recorded in [SUPPORT_EXPERIENCE.md](SUPPORT_EXPERIENCE.md). Newer dates alone do not establish behavior for every app version. No Help Center edit or product-fact override has been made.

## E. Know whether customers are actually helped

- [ ] **E1 — Honest weekly scorecard.** Monday report: answered without *observed* staff intervention, still-need-help clicks/rate with its denominator, repeat questions, approved/published fixes and three unresolved topics. Include traffic, coverage gaps and unknown outcomes. No staff reply, a positive click, or a quiet thread is not verified resolution. Raw counts are not accuracy or causal proof of improvement.
- [ ] **E2 — Automatic checks replace routine manual probes.** CI covers existing workflows, synthetic multi-turn cases, languages, source conflicts, injection, privacy/ownership, edits/deletes, restarts, concurrent clicks, delivery failures, provider outages and rollback. Keep protected cases sealed, preserve baseline/provenance and require independent release grading. Aryan should not have to write test posts for unit/regression evidence. Only necessary authorized staging/live checks remain.
- [ ] **E3 — Demonstrate the finished workflow.** After staged enablement, verify one end-to-end path from question → correct short reply or real handoff → remembered follow-up → truthful closure/reopen → review signal → sourced correction → authorized approval → passing regression → controlled publication → later use → revocation. Record operational failures and representative quality outcomes. Do not call the product complete just because its component PRs merged.

## Later decisions and operating ownership

Ask only when the relevant stage reaches the gate; do not repeatedly request manual test conversations.

- Release 1's quality approval, merge, deployment and audience check are recorded. Only its remaining live checks are pending; do not ask again for permissions repair or release approval.
- Thirty-day support-memory approval is recorded. Remaining implementation/security/policy/processor/deletion checks and publication of the accurate notice precede enablement; do not ask again for the retention decision.
- An approved private pilot destination and reviewed enablement when the memory/inbox implementation is ready. The staff-channel audience repair is already confirmed.
- Aryan is the daily fix-card reviewer. Operational coverage for delivery failures/exceptions remains to be established; reviewer assignment does not prove a staffed response commitment. Mira remains the working name unless Aryan changes it.
- Documentation-owner action for verified official-source conflicts. Never invent authority to edit the Help Center.

No new account/backend access, permission changes, secret rotation, production variables or deployment is implied by this checklist. Keep 24 clean hours between deployments unless Aryan explicitly grants an exception, and the separate 48-hour memory-pilot acceptance condition.

## Definition of complete and intentionally separate work

The first product version is complete only when A–E are checked with evidence, required gates are cleared, rollout is verified and operating ownership exists. Until then, report the next open item and exact blockers; retain this plan across reviews and chat handoffs. Codex owns maintaining and progressing it, not asking Aryan to restate the goal.

Potential future capabilities—customer-authorized backend diagnostics, refunds/account writes, a native app or training on separately licensed data—are not hidden prerequisites for this version and are not authorized here. Keep them in the existing roadmap/access ladder until separately scoped and approved. This plan improves the existing ecosystem; it is not a rewrite or an unlimited feature wishlist.

</details>
