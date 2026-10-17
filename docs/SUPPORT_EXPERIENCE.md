# Clear, trustworthy support that improves with use

Research/design record, October 17, 2026. This is a staged product design, not a claim that the bot is production-ready, a legal clearance, or a model-training permission.

## Decisions for this draft

Customers should get the shortest complete useful answer, in normal language. The chosen default is 40–80 words, at most three short steps, one or two sentences per paragraph and one next action. That numeric target is our product decision, not a research finding or a hard truncation limit. Preserve necessary warnings, sources and requested parts. Acknowledge the actual disruption, remember attempts and avoid repetitive greetings/apologies. Keep real UI labels; translate unnecessary engineering terms. Developer questions can retain the technical detail they actually need.

The working persona is **Mira · Omi AI support**: calm, practical and kind. A name gives the experience consistency; it must not suggest a human employee is typing. Do not invent a biography, feelings, backend access, investigation, staff ownership, deadline or outcome. Delivery, acceptance and resolution remain different application-confirmed states. A humane tone cannot repair an undelivered handoff.

Reliability means correct sourced answers, preserved customer context, truthful case state and actual staff receipt—not just speed or a warmer name. Measure rejected answers, missing evidence, failed delivery and reopened cases before asserting improvement. A positive click or a quiet thread does not establish a verified fix.

## Research and what it changes

| Primary source | Design consequence |
| --- | --- |
| [Google conversation design: persona](https://developers.google.com/assistant/conversation-design/create-a-persona) | Use one brief, consistent persona rather than improvising a different character on each turn. This is design guidance, not evidence that impersonating a person improves support. |
| [Microsoft/CHI 2019: Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/Guidelines-for-Human-AI-Interaction-camera-ready.pdf) | Set truthful expectations, use relevant context and support correction. Its evaluation involved design practitioners and AI products; it is not an Omi support outcome study. |
| [Intercom: tone and answer length](https://www.intercom.com/help/en/articles/13177409-customize-fin-ai-agent-tone-of-voice-and-answer-length) | Treat tone and length as explicit product controls, preserving useful information rather than blindly clipping. Vendor practice is not an independent performance guarantee. |
| [Intercom: AI disclosure](https://www.intercom.com/help/en/articles/11712008-ai-agent-disclosure) | Keep the AI identity visible; friendliness should not disguise who the customer is speaking with. |
| [Intercom: content recommendations](https://www.intercom.com/help/en/articles/11394959-use-ai-powered-content-recommendations-to-improve-fin) | Find gaps in unresolved outcomes and keep edits reviewable before publication. Its available tooling is an example, not a capability this bot already has. |
| [NBER: Generative AI at Work](https://www.nber.org/papers/w31161) | Study real outcomes and transfer checked practices. Research on assistance to human support agents does not show that an autonomous bot safely improves by copying every conversation. No published uplift is treated as an Omi forecast. |

## Memory is not model training

The [Discord Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy) limits API data to stated app functionality, restricts improvement use to aggregate/de-identified data, prohibits scraping and requires Discord's express permission for training models on API message content. A public post, server ownership or removing names does not by itself grant that permission. The [Developer Terms](https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service) also require an accurate accessible privacy policy, appropriate security, necessary retention, user-requested deletion and applicable App Review. Obtain a qualified policy/privacy review for the actual deployment; do not label a workaround compliant merely because it is called memory or retrieval.

This draft does not train/fine-tune, build a training dataset, make embeddings, bulk-backfill a server, replay real customer cases or auto-publish answers. For supporting an individual active case, proposed bounded encrypted memory preserves relevant context and checks Discord again before reuse. For improvement, only aggregate operational categories produce review actions. Identifiable case content does not enter those suggestions. Regex redaction alone is not a proof of de-identification.

## Implemented foundation versus next phase

Implemented and disabled: a shared voice contract; scoped encrypted text history; edit/deletion/expiry and customer post opt-out; independent capture/context switches; bounded optional work; synthetic regression and SQL checks; fixed operational signals and aggregate review actions. Existing official retrieval, answer review, private capability rules, staff case transitions and public filing approval remain authoritative.

Still needed: a privacy-reviewed de-identification process for improvement inputs; more specific issue grouping; official-source-backed correction drafts with provenance, owner, version and expiry; approval/rejection controls; synthetic regression generation and validation; controlled publication/revocation; and measured before/after outcomes. Customer reports and staff replies can suggest a question to investigate, but cannot become authoritative product facts on their own. Those capabilities are not supplied by the initial aggregate report.

A future fine-tuning project is separate: identify suitable training rights and data, secure any required platform permissions, prepare checked targets, estimate compute/provider cost, run an isolated comparison and retain the unchanged baseline. No continuous self-editing or unattended production deployment is authorized.

## Enablement gates

1. Finish code review and the required answer-quality gate, leaving protected inputs unopened. Do not treat unit success as real answer quality or bypass held #42/#28 work.
2. Approve and publish the data-use notice, necessary retention (proposed maximum 30 days), processors, deletion/backups and security/key handling. Resolve any App Review requirement.
3. Pilot capture in an authorized staff-only shadow setting; verify coverage, edits, deletes, opt-out, retention and database/restart behavior without collecting unrelated people.
4. Separately enable owner-scoped contextual use after isolation, prompt-injection, latency and source-ranking checks. Staff history is conversation context, never policy.
5. Ship one reviewed release with rollback and real receipt/closure checks. Routine regressions should run automatically; do not repeatedly ask Aryan to manufacture Discord posts for unit-level evidence.
