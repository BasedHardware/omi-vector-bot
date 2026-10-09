# Support state retention and cleanup

Status: proposed operating policy, not an enabled deletion job. Current support workflows retain their scoped records. This document defines prerequisites for cleanup; it does not authorize deleting existing records, replacing encryption keys or replaying held operations.

## Keep operational proof before removing content

Expiry and deletion are different. A seven-day engineering proposal expiry prevents further editing/publication, but its encrypted exact payload may still be required to verify an uncertain GitHub write. A ten-minute OTP expiry prevents use of the code; identity cleanup is already implemented separately. A delivery lease expiry never proves that Discord rejected a send.

Never automatically delete:

- Unknown or expired-dispatching delivery holds and their immutable scope/nonce.
- Filing/unknown engineering proposals or their encrypted reconciliation inputs.
- Accepted receipts whose local projection or private link repair is incomplete.
- Case/customer/generation ownership needed by an active or reopened case.
- An encryption key version while any retained record still depends on it.

## Proposed cleanup boundaries

| Records | Eligibility to consider, not an automatic purge | Proof that must survive |
| --- | --- | --- |
| Accepted/projected delivery details | Case remains closed and at least 30 days have passed since completed projection | A durable logical-action tombstone blocks recreating the operation; late feedback fails closed if detailed proof is no longer available. |
| Definitely rejected delivery details | Retry window ended and no send/receipt/projection is uncertain | Logical-action tombstone and rejection category; no silent reset that permits another POST. |
| Expired pending/rejected engineering drafts | No in-flight/unknown write and no unresolved link/receipt dependency | Immutable case/source/repository/target and publication-blocking tombstone. |
| Confirmed engineering payloads | Publication and all private link repairs are complete | Metadata-only receipt access must work without decrypting the removed payload; immutable scope, revision/hash and external receipt remain. |
| Closed case summaries, when implemented | Customer-visible policy and deletion/reopening behavior have been reviewed | Minimum scoped authority and action tombstones, not transcript/audio content. |

The 30-day window is a proposed product setting for completed operational detail, not a legal retention assertion or a commitment currently enforced by the bot. Owners must review the window before a cleanup job is enabled. Uncertain work has no automatic age-based purge in this proposal: investigate and explicitly retire it first.

## Implementation order

1. Add metadata-only engineering receipt APIs; current receipt checks still decode encrypted drafts.
2. Design versioned action tombstones and a key migration that cannot forget deduplication or ownership when a key changes.
3. Add a read-only eligibility report with dependency checks. Report categories/counts, never message bodies, keys or private identifiers.
4. Validate eligibility against closed, reopened, unknown, accepted-unprojected and partially repaired fixtures.
5. Obtain the retention setting and release review, then enable bounded cleanup batches with auditable outcome counts.

Never treat cleanup as a reset/retry mechanism. Do not retain new conversation content merely because a future cumulative-summary feature is planned. The current delivery ledger stores metadata only, and this closure milestone introduces no stored message bodies or deletion of historical customer data.
