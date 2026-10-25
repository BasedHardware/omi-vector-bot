const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const github = require('../github');
const approvals = require('../supportApprovals');
const signingKey = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const names = ['GITHUB_TOKEN', 'GITHUB_APP_ID', 'GITHUB_APP_INSTALLATION_ID', 'GITHUB_APP_PRIVATE_KEY', 'DATA_ENCRYPTION_KEY'];
function config(t, overrides = {}) {
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const values = { GITHUB_TOKEN: '', GITHUB_APP_ID: ' 31 ', GITHUB_APP_INSTALLATION_ID: ' 41 ',
    GITHUB_APP_PRIVATE_KEY: signingKey, DATA_ENCRYPTION_KEY: Buffer.alloc(32, 27).toString('base64'), ...overrides };
  for (const name of names) process.env[name] = values[name];
  t.after(() => { for (const name of names) { if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name]; } approvals.setStoreForTests(null); });
}
const scope = { caseId: 'sample-case', customerId: 'sample-owner', sourceMessageId: 'sample-event',
  channelId: 'private-review', threadId: 'owner-post', botUserId: 'support-app', kind: 'issue' };

test('token-only configuration keeps ordinary reads configured but disables approval creation', async t => {
  config(t, { GITHUB_TOKEN: 'synthetic-read-token', GITHUB_APP_ID: '', GITHUB_APP_INSTALLATION_ID: '', GITHUB_APP_PRIVATE_KEY: '' });
  let writes = 0;
  approvals.setStoreForTests({ create: async () => { writes++; throw Error('Storage must not be reached'); } });
  assert.equal(github.isConfigured(), true);
  assert.equal(github.isApprovalReady(), false);
  assert.equal(await github.createScopedApproval({ body: 'Technical summary' }, scope), null);
  assert.equal(writes, 0);
});

test('App identity and encryption enable creation with the same normalized writer identity', async t => {
  config(t);
  approvals.setStoreForTests(approvals.createMemoryStore());
  assert.equal(github.isApprovalReady(), true);
  const value = await github.createScopedApproval({ body: 'Technical summary' }, scope);
  assert.equal(value.writerAppId, '31');
});

for (const overrides of [{ DATA_ENCRYPTION_KEY: '' }, { GITHUB_APP_PRIVATE_KEY: '' },
  { GITHUB_APP_ID: 'invalid-id' }, { GITHUB_APP_INSTALLATION_ID: 'invalid-installation' }, { GITHUB_APP_ID: '0' }]) {
  test(`incomplete approval configuration is disabled: ${Object.keys(overrides)[0]} ${Object.values(overrides)[0] ? 'invalid' : 'missing'}`, t => {
    config(t, overrides);
    assert.equal(github.isApprovalReady(), false);
  });
}
