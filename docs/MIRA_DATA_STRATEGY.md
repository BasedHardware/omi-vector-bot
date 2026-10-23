# Better support from better examples

Researched October 23, 2026. **Prepared, not trained or deployed.** This extends A1/A2/E2 in the [master plan](SUPPORT_MASTER_PLAN.md), behind its existing finish queue. No new feature PR, provider call, dataset-row download, prompt change or optional-feature enablement accompanies this document.

## What Aryan wants

Mira should notice the customer's actual difficulty, remember what they already tried, explain things simply and choose a useful next step. A frustrated customer needs competent help, not a psychology lecture, repeated apologies or an invented promise.

The October 23 request adds research and preparation for separately licensed public data and original synthetic examples. It does **not** authorize training on Discord messages, bypass existing release gates or imply that the current provider supports weight training. Actual training is a separate, costed experiment after data and provider checks. Do not confuse examples in a prompt, product-source retrieval, case memory and changing model weights.

## Dataset shortlist

These are source/license screens, not completed legal, privacy or quality approvals. The [metadata register](data/mira-dataset-register.json) contains no corpus rows. Every external entry remains blocked from ingestion until a pinned revision, attribution/terms receipt and bounded content review are recorded. Do not execute downloaded dataset scripts.

| Source | Useful skill to investigate | Terms observed at the owner | Decision and limit |
| --- | --- | --- | --- |
| [Google GoEmotions](https://github.com/google-research/google-research/blob/master/goemotions/README.md) | Distinguishing expressed confusion, disappointment and frustration | Google's [repository notice](https://github.com/google-research/google-research/blob/master/README.md) assigns datasets CC BY 4.0, separately from code | Candidate for a small offline language-understanding experiment, not a reply corpus. Reddit provenance, identifying metadata, problematic content and documented demographic bias need review. Emotion labels do not establish a person's mental state. English results do not prove multilingual performance. |
| [Amazon MASSIVE](https://github.com/alexa/massive) | Multilingual intent and meaning preservation | The [dataset notice](https://github.com/alexa/massive/blob/main/NOTICE.md) specifies CC BY 4.0 and SLURP provenance | Candidate; retain upstream attribution and group translations together when splitting. Voice-assistant requests are not Omi instructions or empathy demonstrations. |
| [PolyAI BANKING77](https://huggingface.co/datasets/PolyAI/banking77/blob/main/README.md) | Separating closely related customer intents | Owner card and [original license](https://github.com/PolyAI-LDN/task-specific-datasets/blob/master/LICENSE) specify CC BY 4.0 | Candidate for intent tests only. Banking labels or responses must not become Omi refund, account or payment policy. |
| [CLINC150](https://github.com/clinc/oos-eval) | Recognizing requests outside supported scope | Original [license](https://github.com/clinc/oos-eval/blob/master/LICENSE) is CC BY 3.0 | Candidate for uncertainty/intent experiments. It contains single-intent English requests, so it cannot validate multipart handling or multilingual support. |
| [Bitext customer support](https://huggingface.co/datasets/bitext/Bitext-customer-support-llm-chatbot-training-dataset/blob/main/README.md) | Support phrasing, spelling variation and customer intents | Owner card: CDLA-Sharing-1.0; hybrid synthetic data | Candidate with a terms review. Keep generic action claims and fictional company policies out of Mira's reply examples. [The license](https://cdla.dev/sharing-1-0/) distinguishes data/enhanced-data publication from computational results; do not simply label it MIT or assume all exported mixtures/weights are unrestricted. |
| [ASAPP Action-Based Conversations](https://github.com/asappresearch/abcd) | Correct order of identity, policy and support steps | Repository has an [MIT software license](https://github.com/asappresearch/abcd/blob/master/LICENSE); separate data applicability not established in this screen | Hold for data-license clarification. Research describes fictional shopping workflows; never import their refund authority, account access or scripted successful actions. |
| [Meta EmpatheticDialogues](https://github.com/facebookresearch/EmpatheticDialogues) | Empathetic conversation research | Original [license](https://github.com/facebookresearch/EmpatheticDialogues/blob/main/LICENSE): CC BY-NC 4.0 | Exclude from Mira's commercial training/prompt-example corpus without separate permission. An internal commercial experiment is not automatically exempt. |
| [Tsinghua ESConv](https://github.com/thu-coai/Emotional-Support-Conversation) | Emotional-support research | Owner [README](https://github.com/thu-coai/Emotional-Support-Conversation/blob/main/README.md) restricts data and code to academic research | Exclude without separate permission. Therapy-like topics and self-disclosure strategies also make it a poor default for product support. |

Selection is based on the proposed task, not download count. The usefulness above is an engineering hypothesis, not measured improvement. Hugging Face and search engines are discovery tools, not proof of rights. A mirror's license tag cannot override the original owner's terms. Do not collect therapy transcripts, diagnoses, private counseling, scraped support chats or unrelated technical Q&A in bulk.

## Fit it into the existing pipeline

Keep four boundaries separate:

| Input | Permitted role after its own review | Never treat it as |
| --- | --- | --- |
| Licensed public language/intent data | Bounded offline skill experiments and reviewed examples | Current product policy or permission to perform an action |
| Independently authored Omi support scenarios | Tone, continuity, grounding and handoff evaluation; reviewed demonstrations later | Actual customer evidence or proof a live case was solved |
| Current official Omi sources and approved facts | Existing retrieval/answer/reviewer pipeline, preserving source rank and freshness | A static promise that a fact remains true after training |
| Approved scoped case references | Avoid repeating the same customer's intake/failed steps under C1–C4 | A training corpus, psychological profile or reusable product instruction |

Keep application-controlled privacy, routing, ownership, staff receipt and delivery fences outside the model. No new emotion classifier or model round trip is justified yet. A model trained to sound reassuring still cannot say staff accepted a case without the application event.

The inspected [current provider adapter](../commandcode.js) uses chat completions, not a training interface. This does not establish whether the provider offers a separate training product or whether this account may use one. Do not treat access to replies as access to model weights or training jobs.

Discord's [Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy) prohibits training AI on API message content without Discord's express permission. Public threads, customer consent or paraphrasing are not a workaround. Do not feed restricted text through another model to manufacture apparently synthetic training data. Approved memory and de-identified improvement signals retain their separate policy gates.

## What good emotional intelligence means here

Assess observable response behavior, not hidden personality or clinical scores:

- Recognize stated impact briefly and specifically, without inventing feelings or diagnosing a person.
- Preserve supplied facts and failed attempts. Acknowledge a bot mistake clearly; do not make the customer repeat the whole story.
- Use plain language, normally 40–80 words, with one next action. Answer requested parts in order; keep necessary warnings and sources even if longer.
- Be calm, warm and practical. No flirting, pet names, invented personal experiences, dependence-building or gender stereotypes. Preserve clear AI disclosure.
- Separate requested, delivered, accepted and resolved states. Helpful framing never changes the underlying facts or promises recovery, refunds or dates.
- Match the customer's language and avoid assuming terse wording, spelling errors or a particular dialect means anger. Test native and code-switched inputs separately.
- Never retain an inferred psychological profile or use emotion guesses to determine customer eligibility, priority, account actions or protected handoffs.

The [12 original seed scenarios](data/mira-support-scenarios.json) cover these boundaries using fictional application state and untrusted synthetic messages. They are evaluation specifications, **not approved answers, a test runner, training-ready rows or a passed benchmark**. They contain no copied customer conversation, protected evaluation sentence or external dataset row. Scenario messages must remain untrusted even when they ask Mira to ignore a rule.

## Work checklist — no extra open PRs

- [x] Research eight owner-published candidates and record observed terms, domain fit and exclusions.
- [x] Write a metadata-only register with ingestion blocked by default.
- [x] Prepare 12 original scenarios across English, Spanish, Chinese and Hindi scripts/code-switching. Fluent-speaker review remains open; authored text is not a linguistic certification.
- [ ] Finish the existing PR queue, including the reproduced language and delivery-recovery defects. Datasets cannot repair an ownership race or lost retrieval evidence.
- [ ] Within the existing A1/#59 workstream, freeze a small development/evaluation split and collect a baseline. Keep scenario families, translations and paraphrases in one split; never train on the evaluation split. The sealed release suite stays sealed and out of tuning.
- [ ] Review a bounded sample of each selected, rights-cleared source; record its exact revision/hash, license text, attribution, upstream terms, personal-data filtering, bias, exclusions and reviewer. Missing rights or scope means blocked, not guessed approval.
- [ ] Author an initial small set of source-grounded, state-aware good/bad reply pairs. Record source references, permitted claims, actual application state, locale and reviewer. No imported product policy, unverified success claims or copied restricted conversations. Reject repeated apologies and warmth that hides a wrong answer.
- [ ] Compare a reviewed prompt/example-only candidate against the baseline first, changing one component at a time. Measure empathy, technical correctness, no repeated failed steps, appropriate handoffs, complete multipart coverage, word count, cost and p50/p95. Keep existing release quality, speed and independent-review gates.
- [ ] Only if a measured gap remains: verify the actual inference provider/base model's training access, license, upload/privacy terms, export/rollback path and a capped cost estimate before proposing a weight-training job. No paid training or provider migration has been started or approved by this research record.
- [ ] Independently review before readiness; release only under the existing approval/rollback process. Report measured results, not “Mira learned” because a file was saved.

The evaluation-first sequence follows [official OpenAI optimization guidance](https://developers.openai.com/api/docs/guides/model-optimization). That page also currently says its fine-tuning platform is winding down and unavailable to new users; it is not evidence that Mira's configured provider/account has training access. Provider selection remains unverified, and this plan does not require an OpenAI migration.

## Current result

Research, selection metadata and seed specifications are prepared. **Zero external corpus rows ingested; zero training jobs; zero production changes; zero new feature PRs.** No claim of improved emotional intelligence or answer accuracy yet. Master score stays **47/100**. Aryan need not collect datasets or send Discord test posts for this preparation. A spending or rights decision will be requested only when a concrete experiment reaches it.
