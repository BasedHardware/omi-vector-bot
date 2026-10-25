# Evidence scope and customer-data claims — draft C

October25 checkpoint: A/#80 and B/#81 merged; exact GitHub main `d550dc1` remains deployed as `1bce9049-6128-4db8-b0a2-d6c57ed27656`, one healthy instance, optional features off. Rollback is `0262f351`/`1235379`. Aryan's German handoff and redirect-cleanup smokes now pass their limited visible language/delivery/cleanup boundaries, not every fallback branch or customer resolution. C is undeployed and #71 remains unapproved. Clean comparison refs and a private three-arm supervisor are prepared; independent launch review still precedes provider use.

## General accuracy boundary

Selected source blocks now explicitly say `excerpt; complete page coverage not established`. This applies conservatively to selected chunks, including apparently short ones; it does not assert missing sections exist. Authority/source identity, page/fetch caps, per-page and total evidence budgets remain unchanged. The marker consumes the existing budget rather than expanding it. Answer and reviewer receive the same source text/marker through the existing pipeline, subject to their existing context limits.

The shared contract forbids inferring source-wide absence or unsupported/nonexistent features from missing excerpt content. Say it could not be confirmed and take the person path. An explicit negative statement actually supplied by an official source may support a negative answer. General storage/retention documents cannot verify that a specific customer's data exists, is intact/safe or can be recovered. Each citation must support its associated claims; a fact true elsewhere is not established by an unrelated citation.

## Required reviewer checks

The reviewer returns three boolean `claim_checks` for its **final rewritten answer**: unsupported_absence, unsupported_customer_data and citations_supported. The decoder cannot approve an answer with missing/malformed checks, either unsupported-claim flag, or unsupported citations even if `grounded=true`. The existing second-look limit remains; a persistently invalid review uses the existing unapproved/localised person path. Existing safe application-owned handoff fallbacks remain available. No additional provider round trip, private capability, customer-data lookup, topic-specific phrase/URL or regex semantic classifier is introduced.

These are model judgments plus deterministic schema/decision enforcement, not independent proof of semantic truth. A model can incorrectly pass its own checks; independent comparison/grading is still required. Missing fields may increase handoffs or second-look usage; that is measured rather than silently waived.

## Offline evidence and limits

Seven original synthetic groups cover formatting, shared actual request policy, rejected excerpt-absence and specific-data claims, explicit supported negative evidence, uncertainty rewrite and missing/malformed/citation checks. Five fail before implementation and all pass after. Independent review also caught the incomplete advertised JSON example: normal and compact retry assertions fail before the example includes the mandatory fields, then pass. The provider responses are stubs supplying the semantic judgment; tests verify actual prompts/decoder/decision wiring, **not real-provider classification quality**. New cases contain no eval phrases/features/URLs. Five legacy approval fixtures gain valid schema fields without changing their assertions; missing/malformed fields stay explicitly tested.

The actual live-eval handler path records only boolean reviewer-check metadata and per-row UTC boundaries, without altering the judge, source budgets or provider requests. Metadata is scoped to the current case/turn. Old main has no claim-check return field: `claimChecksAvailable=false` means unavailable, not that its replies passed these checks. All original result rows must be retained. A pure red-before metadata whitelist test rejects raw reply content from the recorded fields. This is not #77's unfinished stage-fingerprint feature.

The shared live-eval adapter now delegates multipart selection to the evaluated root's `hasMultipleParts` when available; legacy roots retain their existing greater-than-three rule. One red-before test covers both policies at one/two/three/four parts and exact argument forwarding. This keeps the comparison faithful rather than applying one arm's threshold to every arm. It changes no runtime retrieval threshold, page cap or timeout.

## Remaining gates

- Full986/offline8 and independent pre-provider code review pass, including the normal/compact JSON example and evaluated-root adapter. These do not establish semantic accuracy. Exact-head hosted CI remains required; keep draft.
- C pre-provider code review/current-head CI and Aryan's A+B smokes pass; independent supervisor/source/host launch review still precedes provider use.
- Prepare one simultaneous three-arm comparison: current deployed main | main+C | main+C+#71, same machine and per-arm concurrency,81×2 each. Confirm the adapter follows each root's evidence policy rather than masking #71. Freeze and verify SHAs, dependency/source/harness provenance, date/power/interruption guards and all outputs; do not read protected case contents.
- Report pass-both, unwanted/missing handoffs and p50/p95. Build result-only flagged-answer artifacts across all arms for source-absence, customer-data and citation signals, retaining every row and distinguishing model flags from independent grading. Flags do not prove causation. No unchanged automatic rerun or merge from aggregate scores alone.

#28's October27 decision and optional memory's original pilot gates are separate. This draft does not resolve #65 or authorise #71 merge.
