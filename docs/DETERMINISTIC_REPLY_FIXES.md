# Deterministic reply repair — October 24

The reviewer did **not** approve #71. Aggregate improvements do not clear unsupported absence/compatibility claims, customer-specific data reassurance, citation mismatch or language loss. Both versions share false-absence failures; evidence spreading is plausible but unproven causation. The explicit p95 waiver remains conditional on accuracy approval. Keep #71 draft and preserve all saved results.

The two current production fixes are authorised exceptions to the three-PR cap, one problem per draft. Offline verification is sufficient for their deterministic boundary; required CI and independent review still precede merge. No new provider run is needed for A/B.

## A — orphaned redirect references

`stripSupportRedirect` removes anaphoric subject clauses joined to a removed support redirect. A subsequent same-paragraph reference-only sentence is also dropped unless it carries its own instruction, link or warning. Paragraph boundaries reset reference state. Noun-led independent clauses, customer attempts, Source lines and secret warnings remain. Unsupported language codes fail closed for split content rather than assuming independence. This is narrow reference cleanup, not the rejected #77 semantic parser.

Ten original synthetic helper groups and one real-handler test exercise semicolon tails, following sentences/lines, supported localized references, preservation, ordinary/handoff integration, Markdown subjects/instructions, consequence warnings versus nominal support topics, and unknown-language/format parity. Four initial groups failed before the fix. Independent review then found joined-warning, Markdown and unsupported-locale wiring gaps; new red-before tests reproduce them before repair. Both real escalation calls now pass replyLanguage. Full-suite/offline/current-CI/re-review results belong in the PR. Not merged or deployed at preparation time.

## B — localised review-rejection fallback

Prepared as separate draft #81: one shared language-table helper for the rejected-review answer, used by the real handler and evaluation mirror. Preserve the exact meaning and English default; no receipt, resolution or deadline promise. Original de/fr/es tests fail before the fix in both paths; after it, all963 pre-integration tests/offline8 and initial-head Node20/24/Postgres CI40085900133 pass. A/#80 is merged `16ee8ca`; this integration needs fresh full/CI and independent review. See [copy boundary](REVIEW_REJECTION_COPY.md). No provider call or deployment.

## After A/B

Merge only after exact-head CI and independent approval, then deploy the exact GitHub commit with the current verified deployment as rollback. Aryan supplies one German handoff input and one redirect-cleanup smoke input; failure means rollback. No shutdown/recovery changes or optional enablement.

Then prepare C: mark partial-page evidence as excerpts in both answer/reviewer inputs; disallow source-absence/unsupported-feature conclusions from missing excerpt content and customer-specific data assurance from general docs. Obtain review before any provider run. One later simultaneous three-arm comparison (main | main+C | main+C+#71) retains each arm's results and flagged-answer package. Protected source contents remain sealed; no case-specific production rule or expected URL.

#28 retains its October27 decision deadline; the memory-pilot gates are separate.
