# Omi Support quality and privacy evaluation

This branch is a draft PR only. It must not be merged or deployed until the live quality gate is reviewed. The production host has not been changed; a later deployment needs `CMD_API_KEY` configured there.

## Changes by task

1. **Empty/unreviewed answers:** `answerPipeline.js`, `opencode.js`, and `index.js` now pass removed draft text to the reviewer, fail closed on an empty review, and ensure a non-empty fallback. Tests cover an erased “fixed” claim and the message sent to the reviewer.
2. **Telegram KB notes:** `telegram.js` routes authenticated `KB:` notes into the same named-staff in-memory knowledge path as `faq:`. `README.md` and `test/telegram.test.js` cover this choice.
3. **Sourced safe troubleshooting:** `prompt.js`, `opencode.js`, `answerPipeline.js`, and `index.js` allow reversible Help Center/docs-backed steps with a citation, preserve handoff for confirmed failures, and bar data-loss steps or unsupported claims. Tests cover policy, restoration of a sourced step, rejection of disallowed steps, and unsynced-data warnings.
4. **Private handoffs and public issue redaction:** `handoff.js` sends full staff cards only to a staff channel, preferring a private customer thread when available. `privacy.js` and `github.js` redact public issue text and omit attachments. Tests cover private/public routing and international phone numbers, addresses, email aliases, mentions, and tokens.
5. **Live evaluation and provider correction:** `scripts/live-eval.js` exercises the real router, planner, retrieval, answer, review, presentation, and handoff decision with a stubbed Discord channel. It records final replies, handoff, cited URLs, and latency. `opencode.js` now uses the official CommandCode Provider API when `CMD_API_KEY` is set (legacy OpenCode remains a fallback). `feedback.js`, `retrieval.js`, `docs.js`, `website.js`, `router.js`, and `index.js` improve official-source retrieval and thread-specific answers. `test/liveEval.test.js` and adjacent unit tests cover the new behavior.

## Method

The same 32 synthetic scenarios were run on `origin/main` (`4330d4b`) and this branch, with the same live CommandCode model and current public sources. The runner did not log in to Discord, notify real staff, look up orders, access the production database, or file GitHub issues. Thirty cases are scored and two routing gaps are observation-only. Its expectations include non-empty replies, no generic crash message, the correct handoff decision, a Help Center/docs citation for troubleshooting steps, and case-specific content. `thanks-fixed` is the deliberate no-reply case.

This is a single live-model sample, not a stable statistical benchmark. Source pages and provider latency can change. The rubric's regex checks can miss a useful paraphrase, and a technically passing case can still be a weak generic fallback; both are called out below.

## Result

The full-run comparison and the post-change targeted checks are recorded below. Do not use these results alone as a production release approval.

The first paired full run scored **17/30 on main** and **24/30 on the branch** after applying the same corrected evaluator to both saved replies. The branch's raw checkpoint said 23/30 because a too-narrow expression rejected the semantically correct “can't confirm” answer; that expression is fixed in `scripts/live-eval.js`. The median per-case latency was 52.5 seconds on main and 61.7 seconds on the branch. Every case that should receive a reply received non-empty text; the intentional `thanks-fixed` case was silent only on the branch.

| Scenario | Main | Branch run 1 | Branch run 2 |
| --- | --- | --- | --- |
| Plaud battery question | Fail | Fail | Fail |
| Blue light | Pass | Pass | Fail |
| Power off | Fail | Pass | Fail |
| Delete past conversations | Pass | Pass | Pass |
| Charging | Pass | Pass | Pass |
| Shipping/order | Pass | Pass | Pass |
| App crash | Pass | Pass | Pass |
| Still nothing after prior answer | Pass | Pass | Pass |
| Google Calendar blocked + primary-only | Fail | Pass | Pass |
| Voice question transcribed, no answer | Fail | Fail | Fail |
| Developer API key | Pass | Pass | Pass |
| Conversation timeout | Pass | Pass | Pass |
| Offline sync how-to | Pass | Pass | Pass |
| Standalone DevKit recording | Fail | Pass | Pass |
| Repeated disconnects | Fail | Pass | Fail |
| Pairing searches forever | Pass | Fail | Pass |
| Android conversation crash | Fail | Pass | Pass |
| No charging light | Fail | Pass | Pass |
| Offline sync stuck at 12% | Fail | Fail | Fail |
| Mac desktop microphone | Fail | Fail | Fail |
| Memories sync fix status | Pass | Pass | Pass |
| Firmware update how-to | Fail | Fail | Pass |
| Blinking red light | Pass | Pass | Pass |
| Refund request | Pass | Pass | Pass |
| Spanish refund request | Pass | Pass | Pass |
| Order after three weeks | Pass | Pass | Pass |
| Delete account/data | Pass | Pass | Pass |
| “Thanks, that fixed it” | Fail | Pass (silent) | Pass (silent) |
| Broken on arrival | Pass | Pass | Fail* |
| Empty transcripts, two turns | Fail | Pass | Pass |
| Windows desktop support | Observe | Observe | Observe |
| Apple Watch support | Observe | Observe | Observe |

\* The broken-on-arrival routing bug found in run 2 was corrected immediately afterward and passed a targeted live check. That fix is in the branch but not reflected in the full-run row.

The pairing miss prompted a source-retrieval adjustment: it now finds the exact Omi necklace Help Center section and passed both a standalone live rerun and the second full branch run. The first full comparison remains in this table for auditability.

A second full branch sample after the pairing fix scored **22/30** under the corrected rubric (raw checkpoint: 23/30; its loose “open or near” expression had mistakenly counted “opens a page” as advice to keep the app open). Median latency was 43.5 seconds. Pairing and firmware update passed, but blue light and repeated disconnection fell back to unhelpful replies; blue light was a main-passing regression caused by a reviewer timeout. The broken-on-arrival case also missed its handoff because the router had classified the request as unknown. After that sample, a deterministic shop/replacement route was added, unit tested, and verified in a live targeted check: it handed off and passed in 75 ms. No full 32-case sample was run after that last route-only fix. Therefore the exact final-code aggregate is not claimed, and the no-regression merge gate remains **failed**.

## Open release blockers and caveats

- The reviewer sometimes took more than its 60-second timeout, after which the bot sent a safe but vague handoff. These responses were non-empty, but customer usefulness and latency were inadequate. A sequential recheck is needed before merge.
- The rubric is necessary but not sufficient: the charging case passed a broad content check in both branch samples even when one live reply was a generic safe fallback. Manual answer-quality review should supplement the automated gate.
- The macOS microphone-permission case did not have a matching step in the Omi Help Center/docs evidence available to the bot. Publishing an official article or approving a source is preferable to inventing a settings path.
- The offline-sync question has official guidance for online upload, but the requested “keep the app open/near the device” step was not established for that symptom by an authoritative Omi page. The branch preserves unsynced data with a deterministic warning; it should not fabricate an unsupported step.
- A public Feedback request status is not proof that a fix shipped. The Calendar answer now uses the exact matching request and labels its public status only.
- The local CommandCode key was provided in chat. Rotate it before any production use, and configure the replacement only in the host's secret environment. `.env` is ignored by Git.
