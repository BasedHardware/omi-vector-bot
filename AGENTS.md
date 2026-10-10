# AGENTS.md: Omi Support Bot

Read ROADMAP.md, docs/ARCHITECTURE.md and docs/RUNBOOK.md before changing support workflows. Keep the roadmap current: distinguish code implemented, tests passed, rollout pending and production verified. Do not present plans as implementation or implementation as deployment.

## Purpose
Omi Support answers Omi customers in Discord. Every customer message must end one of two ways: a correct answer from official Omi sources that solves the problem, or a handoff to a person who receives the full case. Be fast and honest, and never expose anything private. A smaller bot that works end to end beats a bigger one that doesn't.

## Paths that must always work
1. How-to question: a correct answer from official Omi pages, with the link.
2. Something is broken: safe, reversible steps from a cited Help Center or docs page first, then a person if they don't fix it.
3. "Is it fixed yet?": only the status an official source supports, otherwise "not sure". A merged change alone is not proof a fix shipped; require release/deployment evidence.
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
- Be empathetic, precise and action-first. Preserve earlier attempts and give one useful next step; never invent access, completed checks, delivery, acceptance, recovery, deadlines or guaranteed outcomes.
- Production coordination and identity state use Postgres. Never silently fall back to local memory on a database error. Keep private capabilities customer-scoped and enforced outside the model.
- An optional feature that can't work end to end gets switched off. Core paths always keep an honest human fallback.

## Support voice

**Kind framing, true facts:** change how things are said, never what is claimed. Open with the customer's actual problem and the useful next action. Remember what they already tried. Do not lead with “I can't see” or “I don't have access” when safe sourced guidance or a verified handoff is available; explain a material limitation briefly when it changes their decision.

- Use acknowledgment and official-source protective warnings. Say what a person can check only when that workflow and access are established; otherwise say what the delivered case asks them to investigate.
- “It's with the team” requires application-confirmed private staff delivery. Delivery is not staff acceptance, a completed investigation, or resolution. “You don't need to repeat anything” is appropriate only when the relevant case context reached staff; it does not rule out necessary follow-up questions.
- Never invent a check, ticket, ping, access, fix, date, refund, replacement, recovery or guaranteed outcome. Promise only a next action the application can perform and verify. Do not hide uncertainty or data-loss risk to reassure someone.

Examples (conditional wording is part of the rule, not a claim of current access):

| Cold opening | Helpful, truthful alternative |
| --- | --- |
| “I can't see your phone or recordings, so I can't tell whether they can be recovered.” | After confirmed delivery: “I've sent the missing-recording details to the team to investigate. Keep the app installed and don't clear local recordings until the next support update; unsynced data may still be on your phone.” Use the preservation guidance only when supported by official sources. Do not promise recovery or imply an account check happened. |
| “I'm not sure whether this is a known issue, and I won't guess.” | After confirmed delivery: “Thanks for flagging this. I've sent your report to the team; the details you provided will help them investigate.” Before delivery, say what is actually happening or use the honest failed-delivery fallback. |

New knowledge or private capabilities follow ROADMAP.md's access ladder: read-only, customer-scoped, staff-only shadow mode first, then reviewed enablement with a kill switch, metadata audit and fixed output schema. A private staff card alone is not customer authorization. Never put verified private order/account facts in a normal Discord thread message or model prompt.

## Commands
- npm test
- EVAL_NO_MODEL=1 node scripts/customer-eval.js
- node scripts/live-eval.js --runs 3   (uses CMD_API_KEY and spends model quota; run when behavior changes)
