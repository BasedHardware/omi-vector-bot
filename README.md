# Mira

**Omi’s AI support assistant.** Mira answers from official Omi sources, remembers the context of the current conversation, and hands unresolved or private work to a person through a verified staff route. It must never invent a fix, an account check, staff ownership or a delivery promise.

The technical repository name remains `omi-vector-bot`. The product is **Mira**.

## Start here

| You want to… | Read |
| --- | --- |
| See what is done, what is live and what is next | [Master plan and evidence-backed progress](docs/SUPPORT_MASTER_PLAN.md) |
| Understand the system | [Architecture](docs/ARCHITECTURE.md) |
| Run or recover the service | [Operations runbook](docs/RUNBOOK.md) |
| Find a design, privacy boundary or verification record | [Documentation index](docs/README.md) |
| Contribute a change | [Contributing](CONTRIBUTING.md) · [Agent instructions](AGENTS.md) |

The master plan separates **implemented → tested → reviewed → deployed → customer-confirmed**. Its completion score measures delivery progress, not answer accuracy. Cross-post memory and the reviewed-learning inbox remain disabled until their own approval and release gates pass.

## How Mira works

1. **Understand and route.** Preserve the customer’s goal, language, device/app context and earlier attempts. Application rules protect private orders, money, accounts and data.
2. **Retrieve official evidence.** Search bounded passages from Omi’s Help Center, documentation, current repository source and other approved public sources.
3. **Answer and review.** Generate a useful response, check it against the evidence, preserve necessary warnings and uncertainty, then apply the shared privacy and presentation boundaries.
4. **Deliver or hand off.** Send the reply in the original conversation. When a person is needed, create a private case and acknowledge delivery only after the application confirms it. Delivery, staff acceptance and resolution are separate states.

Help Center instructions outrank other sources. Customer reports and Discord history can reveal a problem; they are not authoritative product instructions. See the [source policy](CONTRIBUTING.md#source-policy).

Staff-approved GitHub publication uses an exact sanitized preview and durable authorization. Mira never forwards a customer transcript automatically or treats a merged PR as proof a fix shipped. Uncertain external sends stay held for reconciliation. [Workflow and recovery](docs/RUNBOOK.md#engineering-approvals-and-uncertain-github-writes).

## Local development

Requires **Node.js 20+**. These checks use no paid model calls:

```sh
npm ci
npm test
EVAL_NO_MODEL=1 node scripts/customer-eval.js
```

For an intentional provider-backed local query, copy `.env.example` to ignored `.env`, configure `CMD_API_KEY`, then use `npm run ask -- "your synthetic question"`. This spends provider quota. Never commit credentials, customer records, `.env` or local `railway.toml`.

The [runbook](docs/RUNBOOK.md) covers database configuration, private staff delivery, webhook verification, health and deployment. Do not run a second Discord worker against the live bot.

## Verification and release

PR CI runs Node 20/24 regression checks, the offline customer scenarios and isolated PostgreSQL integration without Discord, customer or provider credentials. Behavior changes need an observed failing regression, an appropriate functional check and independent review where required. Green unit tests alone do not establish answer accuracy.

Live model evaluation is a separate, deliberate quota spend. Its in-memory retrieval and stubbed delivery do not exercise production PostgreSQL or the source-ingestion scheduler. Preserve complete results and provenance. [Evaluation guide and limits](docs/EVALUATION.md) · [Quality contract](docs/ANSWER_QUALITY_CONTRACT.md) · [Stage evidence](docs/ANSWER_STAGE_EVIDENCE.md).

Every PR starts as a draft. A merge does not deploy the service. Production changes need their existing release gates, an exact commit, a verified rollback target and relevant smoke checks. Optional features stay off until explicitly enabled. Aryan performs Discord smoke messages and commands.

## Backlog

| Workstream | GitHub |
| --- | --- |
| Answer quality, source conflicts and multipart coverage | [#83](https://github.com/BasedHardware/omi-vector-bot/issues/83) · [#65](https://github.com/BasedHardware/omi-vector-bot/issues/65) · [#62](https://github.com/BasedHardware/omi-vector-bot/issues/62) |
| Delivery reliability and capability monitoring | [#51](https://github.com/BasedHardware/omi-vector-bot/issues/51) · [#56](https://github.com/BasedHardware/omi-vector-bot/issues/56) |
| Metadata retention and erasure | [#85](https://github.com/BasedHardware/omi-vector-bot/issues/85) |
| Deferred work with a return point | [Parked issues](https://github.com/BasedHardware/omi-vector-bot/issues?q=is%3Aissue%20is%3Aopen%20label%3Aparked) |

Use the existing [issue forms](https://github.com/BasedHardware/omi-vector-bot/issues/new/choose) for a safe synthetic reproduction or answer-quality report. Keep customer details and security findings private. Existing issue assignments are preserved; working on a fix does not authorize assigning it to someone.

## Service endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Runtime readiness and configured handoff capability |
| `GET /ratings` | Aggregate helpful/still-needs-help feedback |
| `POST /github-webhook` | Signed, scoped GitHub status events |

Health/configuration is not proof that a staff case was accepted or a customer’s problem was resolved.
