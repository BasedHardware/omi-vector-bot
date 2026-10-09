const assert = require('node:assert/strict');
const test = require('node:test');
const { createClosureWorkflow } = require('../supportClosure');

const clone = (value) => value == null ? value : structuredClone(value);

function serializedActions() {
  const tails = new Map();
  return {
    async run(caseId, work) {
      const previous = tails.get(caseId) || Promise.resolve();
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      const next = previous.then(() => held);
      tails.set(caseId, next);
      await previous;
      let owned = true;
      try { return await work(async () => { assert.equal(owned, true); }); }
      finally {
        owned = false;
        release();
        if (tails.get(caseId) === next) tails.delete(caseId);
      }
    },
  };
}

function fixture() {
  const state = {
    value: { id: 'case-a', customerId: 'customer-a', channelId: 'thread-a',
      customerThreadId: 'thread-a', handoffThreadId: null, escalationId: 17,
      generation: 0, status: 'delivered', deliveryId: null },
    rows: new Map(), sends: [], resolves: [], projected: [], escalations: [],
    marks: [], finishes: [], logs: [], ambiguous: false, sendFailure: null,
    saveFailures: 0, casNull: false, finishFailure: false, afterSend: null,
    currentBot: 'bot-a',
  };
  const channel = { id: 'thread-a' };
  const client = { user: { id: 'bot-a' } };
  const user = { id: 'staff-a' };
  const cases = {
    async getThreadCaseScope(threadId) {
      const matching = state.value && [state.value.channelId, state.value.customerThreadId,
        state.value.handoffThreadId].includes(threadId);
      return { case: matching ? clone(state.value) : null,
        ambiguous: state.ambiguous, count: state.ambiguous ? 2 : matching ? 1 : 0 };
    },
    async getCaseById(id) { return state.value?.id === id ? clone(state.value) : null; },
    async resolveCase(id, options) {
      state.resolves.push({ id, ...options });
      if (state.saveFailures > 0) { state.saveFailures -= 1; throw new Error('PRIVATE_SAVE_ERROR'); }
      if (state.casNull || state.value?.id !== id || state.value.generation !== options.expectedGeneration) return null;
      state.value = { ...state.value, status: 'closed', deliveryId: options.deliveryId };
      return clone(state.value);
    },
  };
  const deliveries = {
    async get(key) { return clone(state.rows.get(key)); },
    async send(scope, sender) {
      const existing = state.rows.get(scope.operationKey);
      if (existing?.state === 'accepted') return { id: existing.messageId };
      if (existing?.state === 'unknown') {
        const error = new Error('PRIVATE_TRANSPORT_ERROR'); error.deliveryUncertain = true; throw error;
      }
      const row = { ...scope, id: 'delivery-a', nonce: '1234567890abcdef12345678',
        state: 'dispatching', messageId: null };
      state.rows.set(scope.operationKey, row);
      try {
        const receipt = await sender({ nonce: row.nonce, enforceNonce: true });
        Object.assign(row, { state: 'accepted', messageId: receipt.id });
        return receipt;
      } catch (error) {
        row.state = error.deliveryUncertain ? 'unknown' : 'rejected';
        throw error;
      }
    },
    async markProjected(id) { state.projected.push(id); },
  };
  const dependencies = {
    cases, deliveries, actions: serializedActions(), botUserId: () => state.currentBot,
    async sendNotice(_client, destination, payload) {
      state.sends.push({ channelId: destination.id, payload: clone(payload) });
      if (state.sendFailure) throw state.sendFailure;
      const receipt = { id: 'notice-a', channelId: destination.id,
        author: { id: client.user.id, bot: true }, nonce: payload.nonce, reference: null };
      if (state.afterSend) await state.afterSend();
      return receipt;
    },
    async finishThread(destination, guard) {
      await guard(); state.finishes.push(destination.id);
      if (state.finishFailure) throw new Error('PRIVATE_ARCHIVE_ERROR');
    },
    async resolveEscalation(id) { state.escalations.push(id); },
    markThreadClosed(destination) { state.marks.push(destination.id); },
    log(line) { state.logs.push(line); },
  };
  const workflow = createClosureWorkflow(dependencies);
  const input = () => ({ channel, user, client, customerCase: clone(state.value),
    payloadFn: (_staff, { feedbackNonce }) => ({ content: 'Closing notice',
      components: [{ components: [{ custom_id: `rate:yes:${feedbackNonce}` },
        { custom_id: `rate:no:${feedbackNonce}` }] }] }) });
  const row = () => clone(state.rows.get('closure:case-a:0:thread-a'));
  return { state, channel, client, dependencies, workflow, input, row };
}

test('parallel closing requests serialize one notice and reuse its immutable receipt', async () => {
  const f = fixture(); const input = f.input();
  const results = await Promise.all([f.workflow.close(input), f.workflow.close(input)]);
  assert.equal(results.every((result) => result.ok), true);
  assert.equal(f.state.sends.length, 1);
  assert.equal(f.state.value.status, 'closed');
  assert.equal(f.state.value.deliveryId, 'notice-a');
  assert.equal(f.state.resolves.length, 1);
  const row = f.row();
  assert.equal(row.operationKey, 'closure:case-a:0:thread-a');
  assert.equal(row.kind, 'closure');
  assert.equal(row.sourceMessageId, 'thread-a');
  assert.equal(row.referenceMessageId, null);
  assert.equal(row.approvalId, null);
  assert.equal(row.customerId, 'customer-a');
  assert.equal(row.botUserId, 'bot-a');
  assert.equal(row.caseGeneration, 0);
  assert.equal(row.messageId, 'notice-a');
  assert.doesNotMatch(JSON.stringify(row), /Closing notice|components|content|rate:/);
  const payload = f.state.sends[0].payload;
  assert.equal(payload.enforceNonce, true);
  assert.equal(payload.components[0].components[0].custom_id, `rate:yes:${row.nonce}`);
  assert.deepEqual(f.state.resolves[0], {
    id: 'case-a', close: true, deliveryId: 'notice-a', expectedGeneration: 0,
  });
});

test('case save failure is honest and retry reuses accepted notice without another POST', async () => {
  const f = fixture(); f.state.saveFailures = 1;
  const input = f.input(); const first = await f.workflow.close(input);
  assert.equal(first.ok, false);
  assert.match(first.reason, /posted.*incomplete.*reuse/i);
  assert.equal(f.state.value.status, 'delivered');
  assert.deepEqual(f.state.finishes, []);
  assert.deepEqual(f.state.escalations, []);
  assert.equal((await f.workflow.close(input)).ok, true);
  assert.equal(f.state.sends.length, 1);
  assert.equal(f.state.value.status, 'closed');
  assert.doesNotMatch(f.state.logs.join(' '), /PRIVATE_SAVE_ERROR/);
});

test('null generation CAS provides no closure or escalation/archive proof', async () => {
  const f = fixture(); f.state.casNull = true;
  const result = await f.workflow.close(f.input());
  assert.equal(result.ok, false);
  assert.equal(f.state.value.status, 'delivered');
  assert.deepEqual(f.state.escalations, []);
  assert.deepEqual(f.state.projected, []);
  assert.deepEqual(f.state.marks, []);
  assert.deepEqual(f.state.finishes, []);
});

test('unknown send is held; later authenticated receipt repairs only local closure state', async () => {
  const f = fixture();
  f.state.sendFailure = Object.assign(new Error('PRIVATE_UNKNOWN_BODY'), { deliveryUncertain: true });
  const input = f.input(); const first = await f.workflow.close(input);
  assert.equal(first.ok, false); assert.match(first.reason, /could not confirm.*not closed or archived/i);
  assert.equal(f.state.value.status, 'delivered');
  assert.equal((await f.workflow.close(input)).ok, false);
  assert.equal(f.state.sends.length, 1);
  const stored = f.state.rows.get('closure:case-a:0:thread-a');
  Object.assign(stored, { state: 'accepted', messageId: 'notice-a' });
  const restarted = createClosureWorkflow(f.dependencies);
  assert.equal(await restarted.repair(clone(stored)), true);
  assert.equal(f.state.value.status, 'closed');
  assert.deepEqual(f.state.escalations, [17]);
  assert.deepEqual(f.state.projected, ['delivery-a']);
  assert.equal(f.state.sends.length, 1);
  assert.deepEqual(f.state.marks, []);
  assert.deepEqual(f.state.finishes, []);
  assert.doesNotMatch(f.state.logs.join(' '), /PRIVATE_UNKNOWN_BODY/);
});

test('old accepted closing receipt retires after reopen without reclosing or rearchiving', async () => {
  const f = fixture(); assert.equal((await f.workflow.close(f.input())).ok, true);
  const old = f.row();
  f.state.value = { ...f.state.value, generation: 1, status: 'active', deliveryId: null };
  f.state.resolves = []; f.state.escalations = []; f.state.projected = [];
  f.state.marks = []; f.state.finishes = [];
  assert.equal(await f.workflow.repair(old), true);
  assert.equal(f.state.value.status, 'active');
  assert.equal(f.state.value.generation, 1);
  assert.deepEqual(f.state.resolves, []);
  assert.deepEqual(f.state.escalations, []);
  assert.deepEqual(f.state.projected, ['delivery-a']);
  assert.deepEqual(f.state.marks, []); assert.deepEqual(f.state.finishes, []);
});

test('changed customer, ambiguous ownership, destination or absent bot refuses before send', async () => {
  for (const change of ['customer', 'ambiguous', 'destination', 'bot']) {
    const f = fixture(); const input = f.input();
    if (change === 'customer') f.state.value.customerId = 'other-customer';
    if (change === 'ambiguous') f.state.ambiguous = true;
    if (change === 'destination') input.channel = { id: 'other-thread' };
    if (change === 'bot') input.client = { user: null };
    assert.equal((await f.workflow.close(input)).ok, false, change);
    assert.deepEqual(f.state.sends, [], change);
    assert.deepEqual(f.state.resolves, [], change);
    assert.deepEqual(f.state.finishes, [], change);
  }
});

test('fabricated repair metadata cannot replace the persisted accepted receipt', async () => {
  for (const patch of [
    { botUserId: 'other-bot' }, { customerId: 'other-customer' }, { channelId: 'other-thread' },
    { messageId: 'other-message' }, { id: 'other-delivery' }, { sourceMessageId: 'other-source' },
    { operationKey: 'closure:case-a:0:other-thread' }, { referenceMessageId: 'quoted-message' },
    { approvalId: 'approval-a' }, { state: 'unknown' }, { kind: 'staff-card' },
  ]) {
    const f = fixture(); f.state.saveFailures = 1; await f.workflow.close(f.input());
    f.state.resolves = [];
    assert.equal(await f.workflow.repair({ ...f.row(), ...patch }), false, JSON.stringify(patch));
    assert.equal(f.state.value.status, 'delivered');
    assert.deepEqual(f.state.resolves, []); assert.deepEqual(f.state.escalations, []);
    assert.deepEqual(f.state.projected, []); assert.deepEqual(f.state.finishes, []);
  }
});

test('repair requires a persisted accepted row and the currently authenticated bot identity', async () => {
  const f = fixture(); f.state.saveFailures = 1; await f.workflow.close(f.input());
  const accepted = f.row(); f.state.currentBot = 'replacement-bot';
  assert.equal(await f.workflow.repair(accepted), false);
  f.state.currentBot = 'bot-a';
  const stored = f.state.rows.get(accepted.operationKey); stored.state = 'unknown';
  assert.equal(await f.workflow.repair(accepted), false);
  f.state.rows.delete(accepted.operationKey);
  assert.equal(await f.workflow.repair(accepted), false);
  assert.equal(f.state.value.status, 'delivered');
  assert.deepEqual(f.state.finishes, []);
});

test('legacy already-closed case without a ledger never receives another closing card', async () => {
  const f = fixture(); f.state.value.status = 'closed';
  const result = await f.workflow.close(f.input());
  assert.equal(result.ok, true); assert.match(result.reason, /already closed.*No additional/i);
  assert.deepEqual(f.state.sends, []); assert.deepEqual(f.state.finishes, []);
  assert.equal(f.state.rows.size, 0);
});

test('known blocked/rejected send leaves case open and does not expose error details', async () => {
  for (const flag of ['deliveryRejected', 'deliveryBlocked']) {
    const f = fixture(); f.state.sendFailure = Object.assign(new Error('PRIVATE_REJECTION'), { [flag]: true });
    const result = await f.workflow.close(f.input());
    assert.equal(result.ok, false); assert.match(result.reason, /blocked or rejected.*not been closed or archived/i);
    assert.equal(f.state.value.status, 'delivered');
    assert.deepEqual(f.state.resolves, []); assert.deepEqual(f.state.finishes, []);
    assert.doesNotMatch(f.state.logs.join(' '), /PRIVATE_REJECTION/);
  }
});

test('thread finalization failure is truthful after core case closure', async () => {
  const f = fixture(); f.state.finishFailure = true;
  const result = await f.workflow.close(f.input());
  assert.equal(result.ok, true); assert.match(result.reason, /resolution update was saved.*could not confirm.*archive/i);
  assert.equal(f.state.value.status, 'closed');
  assert.equal(f.state.sends.length, 1); assert.deepEqual(f.state.escalations, [17]);
  assert.doesNotMatch(f.state.logs.join(' '), /PRIVATE_ARCHIVE_ERROR/);
});

test('generation changed after delivery cannot close or archive the reopened case', async () => {
  const f = fixture(); const input = f.input();
  f.state.afterSend = async () => { f.state.value = { ...f.state.value, generation: 1, status: 'active' }; };
  const result = await f.workflow.close(input);
  assert.equal(result.ok, false); assert.equal(f.state.value.status, 'active');
  assert.deepEqual(f.state.resolves, []); assert.deepEqual(f.state.escalations, []);
  assert.deepEqual(f.state.finishes, []); assert.deepEqual(f.state.projected, ['delivery-a']);
});

test('late action lease loss does not deny an accepted notice and completed case closure', async () => {
  const f = fixture();
  const workflow = createClosureWorkflow({ ...f.dependencies, actions: {
    async run(_caseId, work) {
      await work(async () => {});
      throw new Error('PRIVATE_LEASE_LOST_AFTER_WORK');
    },
  } });
  const result = await workflow.close(f.input());
  assert.equal(result.ok, false);
  assert.equal(f.state.sends.length, 1);
  assert.equal(f.row().state, 'accepted');
  assert.equal(f.state.value.status, 'closed');
  assert.deepEqual(f.state.finishes, ['thread-a']);
  assert.match(result.reason, /notice.*(?:posted|delivered)/i);
  assert.match(result.reason, /case update completed/i);
  assert.match(result.reason, /coordination.*lost|final state.*unconfirmed|before confirming the final state/i);
  assert.doesNotMatch(result.reason || '', /no additional closing notice was posted|case has not been closed|PRIVATE_LEASE/i);
  assert.doesNotMatch(f.state.logs.join(' '), /PRIVATE_LEASE_LOST_AFTER_WORK/);
});

test('late action lease loss after an accepted notice but failed case save preserves partial truth', async () => {
  const f = fixture(); f.state.saveFailures = 1;
  const workflow = createClosureWorkflow({ ...f.dependencies, actions: {
    async run(_caseId, work) {
      await work(async () => {});
      throw new Error('PRIVATE_LEASE_LOST_AFTER_WORK');
    },
  } });
  const result = await workflow.close(f.input());
  assert.equal(result.ok, false);
  assert.equal(f.state.sends.length, 1);
  assert.equal(f.row().state, 'accepted');
  assert.equal(f.state.value.status, 'delivered');
  assert.deepEqual(f.state.escalations, []);
  assert.deepEqual(f.state.finishes, []);
  assert.match(result.reason, /notice.*(?:posted|delivered)/i);
  assert.match(result.reason, /incomplete|unconfirmed|could not confirm|pending/i);
  assert.doesNotMatch(result.reason, /no additional closing notice was posted|case is marked resolved|case (?:was|is|has been) closed|PRIVATE_LEASE/i);
  assert.doesNotMatch(f.state.logs.join(' '), /PRIVATE_LEASE_LOST_AFTER_WORK|PRIVATE_SAVE_ERROR/);
});
