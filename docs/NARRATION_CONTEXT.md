# Narration, useful context and the reviewer boundary — #62

October 26 local draft, not merged or deployed. This extends the existing parse → draft-safety → reviewer/second look → presentation → application-owned delivery pipeline. It adds no model stage, customer-history store, backend capability or receipt authority.

## Failure and intended behavior

A mixed sentence can contain both a customer's earlier attempt and an unsupported staff-notification claim. Parsing used to discard the whole sentence before the existing removed-text audit could see it. The final reviewer could also introduce another notification claim; later filtering could remove useful context while leaving its grounded approval intact. A genuine requirement for a person was sometimes erased as though it were a completed handoff.

Preserve the actual symptom, earlier attempt, uncertainty, warning and prerequisite when safe. Remove unverified staff claims, but never infer that a remaining action is independent of a removed condition. Requested handoff, confirmed delivery, staff acceptance and resolution stay separate. Only the application adds delivery copy after the existing send result.

## One current-result audit owner

`answerFilterAudit.js` keeps removed units in a result-object-keyed WeakMap, not an enumerable property. Ordinary JSON/object spread, history, database records and text-free stage evidence do not serialize the text. Each audit is limited to twelve complete units and 6,000 characters, deduplicated by normalized text. Oversized units are omitted with an explicit truncation flag rather than cut into fragments. Reads return copies; parallel results have separate keys.

`parseAgentJson` records removals by the existing staff-claim filter. The actual handler and no-model-capable customer-eval owner explicitly merge this transient audit with the existing draft audit before review. Removed text is prior-model output, **untrusted and never product evidence**. The existing reviewer may restore a useful fact only from the supplied conversation and official-source evidence; it may not restore invented pings or promises. Audit truncation is disclosed to the reviewer. The text expires with the current result; this is not memory enablement or training data.

The actual reviewer runs the same narration owner as final presentation before approving output. A destructive staff/narration removal invalidates that review and retains escalation. The existing one second look receives its removed context; there is no third look or automatic provider rerun. A clean second result can be selected. If both remain unsafe, the existing localized rejected-review fallback and person workflow apply. Sanitization alone is not grounding approval.

## Conservative language boundary

Specific review-requirement and honest-uncertainty patterns are no longer treated as notification chatter. The broad staff-affiliation guard remains: unknown ownership, capability, receipt or investigation expressions fail closed. `reviewRequirement.js` supplies one bounded grammatical requirement result to both publication and wording-based routing. Only complete bounded grammatical review requirements receive an exemption; an added predicate such as acceptance cannot borrow that exemption. Markdown cannot hide guarded words. A dash is not used to split a prerequisite away from its dependent action.

The English wording fallback for person requirements excludes quoted, negated and conditional examples where recognized, distinguishes technical compound nouns, and retains an independent requirement after a complete present-availability qualifier for bounded diagnostics. Unknown or future requested-action qualifiers remain conditional; an imperative alone is not evidence of independence. Structured model, route, reviewer, privacy and data-risk signals remain authoritative. This is **not general semantic understanding or comprehensive multilingual claim detection**. Unknown forms may lose their whole unit and require a rejected-review fallback. Wider negation/reporting and generated-answer quality remain open; no universal preservation or no-false-handoff claim is made.

## Evidence and remaining gates

Original synthetic red-before checks reproduce joined-context loss, Markdown/whitespace mistakes, new routing mistakes and all three missing-audit/unsafe-approval paths. The first proposed finite list of forbidden staff predicates failed independent review because other predicates bypassed it; that approach was replaced with the conservative guard and bounded exemptions. Its failed evidence is retained privately. A subsequent independent review caught mismatched publication/routing modalities and an overly broad optional-detail condition exception. Both were reproduced red before the shared grammar and bounded qualifier repairs; direct person-decision regressions cover the positive and hypothetical cases.

Current local checks: 1,238 full tests, 8/8 no-model checks and 197 affected tests pass. Three new actual-handler tests use real parse/reviewer/filter/selection owners with injected provider responses, covering earliest removal, repaired second look and two unsafe reviews followed by localized rejection plus verified synthetic staff delivery. Other tests cover audit bounds, serialization absence, concurrency, selected-result metadata, Markdown, conditions, warnings, sources, ordinary output and existing delivered/failed/duplicate handoff composition. These transports are synthetic; they do not prove live model compliance.

Final independent code review, current-commit hosted CI and appropriate separately approved generated-answer quality remain before readiness. Keep #62 open and do not claim this local draft solves every narration or routing case. #90's original controlled comparison is preserved separately and remains on accuracy HOLD; its one-run grant is consumed. No paid run or Discord input is required for the offline checks, and none is authorized automatically by this draft.
