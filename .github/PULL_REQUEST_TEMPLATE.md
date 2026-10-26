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
