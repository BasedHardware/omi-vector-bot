## Customer problem

Describe the incorrect, unsafe, or missing behavior this change addresses.

## Change

Describe the smallest general change that fixes the class of problem.

## Evidence

List the authoritative Omi pages or existing behavior that support the change.

## Verification

- [ ] Observed an affected behavior regression fail before the change and pass after, or explained why a documentation-only change needs no new test
- [ ] `npm test`
- [ ] `EVAL_NO_MODEL=1 node scripts/customer-eval.js`
- [ ] Live-model evaluation run when appropriate, or explicitly not needed
- [ ] No secrets, customer PII, `.env`, or `railway.toml`
- [ ] No new claim that a person was pinged, an issue was filed, or an email was sent without confirmed success

Tested commit:

Functional/integration evidence and independent review, proportionate to this change:

## Readiness and rollout

Keep the PR draft until the final diff and current-commit checks pass. State any remaining accuracy, integration or approval gate. A merge does not deploy or enable an optional feature.

Main / production impact and the next required release check:


Use `comparison` for an answer change. Its evidence record must identify the tested baseline/candidate, inputs, output/grade evidence and independent review; a link alone is not scientific approval. Use `no-answer-change` only with a concrete `Justification:` instead of `Evidence:` and a non-author maintainer APPROVED review on this exact head containing `Mira evidence approval: <SHA256 of this exact section>`. `pending` blocks the policy check. Updating head or justification requires updated approval. Never paste customer/model text or secrets into a public evidence record.

## Answer-change evidence
Mode: pending
Head: REPLACE_WITH_CURRENT_40_CHARACTER_HEAD_SHA
Evidence: LINK_TO_COMPARISON_RECORD_IN_THIS_REPOSITORY
