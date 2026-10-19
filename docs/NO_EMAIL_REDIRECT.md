# Keep ordinary support in the thread — draft

Customer problem: an ordinary answer sends someone to email even though the same support thread can take a follow-up.

## Pipeline

Existing routing → official retrieval → answer/review/safety checks → existing escalation decision → ordinary help/test reply cleanup → existing delivery.

- The application replaces a recognized support redirect with one localized invitation to reply in the same thread. It does not claim staff receipt, acceptance or a response deadline.
- Non-redirect answers and source URLs stay unchanged. Independent symptom, prior-attempt and protective clauses survive removal; negative warnings about sending secrets are not redirects.
- A removed redirect with no useful answer triggers a real staff handoff instead of being presented as solved.
- A current owner follow-up reporting that the steps still fail is a deterministic handoff only after an earlier bot reply in this same post. Earlier-post memory cannot trigger it. Hypotheticals, navigation confusion and thanks are excluded by structural failure checks.
- Existing protected-topic decisions and the honest email fallback after failed staff delivery remain intact.

The existing language value and Hindi-script rule select next-step copy; there is no new detector or prompt change. English, Spanish and Chinese redirect examples have focused coverage, including source/safety preservation and unknown-key fallback.

## Verification and limits

- Observed red-before ordinary-answer and redirect-only integration failures; compound-context regression; helper/follow-up and defensive-copy regressions. Focused checks pass after repair.
- The integration proves an ordinary answer without a staff ticket, followed by a still-failing reply that actually delivers a staff card.
- Full suite **850/850**, offline **8/8** and isolated SQL pass before push. Hosted CI is pending publication; none establish answer quality or production enablement.
- No provider comparison or independent approval is claimed. Production was rolled back after the separate combined-release smoke failure. Resolve its baseline/release hold before quality comparison or any new deploy.
- Related #62 stays open: this draft does not repair staff-notification narration erasure or add evaluation-stage evidence. Release-smoke findings #65/#66 stay separate.

This is preparation on main `5bafe93`, not a deployed repair or an enabled-memory feature.
