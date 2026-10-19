# Bound the optional planning step — draft

Customer problem: the optional search-planning step can use most of the response time. It must not prevent the existing answer path from running.

## Pipeline

Current question/history → deterministic route and default plan → optional planner (20-second wall deadline) → existing retrieval, answer, review and delivery.

- `plannerDeadline.js` bounds planner transport, supplies an abort signal and caps its transport timeout without changing answer/reviewer timeouts.
- Even an adapter ignoring cancellation cannot return a late plan into the answer or leave a late rejection unobserved. The timer is cleared and cannot keep an otherwise finished process alive.
- Timeout leaves the already-constructed deterministic plan and route in place. No new language detector, prompt or memory path is added.
- One fixed metadata line records the deadline. Other planning errors omit raw provider exceptions; allowlisted authorization/quota status metadata preserves the evaluation harness's stop signal.
- A planner failure cannot cancel deterministic protected-topic or person-required routing. Existing provider/reviewer fallback behavior is unchanged.

## Verification and release gates

- Before repair: the transport-cap assertion failed, the timeout/fallback metadata assertion failed, and the deadline-module tests could not load the missing implementation. The protected-handoff regression already passed and is retained as protection, not claimed red-before.
- Controlled-clock tests cover a hung transport, abort, late completion, cleanup, timer lifetime, success and rejection; no short real-time timer assumption.
- Transport and handler checks cover the cap, unchanged answer timeout, usable deterministic fallback, one metadata line, exception suppression and an actual protected staff handoff.
- Full suite **845/845**, offline **8/8** and isolated SQL pass before push; hosted CI is pending publication. No live latency improvement is claimed without the separate same-day comparison; p95 must not rise.
- The combined release was rolled back after smoke findings #65/#66. No new deploy, settings change or memory enablement accompanies this draft. Resolve that hold and comparison baseline before spending provider quota or asking for rollout approval.
