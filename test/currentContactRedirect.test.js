const test = require('node:test');
const assert = require('node:assert/strict');
const { stripSupportRedirect, stripSupportRedirectWithAudit } = require('../utils');
const { decideEscalation } = require('../escalationPolicy');

test('redirect removal retains only bounded current contact intent as text-free metadata', () => {
  for (const clause of [
    'Contact support for confirmation.',
    'Please email help@omi.me for a review.',
    'For confirmation, write to team@basedhardware.com.',
    'You need to contact the support team.',
    'Please **contact support**.',
  ]) {
    const text = `The supported range is not listed. ${clause}\nSource: https://help.omi.me/en/articles/synthetic-range`;
    const result = stripSupportRedirectWithAudit(text);
    assert.equal(result.currentContactRequested, true, clause);
    assert.equal(result.text, stripSupportRedirect(text));
    assert.match(result.text, /supported range is not listed/);
    assert.ok(result.text.endsWith('Source: https://help.omi.me/en/articles/synthetic-range'));
    assert.deepEqual(Object.keys(result).sort(), ['currentContactRequested', 'text']);
  }
});

test('conditional future quoted protective and address-only units do not assert a current contact action', () => {
  for (const text of [
    'Open Status. If it fails, contact support.',
    'Open Status. Contact support if it fails.',
    'Open Status. Contact support only after the retry fails.',
    'Open Status. Before you contact support, read Status.',
    'Open Status. You can contact support later.',
    'Contact support tomorrow.',
    'Contact support next week.',
    'Contact support to confirm the supported firmware.',
    'Contact support in case the problem returns.',
    'Contact support should the problem return.',
    'Contact support as needed.',
    'Contact support or try the documented check first.',
    'Try the documented check first or contact support.',
    'Contact your IT administrator rather than help@omi.me.',
    'Open Status. Consider contacting support.',
    'Open Status. Help is available at help@omi.me.',
    'Open Status. They recommend help@omi.me.',
    'Never email your secret key to help@omi.me.',
    'Do not contact support about this example.',
    'The example says "Contact support."',
    "The example says 'Check Status. Contact support.'",
    'The example says ‘Check Status. Contact support.’',
    "The example says 'Check Status;\nContact support.'",
    "The example says 'Don't change Status.\nContact support.'",
    'The example says "Check Status. Contact support. Then wait."',
    '> Contact support.',
    '`Contact support.`',
    '```text\nContact support.\n```',
    '~~~text\nContact support.\n~~~',
    '    Contact support.',
    '\tContact support.',
    '```example\n```not-a-closing-fence\nContact support.\n```',
    'Source: https://help.omi.me/guide?email=help@omi.me',
    'Contact support; if the retry fails.',
    'Open Status.\nIf needed:\nContact support.',
    'If the problem returns\n- Contact support.',
    'As needed:\nContact support.',
    '**If needed:**\nContact support.',
  ]) assert.equal(stripSupportRedirectWithAudit(text).currentContactRequested, false, text);
});

test('a real current instruction after a completed code fence still reaches the audit', () => {
  for (const fence of ['```', '~~~']) {
    const result = stripSupportRedirectWithAudit(`${fence}example\nContact support later.\n${fence}\nPlease contact support for confirmation.`);
    assert.equal(result.currentContactRequested, true);
  }
});

test('closed quoted facts and paragraph boundaries do not hide an independent current instruction', () => {
  for (const text of [
    "The indicator is called 'Status'. Contact support for confirmation.",
    'The indicator is called “Status”; contact support for confirmation.',
    'The indicator is called `Status`. Contact support for confirmation.',
    '**The range is unknown.**\nContact support for confirmation.',
    'The range is **unknown.**\nContact support for confirmation.',
    'If needed:\nContact support.\n\nContact support for confirmation.',
  ]) assert.equal(stripSupportRedirectWithAudit(text).currentContactRequested, true, text);
});

test('current contact metadata does not delete completed attempts or protective instructions', () => {
  const text = 'The upload is still pending after your retry; contact support. Do not clear local recordings.\nSource: https://help.omi.me/en/articles/synthetic-upload';
  const result = stripSupportRedirectWithAudit(text);
  assert.equal(result.currentContactRequested, true);
  assert.match(result.text, /still pending after your retry/);
  assert.match(result.text, /Do not clear local recordings/);
  assert.doesNotMatch(result.text, /contact support/);
});

test('the shared decision preserves a current contact actor despite approved FAQ confidence', () => {
  const result = decideEscalation({ route: { lane: 'faq' }, triaged: { lane: 'faq' },
    question: 'Where is documentation for validation badges?', answer: 'The range remains uncertain. Contact support for confirmation.',
    agent: { confidence: 0.99, escalate: false }, reviewApproved: true });
  assert.equal(result.escalate, true);
  assert.equal(result.docsQuiet, false);
  assert.ok(result.signals.includes('current_contact_redirect'));
});
