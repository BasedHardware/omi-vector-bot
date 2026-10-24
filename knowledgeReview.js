const { createHash, randomUUID } = require('node:crypto');
const { redactSensitive } = require('./privacy');
const { looksLikeStaffLie } = require('./honesty');

const DAY = 86_400_000;
const MAX_VERSIONS = 100;
const clone = value => structuredClone(value);
const id = value => typeof value === 'string' && /^[a-z0-9_-]{1,128}$/i.test(value);
const normalizeText = text => String(text || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const hashContent = text => createHash('sha256').update(normalizeText(text)).digest('hex');

function officialSource(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search) return '';
    const allowed = ['help.omi.me', 'docs.omi.me', 'omi.me', 'www.omi.me'].includes(url.hostname) ||
      (url.hostname === 'github.com' && /^\/BasedHardware\/omi\/(?:blob\/|releases\/tag\/)/i.test(url.pathname));
    return allowed ? url.href : '';
  } catch { return ''; }
}

function publicText(value, limit) {
  return typeof value === 'string' && Boolean(value.trim()) && value.length <= limit &&
    redactSensitive(value, { issue: true }) === value && !looksLikeStaffLie(value);
}

function normalizeDraft(input, now) {
  const allowed = new Set(['guildId', 'factId', 'expectedVersion', 'content', 'sources', 'productVersion', 'regressionQuestion', 'provenance']);
  if (!input || Object.keys(input).some(key => !allowed.has(key)) || !id(input.guildId) || !id(input.factId) ||
      !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion >= MAX_VERSIONS ||
      !publicText(input.content, 500) || !publicText(input.productVersion, 160) || !publicText(input.regressionQuestion, 300) ||
      !Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > 4 ||
      !Array.isArray(input.provenance) || input.provenance.length > 20) return null;
  const sources = input.sources.map(officialSource);
  if (sources.some(url => !url)) return null;
  if (input.provenance.some(row => !row || Object.keys(row).some(key => !['caseId', 'expiresAt'].includes(key)) ||
      !id(row.caseId) || !Number.isSafeInteger(row.expiresAt) || row.expiresAt <= now || row.expiresAt > now + 30 * DAY)) return null;
  return { content: input.content.trim(), sources: [...new Set(sources)], productVersion: input.productVersion.trim(),
    regressionQuestion: input.regressionQuestion.trim(), provenance: clone(input.provenance) };
}

function candidateDigest(scope, row) {
  return createHash('sha256').update(JSON.stringify([scope.guildId, scope.factId, row.version,
    row.content, row.sources, row.productVersion, row.regressionQuestion])).digest('hex');
}

function normalizedValidation(proof, row, now) {
  if (!proof || proof.ok !== true || proof.digest !== row.digest || proof.reviewApproved !== true ||
      proof.regression?.passed !== true || proof.regression.questionHash !== hashContent(row.regressionQuestion) ||
      !Array.isArray(proof.evidence) || !Array.isArray(row.sources) || proof.evidence.length !== row.sources.length) return null;
  const evidence = [];
  for (const url of row.sources) {
    const item = proof.evidence.find(value => value?.url === url);
    if (!item || !/^[a-f0-9]{64}$/.test(item.sha256 || '') || !Number.isSafeInteger(item.checkedAt) ||
        item.checkedAt < row.approvedAt || item.checkedAt > now) return null;
    evidence.push({ url, sha256: item.sha256, checkedAt: item.checkedAt });
  }
  // Persist a fixed metadata projection, never provider prose, prompts or raw
  // validator diagnostics. The configured worker is responsible for performing
  // these checks, not merely filling in these fields.
  return { ok: true, digest: row.digest, reviewApproved: true, evidence,
    regression: { passed: true, questionHash: proof.regression.questionHash } };
}

function createReviewService({ store, allowedStaffIds = () => [], enabled = () => false, now = Date.now, validate, validationBudgetMs = 30_000 } = {}) {
  if (!store) throw Error('A reviewed knowledge store is required');
  const isEnabled = () => typeof enabled === 'function' ? enabled() === true : enabled === true;
  const authorized = actor => id(actor) && (typeof allowedStaffIds === 'function' ? allowedStaffIds() : allowedStaffIds).map(String).includes(actor);
  const validAction = input => id(input?.guildId) && id(input?.factId) && Number.isInteger(input.version) && input.version > 0;
  const failed = reason => ({ ok: false, reason });
  const safe = async operation => {
    try { return await operation(); }
    catch { console.error('[KnowledgeReview] state unavailable'); return failed('unavailable'); }
  };
  const action = (input, actor, mutate) => safe(async () => {
    if (!authorized(actor)) return failed('unauthorized');
    if (!validAction(input)) return failed('invalid');
    return store.mutate(input, state => {
      if (!authorized(actor)) return { result: failed('unauthorized') };
      if (!state || state.latestVersion !== input.version) return { result: failed('stale') };
      return mutate(state, state.versions[input.version - 1]);
    });
  });
  return {
    async propose(input, actor) {
      return safe(async () => {
        if (!isEnabled()) return failed('disabled');
        if (!authorized(actor)) return failed('unauthorized');
        const normalized = normalizeDraft(input, now());
        if (!normalized) return failed('invalid');
        return store.mutate(input, existing => {
          if (!isEnabled()) return { result: failed('disabled') };
          if (!authorized(actor)) return { result: failed('unauthorized') };
          const state = existing || { latestVersion: 0, publishedVersion: null, versions: [] };
          if (state.latestVersion !== input.expectedVersion) return { result: failed('stale') };
          for (const row of state.versions) if (['draft', 'validating', 'validation_failed'].includes(row.status)) {
            row.status = 'superseded'; row.validationToken = null;
          }
          const row = { ...normalized, version: ++state.latestVersion, status: 'draft', createdBy: actor, createdAt: now(),
            contentHash: hashContent(normalized.content), contentMatch: normalizeText(normalized.content), approvedBy: null, approvedAt: null, recheckAt: null,
            validationToken: null, validationUntil: null, managed: false };
          row.digest = candidateDigest(input, row);
          state.versions.push(row); state.updatedAt = now();
          return { state, result: { ok: true, factId: input.factId, version: row.version } };
        }, { create: true });
      });
    },
    async approve(input, actor) {
      if (!isEnabled()) return failed('disabled');
      if (!authorized(actor)) return failed('unauthorized');
      if (typeof validate !== 'function') return failed('validation_unavailable');
      const claim = await action(input, actor, (state, row) => {
        if (!isEnabled()) return { result: failed('disabled') };
        if (!['draft', 'validation_failed', 'validating'].includes(row.status)) return { result: failed('not_pending') };
        if (row.status === 'validating' && row.validationUntil > now()) return { result: failed('busy') };
        row.status = 'validating'; row.approvedBy = actor; row.approvedAt = now();
        row.validationToken = randomUUID(); row.validationUntil = now() + validationBudgetMs;
        state.updatedAt = now();
        return { state, result: { ok: true, candidate: clone(row) } };
      });
      if (!claim.ok) return claim;
      let proof, timer;
      try {
        // The validator is application configuration, never a request field.
        // It must check official evidence and the synthetic regression before
        // binding its result to this exact immutable candidate digest.
        proof = await Promise.race([Promise.resolve().then(() => validate(clone(claim.candidate))),
          new Promise((_, reject) => { timer = setTimeout(() => reject(Error('validation deadline')), validationBudgetMs); })]);
      } catch { proof = null; }
      finally { clearTimeout(timer); }
      return action(input, actor, (state, row) => {
        if (row.status !== 'validating' || row.validationToken !== claim.candidate.validationToken ||
            row.digest !== claim.candidate.digest || candidateDigest(input, row) !== row.digest) return { result: failed('stale') };
        const validation = normalizedValidation(proof, row, now());
        const passed = isEnabled() && validation && row.validationUntil >= now();
        row.validationToken = null; row.validationUntil = null; state.updatedAt = now();
        if (!passed) {
          row.status = 'validation_failed'; return { state, result: failed('validation_failed') };
        }
        if (state.publishedVersion) state.versions[state.publishedVersion - 1].status = 'superseded';
        row.status = 'published'; row.managed = true; row.validation = validation;
        row.publishedAt = now(); row.recheckAt = row.approvedAt + 90 * DAY;
        state.publishedVersion = row.version;
        return { state, result: { ok: true, factId: input.factId, version: row.version } };
      });
    },
    revoke(input, actor) {
      // Safety actions keep working after the feature is disabled.
      return action(input, actor, state => {
        for (const row of state.versions) {
          row.status = 'revoked'; row.managed = true; row.validationToken = null; row.validationUntil = null;
          row.revokedBy = actor; row.revokedAt = now();
        }
        state.publishedVersion = null; state.updatedAt = now();
        return { state, result: { ok: true } };
      });
    },
    reject(input, actor) {
      return action(input, actor, (state, row) => {
        if (!['draft', 'validating', 'validation_failed'].includes(row.status)) return { result: failed('not_pending') };
        row.status = 'rejected'; row.validationToken = null; row.validationUntil = null;
        row.rejectedBy = actor; row.rejectedAt = now(); state.updatedAt = now();
        return { state, result: { ok: true } };
      });
    },
    async search(guild, query, limit = 5) {
      if (!isEnabled() || !id(guild)) return [];
      return store.search(guild, query, now(), Math.max(1, Math.min(5, limit)));
    },
    async inspect(scope, actor) {
      if (!authorized(actor) || !id(scope?.guildId) || !id(scope?.factId)) return null;
      const state = await store.read(scope);
      if (state) for (const row of state.versions) row.provenance = row.provenance.filter(item => item.expiresAt > now());
      return state;
    },
    // Application privacy adapter only: its caller must first verify ownership
    // of these cases. Never expose this helper as a customer-supplied ID tool.
    async eraseProvenance(guild, caseIds) {
      if (!id(guild) || !Array.isArray(caseIds) || caseIds.length > 1000 || caseIds.some(value => !id(value))) return failed('invalid');
      return safe(async () => {
        await store.eraseProvenance(guild, now(), [...new Set(caseIds)]);
        let batch, processed = 0;
        do { batch = await store.cleanProvenance(guild, now(), caseIds); processed += batch.processed; } while (batch.remaining);
        return { ok: true, processed };
      });
    },
    pruneProvenance: guild => id(guild) ? store.cleanProvenance(guild, now(), []) : Promise.resolve({ processed: 0, remaining: false }),
  };
}

module.exports = { createReviewService, hashContent, normalizeText, officialSource, candidateDigest, normalizedValidation, MAX_VERSIONS };
