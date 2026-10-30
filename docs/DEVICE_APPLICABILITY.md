# Device applicability guard

This production fix addresses #83 and the October28 unknown-device smoke. It is a device-evidence boundary, not a new product fact or an accuracy percentage.

## Pipeline

Publisher Article metadata explicitly naming a Product is a restriction. Typed SoftwareApplication metadata remains separate. Bounded explicit restrictions and corroborated integration introductions can restrict a page; titles, incidental mentions, crawl times and missing scope cannot prove applicability. Invalid dates do not erase an independent restriction. Conflicting publisher restrictions remain unresolved.

The full document introduction is evaluated before chunking. Existing cached parent pages derive the same restriction on a bounded read of their first2,400characters, so old selected chunks need no remote fetch to recover a restriction outside that chunk. Refreshes replace obsolete provenance. Existing JSONB storage is reused; there is no customer-data migration or new table.

`formatEvidence` emits a separate catalog of actual selected blocks, their offsets, public source URLs and normalized scope. Combining evidence assigns catalog IDs at formatter-owned offsets; source bodies cannot add catalog entries using forged markers. Canonicalization and the official-source cache preserve the catalog. Scope is never taken from a model field or parsed metadata prose.

After an ordinary or compact review, application code checks selected source IDs and cited URLs against the catalog. Missing/invalid selection cannot exempt a retrieved restricted page. Unknown customer hardware, a mismatch or contradictory scope produces one localized device question. It is an application clarification, not an approved factual answer. Matching named hardware and generic evidence keep the existing answer path. The sourced canned-answer path receives the same guard.

Ownership comes from the actual newest customer message and ID-verified current-post history, not names, the planner, bot/other-customer messages or previous-post memory. Quoted, example and negated ownership does not establish hardware. Unrecognized identity stays unknown. Fixed enum trace fields `detectedDevice` and `evidenceDeviceScope` contain no customer text or arbitrary product name.

The clarification does not itself request a person. Existing explicit-person, protected-topic, data-loss and confirmed-failure requirements remain separate. Private delivery, acceptance and resolution retain their existing distinctions.

## Verification and limits

Original fictional red-before review reproduction is saved privately. Tests cover unknown/mismatched/matching hardware, publisher introduction versus incidental mention, invalid dates/conflicts, ownership, budgets, forged markers, combined IDs and compact retry. Actual handler checks cover explicit private handoff and clarification without a handoff. The isolated SQL rehearsal exercises real parent/chunk/save/search/refresh owners; hosted PostgreSQL checks remain required.

This guard checks declared cited-source applicability. It does not prove semantic grounding of every claim or recover restrictions a publisher never supplies. The normal grounding review still owns claims attributed only to a genuinely generic source. Bounded identity/declaration grammars may ask an extra question when wording is unfamiliar; do not infer universal applicability or complete multilingual understanding. Optional history/context remains disabled.

Independent review must decide whether this answer boundary requires a paid comparison. No provider run is authorized merely by passing these deterministic tests. Final full/no-model checks, all six unchanged #94 acceptance scenarios, current CI and independent review precede readiness. Deployment and Discord smokes are later release gates.
