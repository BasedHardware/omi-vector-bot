# Mira documentation

Start with the [master plan](SUPPORT_MASTER_PLAN.md). It is the current product checklist, score, issue disposition and execution order. Older dated checkpoints describe history; they do not override the current plan.

## Product and implementation

| Document | Use it for |
| --- | --- |
| [Master plan](SUPPORT_MASTER_PLAN.md) · [Evidence ledger](SUPPORT_PROGRESS.json) | Current completion, actual rollout state and remaining acceptance gates |
| [Architecture](ARCHITECTURE.md) | Customer → evidence → answer/review → delivery → staff/engineering workflow |
| [Implementation checklist](IMPLEMENTATION_PLAN.md) · [Roadmap](../ROADMAP.md) | Implemented boundaries, checks and next work |
| [Mira’s voice](MIRA_PERSONALITY.md) · [Answer-quality contract](ANSWER_QUALITY_CONTRACT.md) | Considerate, useful and truthful support behavior |
| [Source conflicts](SOURCE_CONFLICTS.md) | Draft publisher provenance, applicability-aware ordering and unresolved-conflict policy |

## Operations, privacy and verification

| Document | Use it for |
| --- | --- |
| [Runbook](RUNBOOK.md) | Startup, release/rollback, staff handling and uncertain outcomes |
| [Public intake privacy](PRIVATE_INTAKE_POLICY.md) | Keeping private values and account/order intake out of public replies |
| [GitHub notice lifecycle](GITHUB_NOTICE_LIFECYCLE.md) | Replay fences, approved retention, erasure and release limits |
| [Memory pilot preparation](MEMORY_PILOT_PREPARATION.md) · [Pilot checks](MEMORY_PILOT_CHECKS.md) | References-only design, approved notice and still-required enablement gates |
| [Reviewed-knowledge privacy](KNOWLEDGE_PRIVACY.md) · [Retention](KNOWLEDGE_RETENTION.md) | Owner-scoped correction links, erasure and mandatory cleanup |
| [Answer-stage evidence](ANSWER_STAGE_EVIDENCE.md) | Text-free evaluation tracing and what historical results cannot prove |
| [Evaluation guide](EVALUATION.md) | Offline checks, paid-run authorization, SQL versus in-memory harness coverage and release limits |
| [Data strategy](MIRA_DATA_STRATEGY.md) | Dataset rights, original synthetic scenarios and future evaluation gates |

## History

The [October25 issue audit](SUPPORT_ISSUE_AUDIT_2026-10-25.md) and [master-plan archive](SUPPORT_MASTER_PLAN_HISTORY_2026-10-25.md) preserve earlier decisions and evidence. Their dated counts are historical. Keep stable issue/PR references and branches when work is superseded; never turn a closed PR into a claim that its original requirement was delivered.
