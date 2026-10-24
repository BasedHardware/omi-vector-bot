# Localised rejected-review copy — October 24

Production bug B: the handler and evaluation mirror use a fixed English answer when both review attempts reject the draft. The footer can already be localised, creating a mixed-language reply.

`supportReplyCopy.reviewRejectionReply` is the single application-owned copy source for this branch. The real handler uses its existing replyLanguage value, computed after planning rather than after presentation. The evaluation mirror uses the same helper and planner language. The table covers the existing in-thread-copy language family; regional codes normalize to the base language, Hindi keeps the selected script, unknown/prototype keys use the unchanged English answer.

Every translation retains the same meaning: a direct answer could not be verified from official Omi information; do not substitute a different or guessed answer; a person needs to check. No ticket, receipt, accepted ownership, investigation, resolution or response-time promise is introduced. Approved-review and safe-handoff outputs, provider exceptions, review decisions and delivery authority are unchanged. This is not a claim that every other failure/fallback is now localised.

Original synthetic de/fr/es rejected-review tests fail before implementation in both the real handler and evaluation wrapper; unknown-language English behavior already passes. After implementation the same tests and table normalization checks pass without keys, network, provider quota, Discord writes or protected fixtures. Final full/offline/current-CI and independent-review evidence belong in the PR. Offline verification is explicitly accepted for this deterministic copy boundary.

Separate draft/production-cap exception; merge only after review and exact-head CI. Deploy with A only after both merges and current rollback verification. Aryan sends the two short smokes. #71 stays unapproved; general accuracy work C is separate and gets review before any provider run. No optional memory/context/fix-inbox enablement.
