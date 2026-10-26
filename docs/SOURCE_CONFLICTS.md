# Source provenance and conflicting guidance — #83

October26 draft implementation, not merged or deployed. This extends the existing ingestion → PostgreSQL/chunks → ranking → answer → review pipeline. It does not add a model call, a second knowledge store or a URL-specific exception. Main/production and all other acceptance requirements remain in the [master plan](SUPPORT_MASTER_PLAN.md).

## Failure and contract

An older official page can be cited correctly while giving an outdated rule. A recent fetch does not make its contents recent, and a newer page does not automatically apply to a different product, platform or version. Source authority still controls. Missing information is not a contradiction; older complementary facts and protective warnings must remain available.

The shared answer/review policy requires the actual topic and product/surface/version applicability to be supported before treating a newer rule as superseding a conflicting one. Otherwise retain material uncertainty and use the existing person workflow. Document dates are not deployment, release or customer-account evidence. Injected-provider tests prove policy delivery and unchanged request count, not that a live model follows the policy.

## Publisher metadata

Help Center ingestion reads bounded Article JSON-LD bound to the fetched page's URL. It retains explicit datePublished/dateModified and, only when declared in about:SoftwareApplication, name/operatingSystem/softwareVersion. It does not infer product scope from an article title, language, viewport or a mention in body text. Missing/ambiguous/invalid/future dates stay unknown. Multiple contradictory article metadata records fail closed; sitemap/fetch times are never promoted to publication/update dates.

The source page stores one sanitized provenance JSON object. Chunks receive it in memory; persisted search joins it from their parent page so reindexing cannot create competing provenance copies. Refreshing a page without reliable metadata clears the old provenance. Existing pages upgrade additively to an empty object, without invented dates or changes to their bodies. Valid provenance survives the real save/search/evidence path. Non-Help-Center sources may carry explicitly declared metadata through the same schema; this draft does not manufacture dates for sources whose adapters provide none.

Formatted evidence includes bounded publisher dates/date origin and any explicit applicability. Incomplete applicability is marked as such. These fields count inside the existing evidence-character budget; no extra page fetches or tokens are requested by a separate process. Generated-answer cost/coverage effects still need approved evaluation.

## Conservative deterministic ordering

Both stored fusion and local ranking can reorder their already-ranked slots when documents have:

- the same official source kind/authority;
- the same normalized article title and section (a generic section such as Overview is insufficient);
- identical explicitly declared product, surface and version identifiers;
- comparable reliable dates (updated versus updated, or published versus published).
- equal existing relevance signals: stored rank contribution and query corroboration, or local keyword rank; source-fit remains equal too.

Newer documents occupy the earlier slots only within that group. Other topics, authorities and scopes keep their positions; a date cannot replace a stronger match or broader corroboration across searches. Identifier punctuation is significant: version2.1 cannot become version2-1. Equal, unknown, unreliable or incomparable dates do not create preference. Rows are not deleted or declared obsolete. The fixed sourcePreference enum explains the ordering; it is not proof of semantic contradiction or customer-version applicability.

This narrow ordering is deliberately separate from resolving a claim. The existing answer/reviewer must still establish the actual applicability and contradiction from the evidence; a heading match alone is insufficient. Incomplete or differently worded topics remain available with their dates/uncertainty rather than being silently filtered. No broad claim that every official-source conflict is automatically solved follows.

## Checks and readiness

Fourteen new synthetic tests cover ingestion/ambiguity, chunks, real formatted stored evidence, known-scope preference, authority/topic/surface/version exclusions, punctuation, absent/equal/unreliable/incomparable metadata, complementary safety facts, shared answer/normal+compact review policy delivery, and two-/three-part fetch guards. The independent review reproduced a generic-heading collision that displaced relevant evidence at the eight-slot cap. The repaired key includes article title/section and relevance equivalence; new guards cover that full-cap case, stronger matches and multi-query corroboration. Observed red-before records also distinguish four missing-provenance behaviors, two ordering behaviors, absent policy delivery and an identifier-normalization error. No protected inputs, customer messages or production writes are used.

The two-/three-part checks assert all six page requests start before any completes, the per-request timeout remains 10 seconds, and existing eight-chunk/9000-character output bounds hold. The real persistence/search/formatter owners are exercised against the isolated SQL engine, including an undated refresh and idempotent schema initialization. Runtime `42619cf` passes hosted Node 20/24/real PostgreSQL CI and independent scoped code review: 69 affected checks and all four original reproduction assertions. Later documentation-only heads retain their current CI/review requirement. The evaluation harness receives provenance through the same Help Center/chunk owners; its separate in-memory/storage limitations remain in the [evaluation guide](EVALUATION.md).

Before readiness: complete current-head CI, independent scope/accuracy review and the required approved generated-answer checks. No paid comparison is authorized merely by this draft. Keep #83 open until its full acceptance is evidenced; #65 multipart accuracy and #62 narration/context loss remain separate unfinished work. No deployment, memory enablement or extra Discord smoke follows from these tests.
