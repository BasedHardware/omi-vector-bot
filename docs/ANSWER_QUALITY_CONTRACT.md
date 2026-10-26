# Customer answer quality: repair checklist

Updated October 26, 2026. This is an implementation contract, **not a claim that these checks are all built or live**. It extends A1/A2/A4, B2 and E2 in the [master plan](SUPPORT_MASTER_PLAN.md); memory and the reviewed improvement loop keep their existing gates.

## Priority and status

The [master plan](SUPPORT_MASTER_PLAN.md) takes precedence. The old PR queue is cleared; #71/#75/#82 closed unmerged with unresolved requirements retained. #90 remains draft on accuracy HOLD after one approved controlled comparison. The local [#62 narration-context repair](NARRATION_CONTEXT.md) has passing offline checks but still needs final independent review/current CI and separately approved generated quality. Preserve the maximum of three open PRs; do not treat a repeated one-run approval as new quota authority.

| Order | Customer failure to prevent | Required regression / acceptance | State |
| --- | --- | --- | --- |
| 1 | An old bot label or incidental spending changes a technical case into billing/privacy | Customer-authored request evidence only; explicit corrections override inferred actions; real refund/entitlement/privacy actions remain protected, including mixed requests and languages | **Open:** #75 closed unmerged after failed final accuracy review. Scope remains required; its code/test counts are not approval. Do not automatically reopen or rerun it |
| 2 | Delivery is described as a person taking ownership | Requested/delivered/accepted/resolved are distinct; delivery copy says the request was sent, accepted copy requires the application event; test delivered-unaccepted, acceptance, repeat and failed delivery in supported languages | **Queued** after the current finish queue, B2; separate from frozen comparisons |
| 3 | Supplied versions, logs and failed attempts are ignored | Keep current-case facts and version-source discrepancies; ask only for genuinely missing details; log receipt is not successful interpretation; add a new fact, question or verified state, otherwise suppress boilerplate | **Open**, A1/A2/E2; same-post flow first, no memory enablement shortcut |
| 4 | A sync report gets deletion instructions | Pending/failed/unsynced signals never authorize deletion; destructive requests require explicit intent and established custody; test negative requests, mixed cases and outage fallbacks | **Open**, A2/E2; safe preservation remains mandatory |
| 5 | A superficially related issue/source becomes proof | Check title, symptom, platform, component and status; omit unmatched links, disclose partial matches; a known-issue tag alone must not replace the answer | **Open**, A2/E2; preserve official source ordering |
| 6 | Queue counters become a promise that audio is intact/recoverable | Separate observed metadata from unproven custody, completeness and recoverability; zero of one counter does not prove no loss; require exact product/version semantics | **Open**, A2/E2; do not add backend access |
| 7 | Hardware families or revisions share unsupported file claims | Keep each product/revision/package separate; verify current tree and exact assets before absence claims; manufacturing files are not compatibility or safety approval | **Open**, A2/E2; no frozen URLs or customer-specific fixtures |
| 8 | A customer is redirected to the support surface they are already using | Application supplies current surface; avoid circular Discord/feedback redirects; use a different verified route only when needed | **Foundation merged:** #67/#80 own redirects. #62's narration/context preservation and wider A1/A2/E2 acceptance remain open; do not duplicate the redirect path |
| 9 | A technically cautious reply still feels cold, repetitive or overwhelming | Recognize actual impact; one clear next step; short plain language; correct prior mistakes explicitly; no warnings-only response to thanks | **Open**, A1/A4/E2; coordinate with #59 and acknowledgment suppression |

An audit is a sample across versions, not a production accuracy rate or a case-closure decision. Original answers, incident evidence and detailed scoring stay private. Regression inputs must be independently written synthetic scenarios, not copied transcripts. No new report edition, automatic publishing, customer message or training dataset follows from this checklist.

## One pipeline, not another model round trip

Use the existing customer context → planner → official retrieval → answer → reviewer → deterministic presentation → confirmed delivery/case-state pipeline. Extend its structured evidence and application checks incrementally; do not add an unbounded second agent or a parallel FAQ store.

The target internal contract records:

- Actual request and explicitly rejected interpretations, with the newest customer correction taking precedence over an earlier bot guess.
- Known platform/app/firmware, supplied artifacts and steps already tried; unknown and conflicting fields remain explicit. Do not infer all symptoms from another reporter.
- What each official source or diagnostic artifact proves, and what remains unproven. A repository change is not deployed/account-specific evidence.
- One next step and its real actor. Do not invent an internal query, access, investigation or team commitment simply to fill this field.
- Application-owned handoff state and supporting event, never a model-authored ownership claim.
- Actual-question coverage, non-repetition, link fit, non-circular routing and data-preservation checks.

"Fail closed" means **do not send the unsupported/destructive claim**. Use the existing safe repair/review/handoff path, with truthful delivery status; it must not mean silently dropping the customer. Unknown context cannot become a false claim that all prior details were checked. No inferred schema boolean is proof of correctness.

The proposed full structured contract is not implemented by adding prose to a prompt. Each field/check needs bounded validation, a failing synthetic regression first, application integration, fault/recovery tests and the appropriate running-environment verification. Keep required quality comparisons and independent review for prompt/routing changes. No additional paid run is authorized merely by this document.

## Release gates

One customer problem per draft PR. Record baseline failure, passing checks at the current SHA, remaining actual E2E/quality gaps and review status. Never mark ready from mocks or unit counts alone. Preserve current held comparison results; do not tune from sealed cases or restart them automatically. No merge, deploy or optional-feature enablement without its existing approval. Delivery milestone progress and answer-quality scores remain separate.
