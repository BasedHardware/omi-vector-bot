const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryStore, createApprovalService } = require('../supportApprovals');

const scope = { repo: 'Example/Support', caseId: 'sample-case', customerId: 'sample-owner',
  sourceMessageId: 'first-event', channelId: 'private-review', threadId: 'owner-post',
  botUserId: 'support-app', kind: 'comment', targetIssueNumber: 71 };
const firstDraft = { title: 'Technical update', body: 'Staff will review reproduction details.' };
function fixture() {
  const store = createMemoryStore();
  return { store, service: createApprovalService(store, { key: Buffer.alloc(32, 23) }) };
}

test('distinct concurrent follow-ups elect one unpublished comment proposal without replacing its evidence', async () => {
  const { store, service } = fixture();
  const values = await Promise.all(['first-event', 'second-event', 'third-event'].map(sourceMessageId =>
    service.createDraft(firstDraft, { ...scope, sourceMessageId })));
  assert.equal(new Set(values.map(value => value.id)).size, 1);
  assert.equal(values.filter(value => value.created === true).length, 1);
  assert.equal(store.state.approvals.size, 1);
  assert.ok(values.every(value => value.sourceMessageId === 'first-event'));
  assert.ok(values.every(value => value.payloadHash === values[0].payloadHash));
  assert.ok(values.every(value => value.revision === 1));
});

test('pending, rejected, expired and uncertain unpublished proposals cannot be bypassed by another source', async () => {
  for (const status of ['pending', 'rejected', 'filing', 'unknown']) {
    const { store, service } = fixture();
    const first = await service.createDraft(firstDraft, scope);
    Object.assign(store.state.approvals.get(first.id), { status, expiresAt: new Date(0).toISOString() });
    const later = await service.createDraft({ body: 'Do not overwrite the reviewed draft.' }, { ...scope, sourceMessageId: 'later-event' });
    assert.equal(later.id, first.id);
    assert.equal(later.created, false);
    assert.equal(later.sourceMessageId, first.sourceMessageId);
    assert.equal(later.payloadHash, first.payloadHash);
    assert.equal(later.status, status);
    assert.equal(later.draft.body, firstDraft.body);
  }
});

test('comment dedup preserves case, repository and target isolation; a verified published action permits a later update', async () => {
  const { store, service } = fixture();
  const first = await service.createDraft(firstDraft, scope);
  for (const different of [{ caseId: 'other-case' }, { repo: 'Example/Other' }, { targetIssueNumber: 72 }]) {
    const next = await service.createDraft(firstDraft, { ...scope, ...different, sourceMessageId: 'another-event' });
    assert.notEqual(next.id, first.id);
  }
  await assert.rejects(() => service.createDraft(firstDraft, { ...scope, sourceMessageId: 'changed-owner-event', customerId: 'other-owner' }), /scope/i);
  Object.assign(store.state.approvals.get(first.id), { status: 'filed' });
  const later = await service.createDraft(firstDraft, { ...scope, sourceMessageId: 'after-publication' });
  assert.notEqual(later.id, first.id);
  assert.equal(later.created, true);
  assert.equal((await service.getDraft(first.id)).status, 'filed');
});
