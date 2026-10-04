# Contributing

This bot speaks publicly in Omi's Discord, so correctness and restraint matter more than the number of answers it produces.

## Before changing behavior

- Trace the full customer path: routing, retrieval, model prompt, review, honesty filters, Discord reply, and handoff.
- Prefer improving retrieval or a general policy over adding a regex for one customer sentence.
- Keep money, privacy, account deletion, refunds, and replacements with a person. For app and device problems, give safe, reversible steps from a cited official Help Center or docs page first, then hand off when those steps do not resolve the case.
- Never make Discord history or customer-submitted Feedback posts authoritative. Product instructions must be supported by an official Omi page or current repository source.
- Never log or commit tokens, customer emails, order data, verification codes, or private keys.

## Pull requests

1. Add a focused behavior test that fails before the change.
2. Run `npm test`.
3. Run `EVAL_NO_MODEL=1 node scripts/customer-eval.js`.
4. Run the live customer evaluation only when spending the configured model key is intentional.
5. Explain the customer failure being prevented, not only the implementation.

Do not commit `.env` or `railway.toml`. Do not add generated authorship trailers. Commit messages should be plain sentences describing why the change exists.

## Source policy

Support facts are ranked in this order:

1. Omi Help Center
2. Omi documentation
3. Current official Omi repository source
4. Official Omi website
5. Official release notes
6. Omi Feedback portal metadata and customer reports, for issue/status signals only
7. Discord help history, for corroboration only

If authoritative sources disagree, the Help Center controls customer-support instructions. If no authoritative page answers the question, say so and route the customer to `help@omi.me` rather than guessing.

## Deployment

Pushing GitHub does not deploy the service. Deployment is a separate Railway action and must happen only after tests and the relevant evaluation pass. Confirm the deployment reaches a successful state and that `/health` reports `status: "ok"` and a configured staff handoff route.
