# Keep ordinary support in the thread — draft

Customer problem: an ordinary answer sends someone to email even though the same support thread can take a follow-up.

## Pipeline

Existing routing → official retrieval → answer/review/safety checks → existing escalation decision → ordinary help/test reply cleanup → existing delivery.

- The application replaces a recognized support redirect with one localized invitation to reply in the same thread. It does not claim staff receipt, acceptance or a response deadline.
- Non-redirect answers and source URLs stay unchanged. Independent symptom, prior-attempt and protective clauses survive removal; negative warnings about sending secrets are not redirects.
- A removed redirect with no useful answer triggers a real staff handoff instead of being presented as solved.
- A current owner follow-up reporting that the steps still fail is a deterministic handoff only after an earlier bot reply in this same post. Earlier-post memory cannot trigger it. Hypotheticals, navigation confusion and thanks are excluded by structural failure checks.
- Existing protected-topic decisions and the honest email fallback after failed staff delivery remain intact.

The existing language value and Hindi-script rule select next-step copy; there is no new detector or prompt change. A non-Source clause containing `help@omi.me` or `team@basedhardware.com` identifies an alternate contact route independently of language, except the existing negative secret-sharing warning exemption. Existing English address-less patterns remain. Address-less non-English redirects are outside this repair; twelve-language next-step copy does not imply those redirects are detected.

Cleanup and ordinary-answer emptiness share `supportSteps` source-label names/separators, including localized/plural headings and full-width colons. A source-only result after redirect removal still takes the real handoff path. Source URLs, warnings and independent clauses survive. Retained intake details cannot reintroduce the address. Application-owned failed-delivery copy is appended after cleanup and remains available.

## Verification and limits

- Observed red-before ordinary-answer and redirect-only integration failures; compound-context regression; helper/follow-up and defensive-copy regressions. Focused checks pass after repair.
- The integration proves an ordinary answer without a staff ticket, followed by a still-failing reply that actually delivers a staff card.
- Released main `6b6d97d` integrated through merge commit `dc79d80`; only document conflicts needed resolution. Current full **943/943**, offline **8/8** and isolated SQL pass. Exact-head hosted CI is recorded in the PR, separately from local evidence.
- Twenty-five new original synthetic regressions cover fr/de/ja/pt ordinary and delivered helpers/actual handlers; Source/warning/failure fallback preservation; intake-tail safety; localized/plural Source headings and source-only emptiness. Final tests against pre-repair `dc79d80` utilities give160 pass/25 fail; repaired helper/handler tests pass185/185. Existing actual failed-staff-delivery handler checks also pass. No live Discord/provider boundary or enabled memory is claimed.
- The frozen comparison used main `5bafe93f305725db1afc4b2f3e84bb3acc0e0dd2` and candidate `f2781ebaad8bbcb14c57db8f5cd390ae59a43d1d`, whose parent is that exact main. Harness/judge/lockfile matched; both arms completed162 rows. This is not a rerun of the new repair.
- Independent grading passes protected handoffs and accepts the measured p50 increase30.255→32.455s (+2.200, an explicit0.200s exception). It does not rewrite the measurement or claim the generated own-key web-app miss fixed. Independent final repair review passes185 focused checks after the source-label finding was reproduced and fixed. Current deterministic cleanup adds no prompt/provider call.
- Related #62 stays open: this draft does not repair staff-notification narration erasure or add evaluation-stage evidence. Release-smoke findings #65/#66 stay separate.

The current reliability release is deployed; Aryan deferred its new smoke inputs. This draft may be pushed for CI, but no merge/deploy while those smokes remain pending. #77 stays draft until this PR merges, then drops overlapping redirect work; #78 waits for drain-smoke review. No memory enablement or new PR.
