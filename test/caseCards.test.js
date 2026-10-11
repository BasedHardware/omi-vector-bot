const test = require('node:test');
const assert = require('node:assert/strict');
const supportCases = require('../supportCases');
const { createMemoryStore, createCardService, renderCaseCard, notifyAcceptance, createPostgresStore } = require('../caseCards');
const STAFF = '234567890123456789';
const OWNER = '334567890123456789';
const OTHER = '434567890123456789';
const CARD = '534567890123456789';

async function fixture(t) {
  const old = process.env.STAFF_ALERT_CHANNEL_ID; process.env.STAFF_ALERT_CHANNEL_ID = STAFF;
  t.after(() => { if (old === undefined) delete process.env.STAFF_ALERT_CHANNEL_ID; else process.env.STAFF_ALERT_CHANNEL_ID = old; });
  const caseStore = supportCases.createMemoryStore(); const cases = supportCases.createCaseService(caseStore);
  const value = await cases.getOrCreateCase({ channelId: 'help', customerThreadId: 'help', customerId: 'customer', sourceMessageId: 'source' });
  await cases.markDelivered(value.id, { confirmed: true, destination: 'staff-channel' });
  const store = createMemoryStore(); const logs = []; const cards = createCardService(store, { service: cases, log: l => logs.push(l) });
  const edits = []; const notices = [];
  const message = { id: CARD, author: { id: 'bot' }, embeds: [{ title: 'Needs a human', description: 'Private existing intake',
    fields: [{ name: 'Case', value: value.id }, { name: 'From', value: '<@customer>' }] }],
    components: [{ type: 1, components: [{ type: 2, custom_id: 'file:draft', label: 'File issue', style: 1 }] }],
    edit: async payload => { edits.push(payload); message.embeds = payload.embeds; message.components = payload.components; },
  };
  const client = { user: { id: 'bot' }, channels: { fetch: async id => id === STAFF ? { messages: { fetch: async () => message } }
    : { send: async payload => { notices.push(payload); return { id: `notice-${notices.length}` }; } } } };
  await cards.rememberCard(value.id, STAFF, CARD);
  return { cases, caseStore, value, store, cards, logs, edits, notices, message, client };
}

test('live card distinguishes delivery, acceptance, active work, waiting, and closure without adding pings', async t => {
  const f = await fixture(t);
  await f.cards.syncCase(f.client, f.value.id);
  assert.match(f.edits.at(-1).embeds[0].title, /Awaiting staff acceptance/);
  assert.equal(f.edits.at(-1).embeds[0].fields.some(x => x.name === 'Picked up by'), false);
  await f.cases.markAccepted(f.value.id, { staffId: OWNER });
  await f.cards.syncCase(f.client, f.value.id);
  assert.match(f.edits.at(-1).embeds[0].title, /Accepted · not started/);
  await f.cases.setWorkStatus(f.value.id, 'in_progress'); await f.cards.syncCase(f.client, f.value.id);
  assert.match(f.edits.at(-1).embeds[0].title, /In progress/);
  await f.cases.setWorkStatus(f.value.id, 'waiting_customer'); await f.cards.syncCase(f.client, f.value.id);
  assert.match(f.edits.at(-1).embeds[0].title, /Waiting for customer/);
  await f.cases.resolveCase(f.value.id, { close: true, confirmed: true }); await f.cards.syncCase(f.client, f.value.id);
  const last = f.edits.at(-1);
  assert.match(last.embeds[0].title, /Closed/);
  assert.equal(last.components.flatMap(r => r.components).some(c => /^case:(accept|work)/.test(c.custom_id)), false);
  assert.ok(last.components.flatMap(r => r.components).some(c => c.custom_id === 'file:draft'));
  assert.deepEqual(last.allowedMentions, { parse: [], users: [], roles: [], repliedUser: false });
});

test('card receipts and changed case state survive recreation and recover on the pending sweep', async t => {
  const f = await fixture(t); await f.cards.syncCase(f.client, f.value.id);
  await f.cases.markAccepted(f.value.id, { staffId: OWNER }); await f.cases.setWorkStatus(f.value.id, 'in_progress');
  const restartedCases = supportCases.createCaseService(supportCases.createMemoryStore(f.caseStore.state));
  const restarted = createCardService(createMemoryStore(f.store.state), { service: restartedCases });
  assert.equal(await restarted.syncPending(f.client), 1);
  assert.match(f.edits.at(-1).embeds[0].title, /In progress/);
  assert.equal(await restarted.syncPending(f.client), 0);
  const stored = JSON.stringify([...f.store.state.cards.values()]);
  assert.doesNotMatch(stored, /Private existing intake|From|customer/);
});

test('card sync never edits a public destination, a different author, or another case card', async t => {
  const f = await fixture(t);
  await f.cards.rememberCard(f.value.id, OTHER, '634567890123456789');
  const originalFetch = f.client.channels.fetch;
  f.client.channels.fetch = async id => { assert.equal(id, STAFF); return originalFetch(id); };
  f.message.author.id = 'someone-else'; assert.equal((await f.cards.syncCase(f.client, f.value.id)).ok, false);
  f.message.author.id = 'bot'; f.message.embeds[0].fields[0].value = 'another-case';
  assert.equal((await f.cards.syncCase(f.client, f.value.id)).ok, false);
  assert.equal(f.edits.length, 0);
});

test('an intentionally deleted staff card is retired, not reposted', async t => {
  const f = await fixture(t);
  f.client.channels.fetch = async () => ({ messages: { fetch: async () => { const error = new Error('gone'); error.code = 10008; throw error; } } });
  await f.cards.syncCase(f.client, f.value.id);
  assert.equal((await f.store.list(f.value.id)).length, 0);
  assert.equal(f.notices.length, 0);
});

test('failed card edit remains pending and a later sweep repairs it', async t => {
  const f = await fixture(t); const edit = f.message.edit;
  f.message.edit = async () => { throw new Error('unavailable'); };
  assert.equal((await f.cards.syncCase(f.client, f.value.id)).ok, false);
  f.message.edit = edit; assert.equal(await f.cards.syncPending(f.client), 1);
  assert.equal(await f.cards.syncPending(f.client), 0);
  assert.deepEqual(f.logs, ['[CaseCard] status refresh failed; pending retry']);
});

test('serialized edits reread the case and cannot leave an older progress state last', async t => {
  const f = await fixture(t); await f.cases.markAccepted(f.value.id, { staffId: OWNER });
  let release; let started; const begun = new Promise(resolve => { started = resolve; });
  const original = f.message.edit; let first = true;
  f.message.edit = async payload => { if (first) { first = false; started(); await new Promise(resolve => { release = resolve; }); } await original(payload); };
  const earlier = f.cards.syncCase(f.client, f.value.id); await begun;
  await f.cases.setWorkStatus(f.value.id, 'in_progress'); const later = f.cards.syncCase(f.client, f.value.id);
  release(); await Promise.all([earlier, later]);
  assert.match(f.edits.at(-1).embeds[0].title, /In progress/);
});

test('acceptance announces the actual first staff member once, without customer details, pings, or an ETA', async t => {
  const f = await fixture(t); const accepted = await f.cases.markAccepted(f.value.id, { staffId: OWNER });
  assert.equal((await notifyAcceptance(f.client, accepted, { service: f.cases })).code, 'sent');
  const repeated = await f.cases.markAccepted(f.value.id, { staffId: OTHER });
  assert.equal((await notifyAcceptance(f.client, repeated, { service: f.cases })).duplicate, true);
  assert.equal(f.notices.length, 1);
  assert.equal(f.notices[0].content, `<@${OWNER}> from Omi support has picked up your case. Please keep any follow-up in this thread.`);
  assert.doesNotMatch(f.notices[0].content, /soon|minute|guarantee|customer|Private existing intake/);
  assert.equal(f.notices[0].nonce.length, 24); assert.equal(f.notices[0].enforceNonce, true);
  assert.deepEqual(f.notices[0].allowedMentions, { parse: [], users: [], roles: [], repliedUser: false });
});

test('uncertain notice delivery is not retried or misreported as a sent notice', async t => {
  const f = await fixture(t); const accepted = await f.cases.markAccepted(f.value.id, { staffId: OWNER }); let attempts = 0;
  f.client.channels.fetch = async () => ({ send: async () => { attempts++; throw new Error('timeout'); } });
  const log = () => {};
  assert.equal((await notifyAcceptance(f.client, accepted, { service: f.cases, log })).code, 'send_unconfirmed');
  assert.equal((await notifyAcceptance(f.client, accepted, { service: f.cases, log })).ok, false);
  assert.equal(attempts, 1); assert.equal((await f.cases.getCaseById(f.value.id)).status, 'accepted');
});

test('an empty Discord send result is not called a delivered acceptance notice', async t => {
  const f = await fixture(t); const accepted = await f.cases.markAccepted(f.value.id, { staffId: OWNER });
  f.client.channels.fetch = async () => ({ send: async () => undefined });
  assert.equal((await notifyAcceptance(f.client, accepted, { service: f.cases, log: () => {} })).ok, false);
  assert.equal((await f.cases.getCaseById(f.value.id)).acceptanceNoticeId, null);
});

test('a sent notice with a receipt-save error still cannot be duplicated', async t => {
  const f = await fixture(t); const accepted = await f.cases.markAccepted(f.value.id, { staffId: OWNER });
  const service = { ...f.cases, saveAcceptanceNotice: async () => { throw new Error('db down'); } };
  assert.equal((await notifyAcceptance(f.client, accepted, { service, log: () => {} })).code, 'receipt_save_failed');
  await notifyAcceptance(f.client, accepted, { service, log: () => {} }); assert.equal(f.notices.length, 1);
});

test('reopening clears old acceptance and a stale acceptance cannot announce the new owner', async t => {
  const f = await fixture(t); const old = await f.cases.markAccepted(f.value.id, { staffId: OWNER });
  await f.cases.setWorkStatus(f.value.id, 'in_progress'); await f.cases.resolveCase(f.value.id, { close: true, confirmed: true });
  const reopened = await f.cases.reopenByThread('help', 'customer');
  assert.equal(reopened.acceptedBy, null); assert.equal(reopened.workStatus, null);
  await f.cases.markDelivered(f.value.id, { confirmed: true });
  const current = await f.cases.markAccepted(f.value.id, { staffId: OTHER });
  assert.notEqual(old.acceptanceGeneration, current.acceptanceGeneration);
  assert.equal((await notifyAcceptance(f.client, old, { service: f.cases })).ok, false);
  assert.equal(f.notices.length, 0);
  await notifyAcceptance(f.client, current, { service: f.cases }); assert.match(f.notices[0].content, new RegExp(OTHER));
});

test('shared-channel acceptance verifies the original customer message before sending a reply', async t => {
  const f = await fixture(t); const value = await f.cases.getOrCreateCase({ channelId: 'general', customerId: 'customer', sourceMessageId: 'original' });
  await f.cases.markDelivered(value.id, { confirmed: true }); const accepted = await f.cases.markAccepted(value.id, { staffId: OWNER });
  let author = 'another-customer'; const sent = [];
  const client = { channels: { fetch: async () => ({ messages: { fetch: async () => ({ author: { id: author } }) }, send: async payload => { sent.push(payload); return { id: 'notice' }; } }) } };
  assert.equal((await notifyAcceptance(client, accepted, { service: f.cases })).code, 'source_unverifiable');
  author = 'customer'; await notifyAcceptance(client, accepted, { service: f.cases });
  assert.equal(sent.length, 1); assert.deepEqual(sent[0].reply, { messageReference: 'original', failIfNotExists: true });
});

test('Postgres serializes cross-copy card edits and always releases its lock connection', async () => {
  const statements = []; let released = false;
  const connection = { query: async sql => { statements.push(sql); }, release: () => { released = true; } };
  const store = createPostgresStore({ connect: async () => connection });
  await assert.rejects(store.lock('case', async () => { throw new Error('edit failed'); }), /edit failed/);
  assert.match(statements[2], /pg_advisory_xact_lock/); assert.equal(statements.at(-1), 'ROLLBACK'); assert.equal(released, true);
});

test('Postgres synchronization keeps its exact timestamp and refuses to acknowledge a newer state', async () => {
  const calls = []; const store = createPostgresStore({ query: async (sql, args) => { calls.push({ sql, args }); } });
  await store.synced({ caseId: 'case', messageId: CARD }, { updatedAt: new Date(), status: 'accepted', workStatus: 'in_progress', acceptedBy: OWNER });
  assert.match(calls[0].sql, /synced_at=s.updated_at/);
  assert.match(calls[0].sql, /date_trunc\('milliseconds', s.updated_at\)=\$3/);
  assert.match(calls[0].sql, /s.work_status IS NOT DISTINCT FROM \$5/);
  assert.match(calls[0].sql, /s.accepted_by IS NOT DISTINCT FROM \$6/);
});

test('acceptance uses the persisted customer language without a provider call', async t => {
  const f = await fixture(t);
  for (const [language, match] of [['es', /se ha hecho cargo/], ['zh', /已接手/], ['it', /preso in carico/], ['hi-Latn', /aapka mamla/]]) {
    const value = await f.cases.getOrCreateCase({ channelId: `help-${language}`, customerThreadId: `help-${language}`, customerId: 'customer', context: { replyLanguage: language } });
    await f.cases.markDelivered(value.id, { confirmed: true }); const accepted = await f.cases.markAccepted(value.id, { staffId: OWNER });
    await notifyAcceptance(f.client, accepted, { service: f.cases });
    assert.match(f.notices.at(-1).content, match); assert.doesNotMatch(f.notices.at(-1).content, /from Omi support has picked up/);
  }
});

test('public copies remove all live-case controls, status, identity, and private case references', async t => {
  const f = await fixture(t); await f.cases.markAccepted(f.value.id, { staffId: OWNER });
  await f.cards.syncCase(f.client, f.value.id);
  const publicCard = require('../handoff').publicHandoffDiscord(f.edits.at(-1));
  const serialized = JSON.stringify(publicCard);
  for (const privateValue of [f.value.id, OWNER, 'case:refresh:', 'case:work:', 'Picked up by', 'Case updated', 'Accepted · not started', 'Private existing intake']) assert.equal(serialized.includes(privateValue), false);
});

test('a confirmed staff send registers its existing Discord card for later case updates', async t => {
  const f = await fixture(t); const module = require('../caseCards');
  const handoff = require('../handoff'); const telegram = require('../telegram');
  const sendTelegram = telegram.sendEscalation; telegram.sendEscalation = async () => false;
  supportCases.setStoreForTests(f.caseStore); module.setStoreForTests(f.store);
  try {
    const messageId = '734567890123456789';
    const result = await handoff.notifyStaff({ client: { channels: { fetch: async () => ({ id: STAFF, isTextBased: () => true,
      send: async () => ({ id: messageId }) }) } }, caseId: f.value.id,
      message: { author: { id: 'customer' }, channel: { id: 'help' } }, question: 'Synthetic support request',
      area: 'app', route: { area: 'app', lane: 'tech' }, skipDedupe: true });
    assert.equal(result.ok, true); assert.equal(result.via, 'staff-channel');
    assert.ok((await f.store.list(f.value.id)).some(c => c.messageId === messageId && c.channelId === STAFF));
  } finally {
    supportCases.setStoreForTests(null); module.setStoreForTests(null); telegram.sendEscalation = sendTelegram; handoff.resetHandoffMemory();
  }
});
