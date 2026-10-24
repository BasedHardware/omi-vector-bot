# Customer intent must come from the customer

Draft, updated October24, 2026. Current deployed main `d550dc1` is integrated without rebasing; **not merged, deployed or ready**. The earlier base was `5bafe93`.

## Failure and integrated repair

Previously the handler classified the post title, newest message and all clipped earlier replies together. A bot's own incorrect action label, or another participant's request, could therefore select a canned financial/privacy answer and bypass normal technical answering. A planner could also revive an explicitly rejected action through its rewritten goal and retrieval queries.

The existing history fetch now provides a separate routing projection containing only messages whose author ID matches the current customer and is not a bot. Direct-reply continuations already verify that original customer. Answer/reviewer history is retained; earlier-post context remains excluded from routing. No extra fetch, retention, private tool or model call is introduced.

`requestCorrections.js` recognizes bounded English/Spanish first-person denials of financial/deletion actions, removes that grammatical action signal while retaining subsequent technical facts/positive requests, and reports which interpretation was rejected. An explicit correction can withdraw that historical action route. Merely supplying a technical version does not cancel an earlier real financial request. Current independently recognized positive actions remain protected.

The shared planner policy rejects a contradicted personal-action kind and clears its generated goal, facts, requirements and queries together. The existing original question/history then supplies context; language, data-risk and explicit human-request flags remain. This is a limited deterministic correction guard, not a general multilingual intent classifier or the full answer-quality contract.

## Verification and limits

- October24 independent review: **HOLD**. Direct-object matching now repairs the P1 where negating unrelated help erased a later positive financial/privacy request; a new four-variant group is observed red before repair and passes after. Full986/offline8 pass. This does not close the two remaining findings below.
- Open P2: a withdrawal is applied only on its current turn, so an older financial route can return on a later version-only follow-up. Replace duplicated route/planner correction decisions with one chronological, application-owned customer-intent projection within the existing bounded history; a withdrawal remains active until the owner reopens that action. Keep genuine ambiguous continuations protected.
- Open P2: generated thread titles and planner interpretation can still import a bot/other participant's action. Titles may inform topic retrieval but not personal-action authority. Preserve full answer/reviewer context, give planning explicit actor/owner provenance, and constrain its goal/facts/queries/requirements from the same owner projection. Do not treat missing English keywords as proof that a multilingual personal request is absent.
- Add original actual-handler regressions for withdrawal→version-only, a generated financial title over technical owner messages, and another participant's financial request replayed by the planner. Pair them with active prior refund, explicit reopening, mixed privacy/human and full-context preservation controls. Do not merge the partial P1 repair as though these paths were verified.
- Eleven new synthetic tests: six customer-intent/policy groups and five full-handler groups. Frozen-main loader: seven fail (six behavioral assertions plus the absent new normalization seam), four protective controls pass. All eleven pass after repair.
- A separate intermediate test caught and prevented cancellation of a genuine financial case by a version-only follow-up. Its final baseline and candidate controls pass.
- Full local suite: **850/850**. Offline scenarios: **8/8**. Guarded isolated PGlite SQL verification passes. No database schema changes.
- October24 current-main integration: full **985/985**, offline **8/8**, diff check pass. The handler conflict keeps both customer-correction constraints and deployed reply-language selection/localized rejection behavior. The initial test attempt lacked installed dependencies; after verifying an identical lockfile and reusing the existing dependency runtime, the complete suite passes. No failing behavioral assertion was waived.
- Handler tests use synthetic Discord, provider and delivery adapters. They do not prove live generated-answer quality or actual Discord acceptance/delivery.
- Still required: exact-head hosted checks, independent review, evaluation-adapter parity, an authorized fresh comparison and appropriate running-environment multi-turn verification. Keep the PR draft until these gates pass. Never reuse another change's grade or tune against sealed inputs.

No prompt/voice change, ownership-copy repair, source/link verification, media interpretation, sync-recovery advice or generic-fallback rewrite is included. Those remain separate master-plan items. No Discord posts, paid calls, protected-input reads, merge/deploy or optional-feature enablement occurred.
