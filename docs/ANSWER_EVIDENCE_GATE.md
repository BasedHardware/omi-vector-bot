# Answer evidence CI gate

October29 draft. This is prepared policy code, not installed branch protection. Main is cffb46b; production remains a9c9508/a6ef6b22. #90's publisher provenance does not establish hardware applicability, so its release remains held.

## Metadata check

The trusted `pull_request_target` workflow checks out **main**, never PR code, and performs GitHub metadata reads without installing dependencies or using provider credentials. It publishes a `Mira answer evidence` check on the actual PR head SHA; the workflow's own base-SHA job is not used as the head gate. Required permissions are contents/pull-requests read and checks write, solely to publish this fixed check. PR open/update/reopen/body-edit events recheck. Review submission/edit/dismissal events use an unprivileged relay with no permissions or checkout. Its completion triggers the trusted main workflow, which ignores relay artifacts/outputs and freshly rechecks all open main PRs; this also works when the event has no PR association. A manual default-branch dispatch is available for recovery. No head workflow or dependency is executed in the privileged context.

Every production root JavaScript/JSON/SQL change, prompt/filter directory change, script (including production ingestion) or workflow/policy change requires one plain `## Answer-change evidence` section. Renaming a governed file away still requires evidence. Tests and ordinary prose alone do not. All changed-file/review pages are read, and concurrent changes to head/base/body/file count fail closed.

The section requires `Mode: comparison` plus `Head: <current full SHA>` and `Evidence: <same-repository Actions run or issue/PR record URL>`. This enforces **a current-head declaration and evidence link**, not the scientific adequacy, existence, independence, grades or accuracy of that record. The ordinary final-diff/functional/comparison/independent-review requirements still apply. A self-referential or meaningless record must be rejected during review; CI does not claim to grade evidence.

An exemption uses `Mode: no-answer-change`, `Head:` and a concrete `Justification:`. It requires a non-author human repository writer/maintainer/admin's APPROVED GitHub review, on that exact head, containing a line `Mira evidence approval: <sha256>`. The digest is SHA256 of the exact trimmed section body with LF newlines. Later reviewer decisions, dismissal, a changed head or changed justification invalidate it. This explicitly requested reviewer approval cannot be replaced by checking a box. `pending`, duplicate/malformed fields, absent/current-head-mismatched declarations and denied/incomplete API reads block the check.

PR metadata changes are event-driven, not an atomic GitHub merge transaction; recheck immediately before readiness/merge. This is protection against omitted evidence, not a tamper-proof boundary against repository administrators or a malicious maintainer changing workflows/settings. No branch-protection setting is changed by merely opening this draft.

## Adversarial no-model checks

`EVAL_NO_MODEL=1 node scripts/customer-eval.js` now runs six original fictional stress probes before its existing eight ordinary rule checks. All model transports in these probes are injected, so there is no provider request. They exercise customer/system role separation, off-topic suppression while preserving person requests, fake completed staff narration, fake refund approval, unidentified-hardware source applicability and a supported ordinary-answer control through existing production owners.

Injected hostile replies test application acceptance. They do **not** establish that a real model resists injection, that every competitor request is suppressed, or that an 81-case protected set lacked a scenario. Protected inputs remain unread. These checks cannot replace generated-answer accuracy review.

Current result: four adversarial controls pass; **fake refund approval and unidentified-hardware applicability fail**, while all eight ordinary checks pass. The runner exits nonzero. These are intentional visible release blockers, not expected-failure skips, green assertions of unsafe behavior or permission to waive accuracy. No production fix is claimed in this policy PR. Continue the general #83 acceptance-boundary repair; observe these regressions green after that fix, including positive controls and relevant integration/comparison review, before readiness or deployment. A new paid run still needs Aryan's permission.

## Installation checklist

- [x] Executable metadata policy and fixed-head check publisher prepared.
- [x] Positive/negative approval, pagination/race and policy unit checks.
- [x] Fictional adversarial suite wired into the existing no-model CI command.
- [ ] Repair the two reproduced acceptance failures with general production boundaries and regression controls; keep this PR draft while red.
- [ ] Independent review, final exact-head checks, merge authorization and ordinary accuracy gates.
- [ ] Merge the trusted workflow to main; verify its policy check on a synthetic metadata-only/current-head PR exercise without customer/provider data.
- [ ] Require `Mira answer evidence` in main branch protection/rules, preserving existing requirements; verify missing/stale evidence actually blocks a merge and approved current evidence can pass. Main currently reports **Branch not protected** and its effective branch-rule list is empty; installation must not be reported complete until this is applied and read back.

Do not merge/deploy other work in the gap between installing the workflow and verifying required enforcement. Opening this draft does not silently merge policy, change repository settings, spend quota, enable features or approve a release.
