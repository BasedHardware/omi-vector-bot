const test = require('node:test');
const assert = require('node:assert/strict');
const { createCipheriv, createHmac } = require('node:crypto');
const approvals = require('../supportApprovals');
const github = require('../github');

const KEY = Buffer.alloc(32, 19);
const SCOPE = { caseId: 'case-1', customerId: 'customer-1', sourceMessageId: 'source-1', channelId: 'staff-room', threadId: 'customer-thread', botUserId: 'bot-1', repo: 'BasedHardware/omi', kind: 'issue', targetIssueNumber: null };
const CARD = { ...SCOPE, cardMessageId: 'card-1', cardAuthorId: SCOPE.botUserId, staffId: 'staff-1', authorized: true };
const PROPOSAL = { title: 'App fails to open', body: 'The Android app fails to open. Staff technical summary.', labels: ['vector','app'], files: { size: 2 } };
const COLUMNS = ['case_id','customer_id','source_message_id','channel_id','thread_id','bot_user_id','repository','kind','target_issue_number'];

function fakeSql() {
  const state = new Map(); const calls = [];
  const result = (value) => ({ rows: value ? [structuredClone(value)] : [], rowCount: value ? 1 : 0 });
  const client = { state, calls, failure: false, async query(sql, args = []) {
    const text = sql.replace(/\s+/g, ' ').trim(); calls.push({ text, args });
    if (client.failure) throw new Error('approval database unavailable');
    if (text.startsWith('CREATE TABLE')) return result();
    if (text.startsWith('INSERT INTO support_issue_approvals')) {
      assert.match(text, /ON CONFLICT \(\(LOWER\(repository\)\)/);
      const existing = [...state.values()].find((row) =>
        [7, 1, 8, 3, 9].every((index) => index === 7
          ? row.repository.toLowerCase() === String(args[index]).toLowerCase()
          : row[COLUMNS[index - 1]] === args[index]));
      if (existing) return result(existing);
      const row = { id: args[0], ...Object.fromEntries(COLUMNS.map((column, i) => [column, args[i + 1]])),
        public_draft: {}, payload_ciphertext: args[10], payload_iv: args[11], payload_tag: args[12], payload_hash: args[13], payload_revision: 1,
        created_at: args[14], expires_at: args[15], writer_app_id: args[16], status: 'pending', card_message_id: null, preview_message_id: null, preview_staff_id: null,
        edit_token_hash: null, edit_actor: null, edit_expires_at: null, edit_revision: null, edited_by: null,
        lease_token: null, lease_expires_at: null, approved_by: null, approved_at: null, outcome_code: null,
        external_issue_number: null, external_comment_id: null, external_issue_url: null };
      state.set(row.id, row); return result(row);
    }
    const row = state.get(args[0]);
    if (text.startsWith('SELECT *')) return result(row);
    if (text.includes("SET status = 'unknown'")) {
      if (row?.status === 'filing' && new Date(row.lease_expires_at) <= args[1]) Object.assign(row, { status: 'unknown', outcome_code: 'lease_expired' });
      return result();
    }
    if (text.includes('SET status = $3')) {
      if (!row || row.lease_token !== args[1] || !args[6].includes(row.status)) return result();
      Object.assign(row, { status: args[2], outcome_code: args[3], external_issue_number: args[4] == null ? null : String(args[4]), external_issue_url: args[5], external_comment_id: args[7] == null ? null : String(args[7]) }); return result(row);
    }
    assert.match(text, /status IN \('pending','rejected'\)/);
    assert.match(text, /LOWER\(repository\) IS NOT DISTINCT FROM LOWER\(\$8::text\)/);
    if (!row || !COLUMNS.every((column, i) => column === 'repository'
      ? row[column].toLowerCase() === String(args[i + 1]).toLowerCase()
      : row[column] === args[i + 1]) || !['pending','rejected'].includes(row.status) || new Date(row.expires_at) <= args[10]) return result();
    if (text.includes('SET card_message_id')) {
      if (row.card_message_id && row.card_message_id !== args[11]) return result();
      row.card_message_id = args[11];
    } else if (text.includes('SET edit_token_hash')) {
      if (row.card_message_id !== args[14]) return result();
      Object.assign(row, { edit_token_hash: args[11], edit_actor: args[12], edit_expires_at: args[13], edit_revision: row.payload_revision });
    } else if (text.includes('SET payload_ciphertext')) {
      if (row.edit_actor !== args[15] || row.edit_token_hash !== args[16] || new Date(row.edit_expires_at) <= args[10] || row.edit_revision !== row.payload_revision || row.payload_revision !== args[17]) return result();
      Object.assign(row, { payload_ciphertext: args[11], payload_iv: args[12], payload_tag: args[13], payload_hash: args[14], payload_revision: row.payload_revision + 1,
        edited_by: args[15], edit_token_hash: null, edit_actor: null, edit_expires_at: null, edit_revision: null, preview_message_id: null, preview_staff_id: null });
    } else if (text.includes('SET preview_message_id')) {
      if (row.edited_by !== args[12] || row.payload_revision !== args[13] || row.payload_hash !== args[14] || (row.preview_message_id && row.preview_message_id !== args[11])) return result();
      Object.assign(row, { preview_message_id: args[11], preview_staff_id: args[12] });
    } else if (text.includes("SET status = 'filing'")) {
      if (row.preview_staff_id !== args[13] || row.preview_message_id !== args[14] || row.payload_revision !== args[15] || row.payload_hash !== args[16]) return result();
      Object.assign(row, { status: 'filing', lease_token: args[11], lease_expires_at: args[12], approved_by: args[13], approved_at: args[10], outcome_code: null });
    } else throw new Error(`Unexpected approval SQL: ${text}`);
    return result(row);
  } };
  return client;
}

async function prepared(service, input = SCOPE) {
  const value = await service.createDraft({ files: { size: 2 } }, input);
  const origin = { ...CARD, ...input };
  await service.bindCard(value.id, origin);
  const editor = await service.beginEdit(value.id, origin);
  const edited = await service.updateDraft(value.id, { editToken: editor.editToken, staffId: origin.staffId, scope: input, draft: PROPOSAL });
  const proof = { ...origin, previewMessageId: 'preview-1', revision: edited.revision, payloadHash: edited.payloadHash };
  await service.bindPreview(value.id, proof);
  return { value: edited, proof };
}

for (const mode of ['memory','postgres']) {
  function services(options = {}) {
    const backing = mode === 'memory' ? approvals.createMemoryStore() : fakeSql();
    const store = () => mode === 'memory' ? approvals.createMemoryStore(backing.state) : approvals.createPostgresStore(backing);
    return { backing, first: approvals.createApprovalService(store(), { key: KEY, ...options }), restarted: approvals.createApprovalService(store(), { key: KEY, ...options }) };
  }
  test(`${mode}: encrypted draft, source card and exact preview survive service recreation`, async () => {
    const { first, restarted } = services(); const { value, proof } = await prepared(first);
    const recovered = await restarted.getDraft(value.id);
    assert.equal(recovered.draft.body, PROPOSAL.body); assert.equal(recovered.cardMessageId, CARD.cardMessageId);
    assert.equal(recovered.previewMessageId, proof.previewMessageId);
    assert.equal((await restarted.claimDraft(value.id, proof)).ok, true);
  });
  test(`${mode}: simultaneous confirmations acquire one lease`, async () => {
    const { first, restarted } = services(); const { value, proof } = await prepared(first);
    const claims = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? first : restarted).claimDraft(value.id, proof)));
    assert.equal(claims.filter((claim) => claim.ok).length, 1);
    assert.ok(claims.filter((claim) => !claim.ok).every((claim) => claim.status === 'filing'));
  });
  test(`${mode}: duplicate source events reuse one immutable action while fresh source and comment targets stay separate`, async () => {
    const { first, restarted } = services();
    const { value, proof } = await prepared(first);
    const copies = await Promise.all(Array.from({ length: 6 }, () => restarted.createDraft({ title: 'Replacement', body: 'Do not replace reviewed payload' }, SCOPE)));
    assert.ok(copies.every((copy) => copy.id === value.id && copy.draft.body === PROPOSAL.body && copy.payloadHash === proof.payloadHash));
    const next = await first.createDraft(PROPOSAL, { ...SCOPE, sourceMessageId: 'fresh-source' });
    assert.notEqual(next.id, value.id);
    const one = await first.createDraft(PROPOSAL, { ...SCOPE, kind: 'comment', targetIssueNumber: 41 });
    const two = await first.createDraft(PROPOSAL, { ...SCOPE, kind: 'comment', targetIssueNumber: 42 });
    assert.notEqual(one.id, two.id);
  });
  test(`${mode}: repository case variants reuse one original action and compete for one dispatch`, async () => {
    const { first, restarted, backing } = services();
    const { value, proof } = await prepared(first, { ...SCOPE, repo: 'BasedHardware/OMI' });
    assert.equal(value.repo, 'basedhardware/omi');
    const copies = await Promise.all(['basedhardware/omi', 'BASEDHARDWARE/omi', 'BasedHardware/OMI'].map((repo) =>
      restarted.createDraft({ title: 'Do not replace', body: 'The original approved summary must survive.' }, { ...SCOPE, repo })));
    assert.ok(copies.every((copy) => copy.id === value.id && copy.payloadHash === value.payloadHash && copy.draft.body === PROPOSAL.body));
    assert.equal(mode === 'memory' ? backing.state.approvals.size : backing.state.size, 1);
    const claims = await Promise.all(['basedhardware/omi', 'BASEDHARDWARE/OMI'].map((repo) =>
      restarted.claimDraft(value.id, { ...proof, repo })));
    assert.equal(claims.filter((claim) => claim.ok).length, 1);
    assert.equal(claims.find((claim) => claim.ok).approval.id, value.id);
  });
  test(`${mode}: canonical proofs authenticate original-case historical ciphertext without rewriting AAD`, async () => {
    const { first, restarted, backing } = services();
    const { value, proof } = await prepared(first);
    // Reproduce an encrypted record written before repository normalization.
    const old = { ...value, repo: 'BasedHardware/omi' };
    const aad = Buffer.from(JSON.stringify([old.id, ...Object.values({
      caseId: old.caseId, customerId: old.customerId, sourceMessageId: old.sourceMessageId,
      channelId: old.channelId, threadId: old.threadId, botUserId: old.botUserId,
      repo: old.repo, kind: old.kind, targetIssueNumber: old.targetIssueNumber,
    }), old.revision]));
    const plaintext = JSON.stringify(old.draft);
    const iv = Buffer.alloc(12, 7);
    const cipher = createCipheriv('aes-256-gcm', KEY, iv); cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('base64');
    const tag = cipher.getAuthTag().toString('base64');
    const hash = createHmac('sha256', KEY).update(aad).update(plaintext).digest('hex');
    const stored = mode === 'memory' ? backing.state.approvals.get(value.id) : backing.state.get(value.id);
    Object.assign(stored, mode === 'memory'
      ? { repo: old.repo, ciphertext, iv: iv.toString('base64'), tag, payloadHash: hash }
      : { repository: old.repo, payload_ciphertext: ciphertext, payload_iv: iv.toString('base64'), payload_tag: tag, payload_hash: hash });
    const recovered = await restarted.getDraft(value.id);
    assert.equal(recovered.repo, old.repo);
    assert.deepEqual(recovered.draft, old.draft);
    const reused = await restarted.createDraft({ body: 'Do not replace this historical payload' }, { ...SCOPE, repo: 'basedhardware/omi' });
    assert.equal(reused.id, value.id);
    assert.equal(reused.ciphertext, ciphertext);
    assert.equal(reused.payloadHash, hash);
    const dispatched = await restarted.claimDraft(value.id, { ...proof, repo: 'basedhardware/omi', payloadHash: hash });
    assert.equal(dispatched.ok, true);
    assert.equal(dispatched.approval.repo, old.repo);
    assert.equal(dispatched.approval.ciphertext, ciphertext);
    assert.equal(dispatched.approval.iv, iv.toString('base64'));
    assert.equal(dispatched.approval.tag, tag);
  });
  test(`${mode}: saved publication app identity is immutable across later configuration and receipt URLs normalize repository case`, async () => {
    const { first, restarted } = services();
    const original = await first.createDraft(PROPOSAL, { ...SCOPE, writerAppId: '123' });
    const reused = await restarted.createDraft(PROPOSAL, { ...SCOPE, writerAppId: '999' });
    assert.equal(reused.id, original.id); assert.equal(reused.writerAppId, '123');
    const { value, proof } = await prepared(first);
    assert.equal(value.writerAppId, '123');
    const attempt = await first.claimDraft(value.id, proof);
    const done = await first.recordFiled(value.id, { leaseToken: attempt.leaseToken, number: 44, url: 'https://GITHUB.com/basedhardware/OMI/issues/44/' });
    assert.equal(done.externalIssueUrl, 'https://github.com/basedhardware/omi/issues/44');
    assert.equal(done.status, 'filed');
  });
  test(`${mode}: forged actor, card, scope, target and preview cannot confirm`, async () => {
    const { first } = services(); const { value, proof } = await prepared(first);
    for (const changes of [{ authorized: false }, { staffId: 'other-staff' }, { cardAuthorId: 'customer' }, { customerId: 'other-customer' },
      { sourceMessageId: 'other-source' }, { caseId: 'other-case' }, { channelId: 'other-channel' }, { threadId: 'other-thread' },
      { repo: 'other/repo' }, { previewMessageId: 'forged-preview' }, { revision: proof.revision - 1 }, { payloadHash: 'wrong-hash' }]) {
      assert.equal((await first.claimDraft(value.id, { ...proof, ...changes })).status, 'forbidden');
    }
    assert.equal((await first.getDraft(value.id)).status, 'pending');
    assert.equal(await first.bindCard(value.id, { ...CARD, cardMessageId: 'replacement' }), null);
  });
  test(`${mode}: staff editor tokens expire, are single use, and reset only preview on revision changes`, async () => {
    let now = 1000; const { first, restarted } = services({ now: () => now, editTtlMs: 1000 });
    const { value, proof } = await prepared(first);
    const stale = await first.beginEdit(value.id, CARD);
    const current = await restarted.beginEdit(value.id, CARD);
    assert.equal(await first.updateDraft(value.id, { editToken: stale.editToken, staffId: CARD.staffId, scope: SCOPE, draft: PROPOSAL }), null);
    const edited = await first.updateDraft(value.id, { editToken: current.editToken, staffId: CARD.staffId, scope: SCOPE, draft: { body: 'A newly reviewed technical summary.', title: PROPOSAL.title } });
    assert.equal(edited.cardMessageId, CARD.cardMessageId); assert.equal(edited.previewMessageId, null); assert.equal(edited.revision, proof.revision + 1);
    assert.deepEqual(edited.draft.files, { size: 2 });
    assert.equal((await first.claimDraft(value.id, proof)).status, 'forbidden');
    assert.equal(await first.updateDraft(value.id, { editToken: current.editToken, staffId: CARD.staffId, scope: SCOPE, draft: PROPOSAL }), null);
    const expired = await first.beginEdit(value.id, CARD); now += 1000;
    assert.equal(await first.updateDraft(value.id, { editToken: expired.editToken, staffId: CARD.staffId, scope: SCOPE, draft: PROPOSAL }), null);
  });
  test(`${mode}: known rejection permits explicit retry; stale lease cannot complete another attempt`, async () => {
    const { first, restarted } = services(); const { value, proof } = await prepared(first);
    const one = await first.claimDraft(value.id, proof);
    assert.equal((await first.recordRejected(value.id, { leaseToken: one.leaseToken, code: 'http_rejected' })).status, 'rejected');
    const two = await restarted.claimDraft(value.id, proof); assert.equal(two.ok, true);
    assert.equal(await first.recordFiled(value.id, { leaseToken: one.leaseToken, number: 33, url: 'https://github.com/BasedHardware/omi/issues/33' }), null);
    const filed = await first.recordFiled(value.id, { leaseToken: two.leaseToken, number: 33, url: 'https://github.com/BasedHardware/omi/issues/33' });
    assert.equal(filed.externalIssueNumber, 33); assert.equal((await first.claimDraft(value.id, proof)).status, 'filed');
  });
  test(`${mode}: unknown/expired filing never retries; completion requires reconciliation`, async () => {
    let now = 1000; const { first, restarted } = services({ now: () => now, leaseMs: 1000 });
    const { value, proof } = await prepared(first); const attempt = await first.claimDraft(value.id, proof); now += 1000;
    assert.equal((await restarted.claimDraft(value.id, proof)).status, 'unknown');
    assert.equal(await first.recordRejected(value.id, { leaseToken: attempt.leaseToken, code: 'http_rejected' }), null);
    const receipt = { leaseToken: attempt.leaseToken, number: 35, url: 'https://github.com/BasedHardware/omi/issues/35' };
    await assert.rejects(first.recordFiled(value.id, receipt), /reconciliation/);
    assert.equal((await first.recordFiled(value.id, { ...receipt, reconciled: true })).status, 'filed');
  });
  test(`${mode}: comments bind one engineering issue and persist its accepted comment receipt`, async () => {
    const { first } = services(); const input = { ...SCOPE, kind: 'comment', targetIssueNumber: 41 };
    const { value, proof } = await prepared(first, input);
    assert.equal((await first.claimDraft(value.id, { ...proof, targetIssueNumber: 42 })).status, 'forbidden');
    const attempt = await first.claimDraft(value.id, proof);
    await assert.rejects(first.recordCommented(value.id, { leaseToken: attempt.leaseToken, commentId: 99, url: 'https://github.com/BasedHardware/omi/issues/42#issuecomment-99' }), /approved repository/);
    const done = await first.recordCommented(value.id, { leaseToken: attempt.leaseToken, commentId: 99, url: 'https://github.com/BasedHardware/omi/issues/41#issuecomment-99' });
    assert.equal(done.externalIssueNumber, 41); assert.equal(done.externalCommentId, 99);
  });
}
test('durable storage contains ciphertext, safe attachment counts and provenance, never draft plaintext/customer quotes/editor tokens', async () => {
  const sql = fakeSql(); const service = approvals.createApprovalService(approvals.createPostgresStore(sql), { key: KEY });
  const record = await service.createDraft({ files: [{ name: 'private-meeting.wav', url: 'https://private.example/audio?token=PRIVATE_TOKEN' }], quote: 'RAW_CUSTOMER_QUOTE' }, SCOPE);
  await service.bindCard(record.id, CARD); const editor = await service.beginEdit(record.id, CARD);
  const updated = await service.updateDraft(record.id, { editToken: editor.editToken, staffId: CARD.staffId, scope: SCOPE, draft: {
    title: 'A minimized technical report', body: 'TECHNICAL_SUMMARY_NOT_PLAINTEXT owner@example.com Order #12345 https://discord.com/channels/1/2/3 verification code 654321 ghs_abcdefgh123456789',
    quote: 'RAW_CUSTOMER_QUOTE', arbitrary: { secrets: 'UNEXPECTED_FIELD' }, files: { size: 1 } } });
  assert.doesNotMatch(updated.draft.body, /owner@example.com|12345|discord.com|654321|ghs_abcdefgh/);
  assert.deepEqual(updated.draft.files, { size: 1 }); assert.equal(updated.draft.quote, undefined);
  const persisted = JSON.stringify(sql.calls);
  for (const forbidden of ['TECHNICAL_SUMMARY_NOT_PLAINTEXT','owner@example.com','RAW_CUSTOMER_QUOTE','private-meeting.wav','PRIVATE_TOKEN','UNEXPECTED_FIELD',editor.editToken]) assert.equal(persisted.includes(forbidden), false, forbidden);
  assert.deepEqual(sql.state.get(record.id).public_draft, {});
});
test('payload encryption is bound to its immutable customer/case/target and revision', async () => {
  const store = approvals.createMemoryStore(); const service = approvals.createApprovalService(store, { key: KEY });
  const { value } = await prepared(service);
  store.state.approvals.get(value.id).customerId = 'another-customer';
  await assert.rejects(service.getDraft(value.id));
});
test('database failures never downgrade approvals to memory', async () => {
  const sql = fakeSql(); sql.failure = true;
  const service = approvals.createApprovalService(approvals.createPostgresStore(sql), { key: KEY });
  await assert.rejects(service.createDraft(PROPOSAL, SCOPE), /approval database unavailable/);
  await assert.rejects(service.getDraft('id'), /approval database unavailable/);
  assert.equal(sql.state.size, 0);
});
test('missing encryption key disables optional approval creation without reading storage', async (t) => {
  const previous = process.env.DATA_ENCRYPTION_KEY; delete process.env.DATA_ENCRYPTION_KEY;
  t.after(() => { if (previous === undefined) delete process.env.DATA_ENCRYPTION_KEY; else process.env.DATA_ENCRYPTION_KEY = previous; });
  assert.equal(github.isApprovalReady(), false);
  assert.equal(await github.createScopedApproval(PROPOSAL, SCOPE), null);
  assert.equal(await github.getScopedApproval('id'), null);
  assert.equal((await github.claimApproval('id', CARD)).status, 'unavailable');
});
test('schema adds encryption, kind, editor and preview fields without dropping existing records', async () => {
  let schema; await approvals.initSchema({ query: async (sql) => { schema = sql; } });
  for (const field of ['payload_ciphertext','payload_revision','edit_token_hash','preview_message_id','customer_id','source_message_id','target_issue_number']) assert.match(schema, new RegExp('ADD COLUMN IF NOT EXISTS ' + field));
  assert.doesNotMatch(schema, /DROP TABLE|DELETE FROM/);
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS support_issue_approvals_action_canonical_idx[\s\S]*LOWER\(repository\)/);
  assert.doesNotMatch(schema, /UPDATE support_issue_approvals SET repository/i);
});
