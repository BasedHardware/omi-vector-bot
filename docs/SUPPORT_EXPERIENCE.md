# Clear, trustworthy support that improves with use

Research/design record, October 17, 2026. This is a staged product design, not a claim that the bot is production-ready, a legal clearance, or a model-training permission.

## Decisions for this draft

Customers should get the shortest complete useful answer, in normal language. The chosen default is 40–80 words, at most three short steps, one or two sentences per paragraph and one next action. That numeric target is our product decision, not a research finding or a hard truncation limit. Preserve necessary warnings, sources and requested parts. Acknowledge the actual disruption, remember attempts and avoid repetitive greetings/apologies. Keep real UI labels; translate unnecessary engineering terms. Developer questions can retain the technical detail they actually need.

The working display name is **Mira**. Aryan requested an elegant, warm, charming fictional feminine character and a modest adult portrait; the profile explicitly identifies her as Omi's AI support assistant. [The personality guide](MIRA_PERSONALITY.md) records the research, shared reply contract and review gates. A name gives the experience consistency; it must not suggest a human employee is typing. Do not invent a biography, feelings, backend access, investigation, staff ownership, deadline or outcome. Delivery, acceptance and resolution remain different application-confirmed states. A humane tone cannot repair an undelivered handoff. The profile change is live; the new reply contract and startup-name persistence are not yet deployed.

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

This draft does not train/fine-tune, build a training dataset, make embeddings, bulk-backfill a server, replay real customer cases or auto-publish answers. The original disabled foundation stores bounded encrypted text but re-fetches messages before use. Aryan's latest approved 30-day memory direction replaces that with references only and live, owner-scoped reads across posts. For improvement, only minimized operational signals enter review; neither live conversation context nor staff authorship establishes an official fact. Regex redaction alone is not a proof of de-identification.

### October 18 memory decision — design approved, replacement pending

Inspection confirms saved text is not used by `supportLearning.history()` as reply context: retained entries select IDs, then the observer fetches live messages. The existing foundation is also limited to the current post. Release 2 must remove unnecessary text/ciphertext/IV/tag, retain expiring references and text-free outcomes, and use at most two other same-owner posts in the same forum/guild. Only live titles, the owner's last three messages, this bot's last reply and stored outcome enter `conversation_only` context; never official evidence, citations, other customers' posts or staff channels. Database/Discord failure or the total 1.5-second deadline falls back to normal current-post history.

`/forget-support-history` must clear that owner's references/signals across their forum posts and stop future saving, with minimal persistent opt-out state. Edits/deletes are checked live, delete events retire references, and references expire/prune after 30 days. References remain customer-related data, not anonymity. Identity/order encryption is unchanged; memory no longer needs an encryption key. These are requirements, not claims that replacement code/tests or rollout exist.

Aryan is the daily fix-card reviewer. Start `feat/memory-references` from main after Release 1 deploys; keep all flags off. Unit/SQL/CI and a fresh memory-off main/branch comparison precede grading. An enabled two-post scenario needs an approved isolated runtime or the reviewed test-only deployment. After grading, pilot test-only for 48 clean hours plus functional checks, then reviewed public expansion. Do not say the following exact notice is pinned until publication is confirmed:

> I'm Mira, Omi's AI support assistant. So you don't have to repeat yourself, I can look back at your support posts from the last 30 days. I don't copy your messages or use them to train AI. Type /forget-support-history to clear this anytime.

## Implemented foundation versus next phase

### Inspected documentation conflict — October 18

The official [Language Support article](https://help.omi.me/en/articles/9942181-language-support-in-omi), dated October 1, 2024, says a conversation cannot detect multiple languages. The newer [recording/language troubleshooting article](https://help.omi.me/en/articles/13154896-recording-transcription-apps-and-tasks), dated December 14, 2025, describes selectable multi-language transcription under Profile. The [app guide](https://help.omi.me/en/articles/13153540-using-the-omi-app), dated January 6, 2026, also describes simultaneous multi-language support. These pages currently disagree; dates suggest a stale older page but do not prove current behavior on every app/version.

Master item D3 needs the documentation owner to confirm supported versions and update/archive the conflicting guidance. Do not create an unconditional staff fact to hide the conflict, claim the Help Center was fixed, or change the frozen Release 1 runtime from this inspection. No external ticket/message or Help Center edit was made.

Implemented and disabled: a shared voice contract; scoped encrypted text history; edit/deletion/expiry and customer post opt-out; independent capture/context switches; bounded optional work; synthetic regression and SQL checks; fixed operational signals and aggregate review actions. Existing official retrieval, answer review, private capability rules, staff case transitions and public filing approval remain authoritative.

Still needed: a privacy-reviewed de-identification process for improvement inputs; more specific issue grouping; official-source-backed correction drafts with provenance, owner, version and expiry; approval/rejection controls; synthetic regression generation and validation; controlled publication/revocation; and measured before/after outcomes. Customer reports and staff replies can suggest a question to investigate, but cannot become authoritative product facts on their own. Those capabilities are not supplied by the initial aggregate report.

A future fine-tuning project is separate: identify suitable training rights and data, secure any required platform permissions, prepare checked targets, estimate compute/provider cost, run an isolated comparison and retain the unchanged baseline. No continuous self-editing or unattended production deployment is authorized.

## Enablement gates

1. Finish code review and the required answer-quality gate, leaving protected inputs unopened. Do not treat unit success as real answer quality or bypass held #42/#28 work.
2. Thirty-day memory is approved. Replace the disabled text-retention foundation, review remaining processor/deletion/backups/security/platform requirements, and publish the accurate notice at approved expansion. Approval is not a claim that these checks are complete.
3. Pilot references/live context only in the approved private test forum after grading; verify coverage, edits, deletes, customer/forum-wide opt-out, retention, timeout and database/restart behavior without collecting unrelated people. Require 48 clean hours and functional checks.
4. Context reuse remains separately switchable and owner/forum-scoped after isolation, prompt-injection, latency and source-ranking checks. Conversation context is never policy.
5. Ship one reviewed release with rollback and real receipt/closure checks. Routine regressions should run automatically; do not repeatedly ask Aryan to manufacture Discord posts for unit-level evidence.
