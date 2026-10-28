# Source provenance and conflicting guidance — #83

October28 integration of main #91; final head review/CI pending before merge. Not deployed. This extends the existing ingestion → PostgreSQL/chunks → ranking → answer → review pipeline. It does not add a model call, a second knowledge store or a URL-specific exception. Main/production and all other acceptance requirements remain in the [master plan](SUPPORT_MASTER_PLAN.md).

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

## October 26 controlled answer comparison — frozen historical hold

Aryan approved one run with a ceiling of 288 requests. It completed all 48 answer flows using **96 requests**: twelve original fictional scenarios, two repetitions per arm, main `a9c9508` versus candidate `c870a8b` (runtime `42619cf`). Both arms used the same provider configuration and fixtures; initial starts were simultaneous and paired scenario starts differed by at most 4 ms. Both workers exited normally, source hashes stayed fixed, and saved full-window power history covers the run without a sleep/wake event. The single-use approval is consumed; unused ceiling is not authorization for another run.

Independent grades were frozen before the randomized arm mapping was opened. All 48 flows and every saved stage were read. Main passed 19/24 contracts with five material failures; candidate passed 21/24 with three material failures. These small, fictional-case counts are **not current-product accuracy percentages or proof of improvement/causation**. The reviewer withheld approval despite the higher candidate count.

| Candidate material failure | Saved stage finding | Required repair |
| --- | --- | --- |
| Categorical no-loss reassurance | Generated and reviewed text turn general local-pending behavior into a guarantee that a capture is not lost. | Keep intended behavior separate from verified customer state; preserve uncertainty and protective guidance. |
| Unsupported cloud-conversation state | Generated and reviewed text infer a cloud/UI outcome not established by the supplied source. | Require evidence for the actual state/visibility claim, not a plausible inference from upload behavior. |
| Invented completed staff notification | The reviewer introduces completed staff flagging with no dispatch or receipt. It survives presentation. | Enforce the distinction between a requested handoff and application-confirmed delivery throughout review/presentation. |

Main also has material unsupported privacy/data-state claims and missing next-step/person-workflow outputs. Existing saved stages identify defects; they do not establish that the provenance change caused them. Date/version/surface handling and the German context survived the candidate review; final restored custody warnings were credited. Intermediate warning removal was not mislabeled as final warning loss.

The controlled path exercises real fixture ingestion/chunks/ranking/evidence, answer generation, draft safety, reviewer/second-look ownership, presentation and final custody-warning restoration. A supplied neutral understanding replaces planning. It excludes live documentation, the full index-handler's late redirect/delivery composition and gateway/staff dispatch. No customer or protected input was used. It is not a production or real-Omi-fact check.

Private evidence retains the original manifest, both source snapshots, all stages and the pre-unblinding grades. Manifest SHA256: `3279438a6d1ccac0024ff440fa6039ebe2896da1d11aa9fad7b40fbb8bbcd402`; independent grades SHA256: `358796a2d8bc18bec5812f48eceb6a110ebd55dfb4d2b629bd8ce536ccf88183`. The original candidate archive verifies all 156 manifest file hashes. No generated case text or credentials are published here.

## October28 integration and relative-gate decision

Frozen mapping: no-loss q06-r1-B shares the broader custody-assurance family with main q03-r1-B, not an identical same-scenario guarantee. Unsupported cloud/UI state q06-r2-A shares main q06-r1-A. Completed staff flagging q07-r2-A is absent from all24 old-main finals. Its evidence is byte-identical and undated; no date-order cause is established.

Main #91 (`a461f86`) is now integrated with a merge commit, retaining both source policy and removal-audit propagation. Full1,258/no-model8 pass. Independent review passes240 focused checks: original provenance/db/ranking code matches reviewedb9d7274; #91 safety/routing/handler code matches current main; only source policy import/system text differs in the conflict-resolved reviewer.

Fresh offline injection of the exact frozen unsafe reviewer response through both normal and compact paths confirms old main/frozen#90 accept it while current main/integrated#90 remove/audit the invented flag, invalidate approval and invoke the existing second look. Repeated unsafe reviews stay rejected/escalated. This establishes an inherited acceptance gap now blocked for this observed defect. It does not prove that prompt changes had no influence on stochastic wording; no provenance-specific cause or integrated generated accuracy rate is claimed.

The independent reviewer recommends merge after final-head review and Node20/24/real PostgreSQL CI. Aryan's conditional max96-request run is not activated; no paid run occurred. Keep the frozen21/24 versus19/24 and all original grades unchanged. #83 stays open for the remaining email-only/no-next-step and unsupported applicability problems, addressed offline next with general red-before tests. #65 remains unfinished. #90 release is held after #91 rollout failed source applicability and rollback was requested. Its provenance foundation does not establish customer hardware scope; #83 offline work and required review precede another rollout. Memory remains off.
