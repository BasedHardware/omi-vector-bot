// Shared answer/reviewer policy. Authority is not page completeness; general
// documentation is not an observation of a customer's private data.
const EVIDENCE_CLAIM_CONTRACT = [
  'Evidence scope: selected page text is an excerpt unless application evidence establishes full coverage. Authority does not establish completeness.',
  'Never conclude that a page, source or the documentation omits a fact, or that a feature is unsupported or does not exist, from absence from the provided excerpts. A missing detail means you could not confirm it; state that uncertainty and take the person path. An explicit negative statement in supplied official evidence may support a negative claim; omission from an excerpt may not.',
  'Never assert that a specific customer’s data exists, is safe, is intact, or is recoverable based on general documentation. General storage or retention instructions do not verify that customer’s data or an outcome. Preserve material uncertainty and ask a person to check rather than reassuring without evidence.',
  'Each cited source must contain the claim or step it supports. A correct claim cited to a different page is not grounded.',
].join(' ');

const CLAIM_REVIEW_CONTRACT = 'For your final reply after any rewrite, include claim_checks with exactly these boolean checks: unsupported_absence (true if a negative source/feature claim is inferred from missing excerpt content), unsupported_customer_data (true if customer-specific data existence, safety, integrity or recoverability is inferred from general docs), citations_supported (true only if every citation supports its associated claims; true if there are no citations). Rewrite/remove violations when possible, otherwise set grounded=false and escalate=true. For unconfirmed facts keep uncertainty and escalate=true. Missing checks cannot approve a reply.';

function evaluateClaimChecks(value) {
  const complete = Boolean(value && typeof value === 'object' &&
    typeof value.unsupported_absence === 'boolean' &&
    typeof value.unsupported_customer_data === 'boolean' &&
    typeof value.citations_supported === 'boolean');
  const checks = {
    complete,
    unsupportedAbsence: value?.unsupported_absence === true,
    unsupportedCustomerData: value?.unsupported_customer_data === true,
    citationsSupported: value?.citations_supported === true,
  };
  return {...checks,passed:complete&&!checks.unsupportedAbsence&&!checks.unsupportedCustomerData&&checks.citationsSupported};
}

module.exports = {EVIDENCE_CLAIM_CONTRACT,CLAIM_REVIEW_CONTRACT,evaluateClaimChecks};
