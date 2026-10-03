# AGENTS.md: omi-vector-bot

## Purpose
Omi Support answers Omi customers in Discord. Every customer message must end one of two ways: a correct answer from official Omi sources that solves the problem, or a handoff to a person who receives the full case. Be fast and honest, and never expose anything private. A smaller bot that works end to end beats a bigger one that doesn't.

## Paths that must always work
1. How-to question: a correct answer from official Omi pages, with the link.
2. Something is broken: safe, reversible steps from a cited Help Center or docs page first, then a person if they don't fix it.
3. "Is it fixed yet?": only the status an official source supports, otherwise "not sure". Never claim a fix shipped without a release note or merged change.
4. Orders, refunds, replacements, warranty, account or data deletion, in any language: a verified lookup or a person. Never a promise, status or date we can't see.
5. Needs a person: staff get the full ticket in a staff-only place, and the customer is told honestly what happens next.
6. Real bug: one GitHub issue with no private data, linked to the Discord thread.
7. Thanks, chatter or spam: no reply.
8. Model or provider down: a short honest reply and a person. Never silence or a crash message.

## Rules
- Work on a branch and open a PR. Never push to main. Never deploy; deployment is a manual Railway step after the eval gate.
- One problem per PR. Explain the customer failure being prevented.
- Every behavior change needs a test that fails before the change and passes after.
- Fix causes in general. Never add code aimed at one test question: no hard-coded URLs or phrases from an eval case, and no search query that contains the expected answer.
- Never put customer text, emails, order data or attachments anywhere public. Use privacy.js.
- Never log or commit keys or customer data. .env stays local.
- Follow CONTRIBUTING.md for source ranking and handoff policy.
- An optional feature that can't work end to end gets switched off. Core paths always keep an honest human fallback.

## Commands
- npm test
- EVAL_NO_MODEL=1 node scripts/customer-eval.js
- node scripts/live-eval.js --runs 3   (uses CMD_API_KEY and spends model quota; run when behavior changes)
