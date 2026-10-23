# Bound the optional planning step — draft

## October 23 repair — not deployed

The earlier independent review found that deadline fallback had no language code even when the answer was localized. The existing answer call now returns validated language metadata only when planning did not supply it; the existing reviewer returns the final selected reply's code before safety/citation formatting. No extra request or keyword detector is added. Successful-planner prompts are byte-identical in eight synthetic answer/review pairs across four languages. Routing and handoff decisions do not consume recovered metadata.

The handler carries the selected code through handoff notices, case state and ordinary-answer closure, retaining the existing Hindi script rule. Rejected/unavailable reviews, technical safety replacement, model failure and known-issue replacement retain English for application-owned English copy. Missing/invalid metadata falls back to English. This does not claim a provider will always return valid metadata or that every fallback is localized.

Independent repair review caught one further edge: a final English rewrite with missing/invalid metadata inherited Spanish from its draft. The new assertion failed before the correction, then passes. Final-review metadata now falls back directly to English, never the draft's language; the handler's provider stub mirrors this contract. No changed fallback is represented as generated-answer verified.

Six new regressions were observed failing before repair, then passing: provider metadata contract, Spanish/Chinese/Hindi-script ordinary closure and Spanish handoff/case persistence. Additional negative/final-review checks cover second-look selection, missing/invalid values, rejected/unavailable review and pre-formatting safety/source labels. Local full suite **896/896**, offline **8/8**, combined isolated SQL and eight byte-identical successful-planner prompt pairs pass. Synthetic provider responses are not generated-answer quality evidence.

The original complete comparison is preserved: pass-both 71→71, unwanted handoffs 10→10, missing flags 5→6; p50 34.503→32.450 s and p95 57.020→54.446 s. Independent review found no new protected-topic missed handoff or clipped item, but held the language flaw. Reset does not establish power-off behavior, and non-empty PCM bytes do not establish useful microphone audio; those factual-quality observations are not proven caused by the deadline patch and are not patched with topic-specific rules here. Their general answer-quality work remains in the existing queue. Targeted multilingual generated-answer evidence for the changed timeout-only prompt, exact-head CI and independent re-review remain required. No paid run or broader comparison waiver is inferred.

Customer problem: the optional search-planning step can use most of the response time. It must not prevent the existing answer path from running.

## Pipeline

Current question/history → deterministic route and default plan → optional planner (20-second wall deadline) → existing retrieval, answer, review and delivery.

- `plannerDeadline.js` bounds planner transport, supplies an abort signal and caps its transport timeout without changing answer/reviewer timeouts.
- Even an adapter ignoring cancellation cannot return a late plan into the answer or leave a late rejection unobserved. The timer is cleared and cannot keep an otherwise finished process alive.
- Timeout leaves the already-constructed deterministic plan and route in place. No new language detector or memory path is added; the October 23 repair adds fallback-only language metadata to existing answer/review prompts.
- One fixed metadata line records the deadline. Other planning errors omit raw provider exceptions; allowlisted authorization/quota status metadata preserves the evaluation harness's stop signal.
- A planner failure cannot cancel deterministic protected-topic or person-required routing. Existing provider/reviewer fallback behavior is unchanged.

## Verification and release gates

- Before repair: the transport-cap assertion failed, the timeout/fallback metadata assertion failed, and the deadline-module tests could not load the missing implementation. The protected-handoff regression already passed and is retained as protection, not claimed red-before.
- Controlled-clock tests cover a hung transport, abort, late completion, cleanup, timer lifetime, success and rejection; no short real-time timer assumption.
- Transport and handler checks cover the cap, unchanged answer timeout, usable deterministic fallback, one metadata line, exception suppression and an actual protected staff handoff.
- Full suite **845/845**, offline **8/8** and isolated SQL pass before push; hosted CI is pending publication. No live latency improvement is claimed without the separate same-day comparison; p95 must not rise.
- The combined release was rolled back after smoke findings #65/#66. No new deploy, settings change or memory enablement accompanies this draft. Resolve that hold and comparison baseline before spending provider quota or asking for rollout approval.
