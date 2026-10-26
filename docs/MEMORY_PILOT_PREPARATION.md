# References-only memory pilot — preparation, not enablement

Updated October26,2026 against the merged references-only implementation. The exact notice wording below is approved; publication, configuration change, pilot and paid runs are not. Aryan deployed #86 as647b549/dba28f7d after its code/CI/review gates; the notice smoke and applicable privacy/security/processor/backup gates remain. Memory stays off.

## Approved customer notice — wording only, not published

> I'm Mira, Omi's AI support assistant. In this test forum, I may look back at up to two of your earlier support posts from the last 30 days, so you don't have to repeat what you've already tried. I don't save copies of your messages; I keep a link and re-read them when needed, and that text is sent to our AI provider only to write my reply. To clear this and stop it, use /forget-support-history in your own post. This doesn't delete your Discord posts or other support records.

Test forum only, not public Help. Do not publish this as current enabled behavior. Minimal opt-out state remains. Operational case/approval/issue-link data and backup erasure are separate (#85); the memory command does not erase them. Processor handling and any platform review need actual evidence; transient context can reach the model provider, so do not promise otherwise.

## Actual code and proposed controls

| Control | Implementation-accurate boundary |
| --- | --- |
| Capture | `SUPPORT_MEMORY_ENABLED=1` AND `SUPPORT_MEMORY_POLICY_APPROVED=1`, `DATABASE_URL`, approved forum allowlist |
| Context use | Additionally `SUPPORT_MEMORY_CONTEXT_ENABLED=1`; capture approval is not context-use approval |
| Test forum | `SUPPORT_MEMORY_FORUM_IDS` equals existing configured `VECTOR_TEST_CHANNEL_ID` only. Resolve/verify the actual ID privately from current operator configuration before enablement; no invented ID, Help by default or private destination copied into this public document. |
| Retention | `SUPPORT_MEMORY_RETENTION_DAYS=30`, capped30, original creation-based expiry; edits cannot extend it |
| Context | Same live guild/forum/current owner; at most two other posts, three latest owner messages and this bot's latest reply each. Staff chat is not prior-post context. |
| Failure budget | Whole extra operation≤1.5s; three outstanding optional read operations per process, not a global ceiling. Current-post fallback; late results cannot enter the reply. |
| Cleanup | Owner/forum opt-out, deletion and mandatory expiry continue with capture/context off. Unknown legacy scope cannot become a deletion-success claim. |

Sources: `supportMemory.configFromEnv`, `supportLearning.getObserver/createObserver/forgetOwnedThread`, `supportMemoryStore`, `supportKnowledgePrivacy`, `scripts/verify-memory-context.js`.

### Kill-switch timing — not an instant platform guarantee

Policy checks reread the running Node process's environment between operations/read stages. A Railway variable change does **not** mutate an already-running process. An approved change therefore needs the operator's verified replacement/restart path; overlapping old workers keep their old environment until stopped. Follow approved Redeploy teardown, not a claim that clicking a variable instantly disables every worker.

Within a process with disabled policy, new/queued captures recheck the switch, context stages stop and late results are discarded; erasure/expiry continue. Already-issued DB/REST promises are not claimed cancelled. Disabling cannot retract context already sent to a model or erase other systems. Verify all active workers during an incident and obtain needed stop/rollback authority.

## Before enablement

- [ ] Accept the scoped duplicate-status notice smoke; #86 is deployed, health/startup verified, but notice delivery is not yet accepted.
- [x] Exact revised notice wording approved by the October26 user-supplied reviewer decision, including AI-provider use.
- [ ] Publish the approved notice in the test forum before capture, only under the later approved rollout.
- [ ] Review processor/data use, applicable security/platform review, deletion and backups. Existing30-day support-memory approval stands. #86 has a separate30-day receipt lifecycle decision, not blanket approval for other operational metadata.
- [ ] Privately verify runtime SHA, actual test-forum ID, allowlist, all controls, staff audience and a tested rollback target. No secrets in the receipt.
- [ ] Obtain explicit **enable** approval for capture/context and the approved isolated runtime/destination. A generic “continue” or passed test is not enablement.
- [ ] Arm required bounded metadata-only observation first. Aryan sends every Discord input/command/button; no automated posts.

## Rehearsal and acceptance

Reuse the existing SQL/reader rehearsal: actual adapters/services/readers with synthetic messages, owner/forum/guild exclusion, live ownership/edit/delete checks, recreation, opt-out/off-switch erasure, populated no-text rows and expiry. This is not generated-answer behavior or a full bot restart; don't repeat unrelated release certification.

After reviewed enablement only, give one copy-ready synthetic input at a time:

1. Prior owner post supplies a harmless attempted step plus app/device detail; a fresh related post must use that context without asking again or treating chat as product evidence. Verify a real generated answer and official sources, not only prompt inclusion.
2. Exclude other owners/forums/guilds, changed owner, deleted messages/posts and injected instructions. Live edits must be re-fetched.
3. Inject denied-read/timeout/database faults in isolation; normal current-post answering survives. Record measured extra-work latency and missing coverage, not fake zero failures.
4. Forget across owner/forum posts and queued writers, with switches off; verify durable opt-out after actual worker replacement/new post. Do not imply Discord, backups or operational metadata were erased.
5. Test creation-based expiry with an isolated clock/SQL fixture, not production edits or a30-day wait. Inspect schemas and populated rows before erasure for message/ciphertext absence.
6. Verify operator kill/rollback and overlapping-worker state, without claiming instant cancellation or repeating uncertain notices.
7. Observe **at least48 clean hours** after functional checks in the test forum. Record volume, coverage, failures and unknowns; time alone is not a pass. Material scope/privacy/functional failure stops the pilot and follows the authorized incident/rollback path.

Public Help expansion requires separate reviewed approval/notice. This preparation creates no schedule, monitor, credential, deployment, retention grant or paid evaluation.
