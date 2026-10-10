# Omi Support Bot Roadmap

This is the living implementation record. A checked implementation item means code exists and its regression checks passed; it does not mean production was deployed. Record release verification separately. Preserve the current official-source answer/review pipeline and improve the whole customer workflow, not isolated examples.

## Release-only mode and merge gates

Feature work is frozen. Do not extend Milestone 2, add diagnostics code or make further feature commits to #28–#30. #25 and #31 have explicit release approval and are live; #26 and the remaining stack still require review before merge/deployment.

1. Complete and report Aryan's four #24 smoke tests, their exact timing lines, second-look lines and errors, and the private staff card. Screenshots received on October 9 confirm the four replies and replacement card. Totals: deletion 24.760 s, replacement 30.631 s, Spanish 31.251 s, developer 53.540 s; no second looks or model/staff-delivery failures in that window. Functional checks pass, but do not convert this into a blanket answer-quality signoff: the Undo wording overpromises recovery and the replacement intake asks for tracking details.
2. Release approved #25 with a merge commit, deploy main, verify HTTP 200/status `ok`/staff handoff `configured`, and record a real successful rollback target. Read but do not change overlap/draining variables. Set only Healthcheck Path `/health`, leave timeout default, verify the health-gated deployment and measure new Discord login versus old SIGTERM. If overlap exceeds ten seconds, tell Aryan before any further deployments.
3. Standalone citation fix [#31](https://github.com/BasedHardware/omi-vector-bot/pull/31) replaces #27, whose branch is retained. Approved head `4f2c6e5` is merged as `3a28c7f`; 516 tests and offline 8/8 pass. Deployment `0955e078-42ea-4830-bba5-006dae841745` succeeded in an observed quiet window, with HTTP 200/status `ok`/staff handoff `configured` and Discord login confirmed. Rollback target: `75e41379-2bad-46a4-b130-04bd52382504`. Spanish phone-only smoke reply ends with one Fuente line. Chinese returns/warranty reply has one 来源 line followed by an English handoff footer; Aryan confirmed staff receipt and approved continuing with this layout exception recorded. Smoke total timing: Spanish 39.197 s, Chinese 55.366 s. No reply-formatting or Railway setting changes were made. Hosted CI on main still awaits unmerged #26.
4. #26's preceding protected gate at `65edcdb` completed 81 cases × two runs/concurrency three: 71 pass both / 3 flaky / 7 fail both; defined safety counters zero, total p50 44.560 s/p95 79.606 s (`holdout-pr26-oct10-final.json`). Those absolute latency limits are superseded by Aryan's latest same-day comparison, not erased from history. After the approved control-character parse fix, run pinned main `3a28c7f` first and #26 second, back to back with identical 81×2/concurrency-3 settings and no code/profile changes between them. Relative gate: #26 pass-both ≥ main pass-both −2; safety counters zero on both; #26 total p50 ≤ main p50 +2 s and p95 ≤ main p95 +6 s. Provide both JSONs and per-stage p50/p95, then stop for review; no merge/deploy. The preceding October 9 gate at `fb97e4b` was 73/2/6 with 45.281 s/76.107 s (`holdout-pr26-oct9.json`). Protected inputs stay unopened, and no tuning is authorized from comparison results. Structural scoring is not factual-answer or broad safety approval; live evidence/provider variance remains a comparison limitation.
5. Ship #26 first only after the same-day gate and release approval. Its rollout includes the prepared direct `node index.js` start command and a restart-during-reply smoke test; neither is applied during evaluation.
6. Once #26 is live and verified, unfreeze #28 for its own review/release. Deploy it alone and smoke-test staff approval and the GitHub preview, including the restart-safe draft flow. Frozen means retained, not discarded.
7. Next, deliver access step 1 (reviewed known-issues/releases and product facts) plus the support-voice rules below. Runtime prompt/canned-answer changes still need the full held-out gate; a docs-only preference change does not enable new access or change deployed behavior.
8. Keep #29 and #30 unmerged and unchanged until a go/no-go review of two weeks of production duplicate-reply evidence after #26. Count actual duplicate replies and uncertain-send outcomes using existing safe metadata, send identifiers and customer/staff confirmation where available; absence of error lines is not proof of zero duplicates. Record traffic volume and coverage gaps. If duplicates justify the extra machinery, review/release #29 and then #30 separately, with their duplicate-send and close/reopen smoke tests. Otherwise park both with their code/branches retained. A count does not automatically authorize a deploy.
9. Then deliver access steps 2–3, one at a time in staff-only shadow mode, followed by deferred staff queue, monitoring and retention work. Recording-pipeline diagnostics remain step 4 and need backend/privacy agreement. One deploy at a time, each verified with a rollback target.

Any change to answer/reviewer prompts or canned customer-answer replies must pass the full **81-case held-out gate before merge**. A focused live probe is additional evidence, never a substitute. Keep held-out questions unopened, preserve distinct checkout/commit provenance and do not alter code based on protected-case results. Merge commits only; no generated authorship trailers, model names in commit messages, force-pushes or direct pushes to main.

Product decision confirmed by Aryan: **keep** optional honest App Store/Google Play review buttons in #26, shown regardless of feedback. Their implementation is complete; release remains pending #26's gates. Store clicks are not internal support votes or verified review submissions.

Customer-impacting follow-ups take priority over deferred plumbing: developer pages cited for consumer questions; deletion how-to escalating unnecessarily; and speed. Chinese duplicate source labels are addressed by #31; the English footer following its localized citation was a recorded production smoke exception. The October 10 reviewer/lookup/footer fixes and separately approved planner-human-flag correction are implemented, tested and not deployed. The latest approval adds only raw-control recovery in the shared model JSON helper plus the same-day comparison above. Keep valid escapes/content/structural whitespace, escape unescaped controls inside strings, and reject other malformed JSON; do not use a blanket strip that changes meaning. #28–#30 remain frozen. Milestone 3 stays parked until Omi backend-team agreement and privacy review, before any implementation.

## Current milestone

**Workflow foundation is implemented on the working branch; production rollout is pending.** The earlier documentation-only proposal is now being extended with actual runtime changes. No GCP permissions or customer-content access have been granted.

The existing PR #24 smoke-test prerequisite still applies to the approved PR #25 readiness rollout. Do not redeploy over an unfinished smoke test or claim the new foundation is live before deployment and end-to-end checks succeed.

## Already working before this milestone

- [x] Official Help Center/docs/source retrieval, interpretation, independent answer review and grounded source links.
- [x] Explicit mentions in accessible general channels and scoped direct-reply continuations; staff interventions and pure thanks remain quiet.
- [x] Public ephemeral order commands with email ownership verification.
- [x] Private staff handoffs and redacted, staff-approved GitHub filing.
- [x] Per-stage timing/token logging, escalation reasons and a second review after a rejected first review.

These capabilities remain subject to answer-quality checks. Existing functionality is not a blanket company-grade signoff.

## Milestone 1 Reliable support workflows

- [x] Persist verified order-email bindings with owner-bound encryption, 30-day expiry and revocation.
- [x] Persist single-use verification challenges, attempt counts and resend limits; consume the challenge and save the binding atomically. Database errors do not silently downgrade to memory.
- [x] Store one active support case per channel and customer, with operational categories, official source references, linked thread and escalation identifiers.
- [x] Distinguish queued, delivered, accepted, resolved and closed states. Customer-visible cards alone are not delivery proof.
- [x] Let authorized staff accept a bot-authored case card in the private staff channel; retain the first accepting staff identity/time and keep the control off public cards.
- [x] Close database cases/escalations only after the customer notice sends. Failed Telegram sends leave the case pending. Customer-authorized reopening protects newer active cases.
- [x] Coordinate message claims, case leases, normalized repeat suppression and three leased worker slots through Postgres.
- [x] Bound in-memory waiting work. Overflow persists only message/channel/customer references and a hash, then fetches the original opted-in Discord message for processing; no raw question is stored in the queue.
- [x] Stop accepting work on shutdown and wait for support replies, interactions and Telegram polling. Unstarted work is queued for later recovery; uncertain started deliveries are not automatically replayed.
- [x] Require matching requested order number and verified owner; never substitute another order after an explicit-number miss. Use a supported Shopify API contract and reject unexpected served versions.
- [x] Keep verified private order facts out of chat-model prompts and public replies; retain them only in authorized ephemeral commands and private staff intake.
- [x] Put empathetic, action-first, truthful communication into the answer prompt and deterministic reply paths. The reviewer retains its independent factual/safety checks without duplicating the full tone-policy block. Application-confirmed delivery chooses the thread/email next step; private /order self-service remains available when live.
- [x] Add unit regressions and an isolated SQL integration check for schema, claims, queue, case isolation, verification and revocation.
- [x] Add PR checks with no provider/Discord secrets, and a disposable Postgres integration job.
- [x] Complete hosted CI for runtime head `3960f24`: rules on Node 20/24 and the disposable Postgres job pass.
- [x] Run a focused three-run communication evaluation: eight cases meet the pass threshold, one is flaky, none fail the threshold. This is not the 81-case held-out gate or a production smoke test.
- [ ] Deploy through the existing smoke-test and rollback gates; verify real private delivery, restart behavior and deployment overlap.

## Milestone 2 Complete case handling and delivery recovery

Retained, not discarded. #28 (durable engineering approvals/destination checks) unfreezes only after #26 is live and verified, then ships alone after review and smoke tests. #29 (Discord receipt ledger) and #30 (tracked closure/reopening) stay unmerged and unchanged pending the two-week production go/no-go above. Their uncertain-send protection can hold a reply rather than retry it; weigh missing replies as well as duplicates. Existing branch code is not production deployment. Other open delivery-plumbing items remain deferred behind the access ladder.

- [ ] **Deferred:** complete delivery outbox, remaining adapters, bounded retries and uncertain-outcome reconciliation. Never blindly replay a request that may already have replied.
- [ ] **Deferred:** encrypted/minimized cumulative case summaries and attempted steps, pending an approved retention/deletion policy. Current durable context is operational categories and sources, not raw conversation content.
- [ ] **Deferred:** staff queue views, committed response targets, reminders and additional operational inspection.
- [ ] **Deferred:** cross-identity verification abuse controls and remaining destination verification. Discord audience checks are already in #28; Telegram verification remains unfinished.
- [ ] **Deferred:** additional capability checks/monitoring for stale knowledge, outages, failed lookups, backlog and missed staff delivery.

## Milestone 3 Verified recording diagnostics

Parked. Omi backend-team agreement and privacy review are prerequisites before writing diagnostics/sign-in code or granting access.

- [ ] Add private Omi sign-in and a short-lived, revocable diagnostic grant bound to the customer and case. Shopify OTP is not Omi account authorization.
- [ ] Implement a backend-owned, pure-read diagnostic projection for capture/upload/sync/finalization/storage availability. Existing backend GET endpoints are not automatically safe to proxy.
- [ ] Authenticate the bot to that one capability; enforce ownership, bounded windows/results and an allowlisted output schema outside the model.
- [ ] Keep audio, transcripts, titles/summaries, photos, raw logs, signed URLs, keys and unrelated customers out of model inputs and public replies.
- [ ] Add bounded server-side log correlation only if metadata alone is insufficient; do not grant the public bot general GCP log/database access.
- [ ] Pilot with synthetic accounts, then a small authorized group. Test unauthorized, wrong-customer, expired/revoked-grant and injection cases before public enablement.

Recovery, reprocessing, refunds, deletion and account mutations remain separate human-authorized workflows. A diagnostic result must distinguish unknown evidence from verified loss and must not promise recovery.

## Access ladder and support voice

This is a plan, not newly enabled access. Start with missing public knowledge, not broad privileges. Keep the existing application-controlled answer/review, ownership and delivery pipeline. Omi Support Bot is the product name; no repo, domain, channel or environment identifier migration is implied.

1. **Reviewed public knowledge first.** Add a small staff-maintained known-issues/releases list and product facts sheet. Each entry needs its official source, affected product/version, observation/review time, owner and expiry/recheck date; fixes need release/deployment evidence, not just a merged PR. Label unknowns instead of filling gaps from memory. No customer data in these records. Preserve Help Center priority and distinguish product guidance from customer reports.
2. **Verified order facts, read-only.** Existing `/order` and `/orders` are public commands whose results are ephemeral after email ownership verification. Any new conversational use must keep exact order targeting and customer ownership, use deterministic allowlisted facts, and return them ephemerally, by an authorized private response, or in authorized staff intake—not in an ordinary thread post or general model prompt. A tag, Discord staff role or public order number is not authorization. No edits, refunds or cancellations.
3. **Linked Omi account metadata, read-only.** After backend-team agreement and privacy review, implement real Omi sign-in and explicit case-bound, scoped, expiring/revocable consent. Allowlisted candidates are device type, app/firmware version, last observed sync, plan and an unsynced count only if the backend can establish it. Missing/stale/offline evidence remains unknown, not zero. Never audio, transcripts, memories, summaries or unrelated customers. Shopify OTP does not link an Omi account.
4. **Recording-pipeline diagnostics later.** Keep Milestone 3 parked until its backend-owned pure-read projections, customer authorization and privacy gates are approved. Do not turn general cloud logs or existing potentially mutating/decrypting GET endpoints into a bot tool.

Every **new** knowledge/access adapter begins with customer-independent or synthetic checks, then a scoped staff-only shadow pilot. Authorized results appear only on the private staff card, not in customer/model replies; no new private lookup occurs without owner verification and consent. Staff compare outcomes against the real authorized source before reviewed enablement. Existing verified ephemeral order commands are not disabled by this future-access rule. Each adapter needs an independent kill switch, fixed allowlisted output schema, rate/result/time limits and a metadata-only access audit (actor/case/scope/outcome/time, never fetched content, credentials or raw logs). Shadow mode limits exposure; it is not a guarantee against leaks or wrong facts. Choose a representative pilot and acceptance criteria, not an elapsed week alone.

Never grant new write access to customer accounts/orders, refunds, deletions, recovery/reprocessing, raw logs, general databases/audio buckets, broad cloud roles or backend impersonation. Existing writes to the bot's own support records and separately staff-approved redacted GitHub filing remain narrowly controlled workflows; they are not customer-account permissions.

Support voice is **kind framing, true facts**, as recorded in AGENTS.md. Acknowledge the problem and previous attempts, provide one useful next step, and retain protective warnings and material uncertainty. Confirm a staff delivery before saying “it's with the team”; delivery is not acceptance or resolution. Never invent an investigation, access, fix, deadline or outcome. These written preferences are not a claim that all production replies already comply.

## Milestone 4 Answer quality and operations

- [x] Redesign `/done` closure with internal resolution feedback and optional honest App Store/Google Play review links. Links are shown before any vote, regardless of satisfaction. Store clicks are not dashboard votes or verified review submissions.
- [x] Keep “Still need help” functional and show feedback-storage failure honestly, without invented dashboard totals or a false “recorded” acknowledgment.
- [x] Normalize Chinese citation labels (#31 live; Chinese smoke has one 来源 citation line, with the footer-layout exception above).
- [ ] Improve retrieval coverage and publish missing official support guidance; do not compensate with unverified product facts.
- [ ] Maintain a reviewed incident/release registry with deployment evidence, affected versions and supported workarounds. Merged does not mean released.
- [ ] Track resolution/reopen rates, handoff reasons, capability success and p50/p95 latency without logging customer content.
- [ ] Continue speed work after quality holds. Never cut useful evidence to manufacture a faster score.

## Deferred security work: N12 exposed credential rotation

**Deferred by Aryan (Oct 9), accepted risk.** Removed from the first priority slot at Aryan's explicit request; N12 remains an unresolved P0 security finding, not a completed rotation or a lowered severity.

- [ ] Rotate/revoke the exposed Discord token, GitHub App private key, webhook secret and CommandCode key; revoke the old OpenCode key. Rotation/revocation is unconfirmed.
- [ ] Handle `DATA_ENCRYPTION_KEY` through a data-preserving migration before replacement. Do not make retained encrypted records unreadable or reset state to hide a failure.

Never print or paste replacement values into chat, logs or GitHub. Record completion through provider-side revocation and successful authorized use, not merely a variable being present. No credential or Railway variable changes are authorized as a side effect of this release/evaluation work.

## Validation and operating rules

Validation recorded on October 9, 2026: 593 unit/regression tests pass, the offline customer check is 8/8, and the isolated SQL check passes. Hosted CI passes on runtime head `3960f24`. The communication probe used snapshot `4d643e3`: 23/24 replies passed, with the voice-question/no-answer case missing part of the requested explanation on one run; later interaction-deadline and public-order privacy changes have separate regressions and CI coverage. Do not hide that remaining answer-quality inconsistency or call this a full held-out approval.

The #24 smoke test is now posted and reported. #25 is merged as `4f7d7a1` and live: initial deployment `73760501-ddd2-4b49-a21d-7e383840b5d8`, then health-gated deployment `75e41379-2bad-46a4-b130-04bd52382504`, both SUCCESS. `/health` returns HTTP 200, status `ok` and staff handoff `configured`. Only Healthcheck Path `/health` changed; timeout remains default, overlap/draining variables remain unset, and no credential variables changed.

Railway healthcheck evidence (UTC): started 15:14:45.671, new Discord login 15:14:46.451, healthcheck passed 15:14:46.871. The old bot's own `Received SIGTERM` line is missing; platform stop is 15:14:53.151 (+6.7 s) and npm SIGTERM is 15:15:02.638 (+16.2 s). The npm time is a termination proxy, not proof of exact dual-connection duration. This possible over-ten-second window was reported to Aryan; **further deployments are paused for review**, without changing teardown/window settings. No Missing env, model failed or Staff delivery failed lines were found since the health-gated deployment.

The earlier #25 rollback targets remain historical records. Current production is #31 deployment `0955e078-42ea-4830-bba5-006dae841745`, with `75e41379-2bad-46a4-b130-04bd52382504` as its rollback target. Aryan's explicit approval for #31's quiet-window release superseded the earlier deployment pause; overlap/draining/start settings were not changed. #26 incorporates main through merge commit `95c2c13` (citation formatter from main; readiness combines Discord, coordination initialization and non-stopping runtime). Its unit suite passes 603 tests and offline check is 8/8; hosted Node 20/24 and disposable database checks pass at tested head `fb97e4b`. Its protected gate is complete but blocked by latency, as recorded above. #26, #28, #29 and #30 remain unmerged/unreleased. No feature commits were made to #28–#30.

The current Railway service/deployment start-command overrides are unset; runtime logs confirm the npm start lifecycle before `node index.js`. Changing to direct Node remains a #26 rollout action, not performed here. Output-only safety review has not found positive destructive troubleshooting instructions, duplicate citation lines, or staff-action promises without the harness handoff flag. This is not a clean broad-safety approval: heat precautions, non-English data-preservation warnings, public intake of tracking/conversation details, and extra email redirects after handoff need review. No fixes were added from the protected results.

October 10 scoped follow-up: 610 unit tests and offline 8/8 pass; hosted Node 20/24 and disposable database checks pass at tested head `65edcdb`. A synthetic integration review found that the order fallback discarded a planner-confirmed human-request flag. Aryan explicitly authorized stopping the incomplete 11-reply attempt, preserving it, correcting that flag, then running one complete gate on the corrected head. No protected result drove this correction. The incomplete `/Users/astar/omi-eval/holdout-pr26-oct10.json` is not a scored gate; the complete result is `holdout-pr26-oct10-final.json`, recorded above. The preceding `gs-033` run-1 review error was an invalid control character in reviewer JSON (JSON parse failure, not a timeout/HTTP error); log chronology is strongly correlated with that row, not explicitly tagged per case. This error path is unchanged. A direct-Node start-command patch and rollout/restart-smoke checklist are prepared outside the repository at `/tmp/omi-pr26-oct10.HgcqmN/`, not applied; local railway.toml still says npm start, and no Railway settings/variables/deployments were changed. Code remained unchanged throughout the complete gate; only documentation is updated after it. #28–#30 remain frozen.

Run `npm test`, the offline customer check and relevant isolated database checks. Answer/reviewer prompt or canned-answer changes require the full 81-case held-out gate before merge, not just a focused live probe. Held-out files stay unopened and must never become tuning inputs. Record failed checks and remaining limitations instead of marking work complete prematurely.

Latest comparison preparation: 617 unit tests and offline 8/8 pass after raw-control recovery; planner, answer and reviewer caller regressions cover lossless controls, valid escaping, unchanged text normalization and fail-closed syntax. Main baseline is a separate clean checkout at `3a28c7f`. Both processes use the same pinned Node binary, primary-checkout harness/cwd and captured environment, with private services disabled. The harness and dependency lockfile match main. Evidence is fetched live independently: page counts do not prove identical content/order, so this is a same-day live-network comparison, not a frozen-corpus causal experiment. The direct-Node rollout patch remains prepared, not applied; no Railway/credential changes.

### October 10 same-day comparison: complete, release still held

Raw-control recovery is committed as `c3d881b`; both runs tested frozen code: main `3a28c7f` first, #26 `930b45f` second. Each completed all 162 rows (81 cases × two runs, concurrency three), with no provider-invalid or unscored rows. The second process started 66 ms after the first ended; checkout, dataset, harness, lockfile and local environment guards passed. Only 8/162 matched replies are byte-identical. Both crawled 58 Help Center and 40 website pages, but live content/order is not guaranteed identical. Retrieval and staff delivery are in-memory/stubbed, not a production Postgres or real-card test.

Structural score, mutually exclusive pass-both/flaky/fail-both: **main 70/4/7; #26 70/6/5**. Nearest-rank timings in seconds, including every row and summed turns:

| Stage | Main p50 | Main p95 | #26 p50 | #26 p95 |
| --- | ---: | ---: | ---: | ---: |
| Planner | 9.547 | 18.963 | 9.315 | 17.301 |
| Retrieval | 1.282 | 4.470 | 1.343 | 4.684 |
| Answer | 12.463 | 25.479 | 11.693 | 27.383 |
| Review | 15.336 | 37.221 | 13.907 | 38.850 |
| Total | 44.130 | 71.129 | 40.875 | 76.846 |

The numerical relative checks pass: 70 ≥ 68 pass-both, p50 40.875 ≤ 46.130 s, p95 76.846 ≤ 77.129 s (p95 delta +5.717 s, only 0.283 s inside the limit). This is not full approval: each output has a real duplicate citation label (main `gs-038` run 2; #26 `gs-052` run 2), so the zero-duplicates condition fails. The citation formatter is byte-identical between tested roots; these outputs do not establish a new formatter regression. Main also has one advisory manual-flash fallback, naming a method rather than a detailed procedure. #26 has none. Explicit reinstall/logout/local-clear/factory-wipe instructions and staff-action promises without the harness handoff flag were zero in both full 162-row audits. Missing preservation/heat precautions and private-intake guidance remain separate concerns; zero positive-advice counts are not broad safety approval.

The long background interruption compromises the benchmark: #26's final `hs-081` run 2 took 2,223.620 s and ended with an empty reply/no handoff. Its planner, retrieval and review recorded unusually large durations; the run logged two request-coordination failures and two review errors (JSON syntax and timeout). Normal provider timeout is 60 s. Do not attribute this row to normal code/provider speed or assert a verified host-sleep cause. It stays in every score/percentile; nothing was excluded, tuned or silently rerun. Main had three second looks (all approved); #26 had six (four approved). The raw-control fix does not attempt to repair other malformed JSON.

Results are retained outside Git in `~/omi-eval/holdout-main-sameday-oct10.json` and `~/omi-eval/holdout-pr26-sameday-oct10.json`, with provenance alongside them. Neither result contains an exact scanned known local secret value. Unit suite: 617 pass; offline check: 8/8; hosted Node 20/24 and disposable database checks pass at tested head `930b45f`. Docs-only draft [#32](https://github.com/BasedHardware/omi-vector-bot/pull/32) records the support voice and shadow-mode access ladder; it grants no access. No merge, deploy, credential/setting change or additional held-out run was performed. #28–#30 remain unchanged; the direct-Node patch is still prepared, not applied. Stop for review.

No production settings or credentials change as a side effect of coding. Previously exposed credentials remain unrotated/unconfirmed, deferred by Aryan with accepted risk; encryption-key rotation needs a data-preserving migration. Omi Support Bot is the product name; technical repository/domain/channel names are not renamed without an explicit migration.

See [Architecture](docs/ARCHITECTURE.md), [Implementation Checklist](docs/IMPLEMENTATION_PLAN.md), and [Operations Runbook](docs/RUNBOOK.md).
