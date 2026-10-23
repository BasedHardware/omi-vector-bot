# Customer intent must come from the customer

Draft, October 23, 2026. Based on main `5bafe93`; **not merged, deployed or ready**.

## Failure and integrated repair

Previously the handler classified the post title, newest message and all clipped earlier replies together. A bot's own incorrect action label, or another participant's request, could therefore select a canned financial/privacy answer and bypass normal technical answering. A planner could also revive an explicitly rejected action through its rewritten goal and retrieval queries.

The existing history fetch now provides a separate routing projection containing only messages whose author ID matches the current customer and is not a bot. Direct-reply continuations already verify that original customer. Answer/reviewer history is retained; earlier-post context remains excluded from routing. No extra fetch, retention, private tool or model call is introduced.

`requestCorrections.js` recognizes bounded English/Spanish first-person denials of financial/deletion actions, removes that grammatical action signal while retaining subsequent technical facts/positive requests, and reports which interpretation was rejected. An explicit correction can withdraw that historical action route. Merely supplying a technical version does not cancel an earlier real financial request. Current independently recognized positive actions remain protected.

The shared planner policy rejects a contradicted personal-action kind and clears its generated goal, facts, requirements and queries together. The existing original question/history then supplies context; language, data-risk and explicit human-request flags remain. This is a limited deterministic correction guard, not a general multilingual intent classifier or the full answer-quality contract.

## Verification and limits

- Eleven new synthetic tests: six customer-intent/policy groups and five full-handler groups. Frozen-main loader: seven fail (six behavioral assertions plus the absent new normalization seam), four protective controls pass. All eleven pass after repair.
- A separate intermediate test caught and prevented cancellation of a genuine financial case by a version-only follow-up. Its final baseline and candidate controls pass.
- Full local suite: **850/850**. Offline scenarios: **8/8**. Guarded isolated PGlite SQL verification passes. No database schema changes.
- Handler tests use synthetic Discord, provider and delivery adapters. They do not prove live generated-answer quality or actual Discord acceptance/delivery.
- Still required: exact-head hosted checks, independent review, evaluation-adapter parity, an authorized fresh comparison and appropriate running-environment multi-turn verification. Keep the PR draft until these gates pass. Never reuse another change's grade or tune against sealed inputs.

No prompt/voice change, ownership-copy repair, source/link verification, media interpretation, sync-recovery advice or generic-fallback rewrite is included. Those remain separate master-plan items. No Discord posts, paid calls, protected-input reads, merge/deploy or optional-feature enablement occurred.
