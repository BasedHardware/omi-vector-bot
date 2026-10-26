const test = require('node:test');
const assert = require('node:assert/strict');
const { stripPingNarration, escalateReply } = require('../utils');
const { presentReviewedAnswer } = require('../answerPipeline');
const { answerNeedsPerson, decideEscalation } = require('../escalationPolicy');

const source = 'https://help.omi.me/en/articles/synthetic-capture-state';
const narration = 'this needs a person who can look';
const noInventedReceipt = text => assert.doesNotMatch(text,
  /(?:i have|i've) (?:pinged|notified|contacted)|team has (?:accepted|received)|has this now|already checked your account/i);

test('an acknowledged symptom and completed attempt survive a joined review requirement', () => {
  const fact = 'Your capture is still pending after the retry';
  for (const separator of ['; ', ' — ', ' – ']) {
    const output = stripPingNarration(`${fact}${separator}${narration}. Which app version do you use?`);
    assert.ok(output.includes(fact), separator);
    assert.ok(output.includes('Which app version do you use?'));
    noInventedReceipt(output);
  }
});

test('a fact after a review requirement is retained without a receipt or access claim', () => {
  const fact = 'The capture is still pending after the retry';
  const output = stripPingNarration(`This needs a person who can look; ${fact}.`);
  assert.ok(output.includes(fact));
  noInventedReceipt(output);
});

test('an earlier-attempt report is preserved without limiting it to one device or verb', () => {
  for (const fact of [
    'You already retried the transfer twice',
    'The app and phone were restarted before this reply',
    'Your microphone permission is already enabled',
    'You have already sent the requested diagnostic bundle',
  ]) assert.ok(stripPingNarration(`${fact}; ${narration}.`).includes(fact), fact);
});

test('protective prohibitions and consequences survive the same sentence as review narration', () => {
  for (const fact of [
    'Do not clear storage while captures are pending',
    'Those actions could permanently erase the unsent clips',
    'Keep the app installed until the pending captures have been checked',
  ]) assert.ok(stripPingNarration(`${fact}; ${narration}.`).includes(fact), fact);
});

test('release uncertainty and complete source URLs remain intact', () => {
  const fact = 'A merged change does not prove that the fix shipped';
  assert.ok(stripPingNarration(`${fact}; ${narration}.`).includes(fact));
  for (const url of [source, source + '?section=upload;view=compact']) {
    assert.ok(stripPingNarration(`The capture-state description is at ${url}; ${narration}.`).includes(url));
  }
});

test('non-English context is not erased merely because a joined narration is in English', () => {
  for (const fact of [
    'La grabación sigue pendiente después de reiniciar',
    '録音は再試行後も保留中です',
    '重新尝试后录音仍在等待上传',
    'Die Aufnahme wartet nach dem erneuten Versuch weiterhin auf den Upload',
  ]) assert.ok(stripPingNarration(`${fact}; ${narration}.`).includes(fact), fact);
});

test('already-valid localized replies and independent sentences keep their facts', () => {
  for (const text of [
    'La grabación sigue pendiente. Una persona debe revisar el caso.',
    '録音はまだ保留中です。担当者による確認が必要です。',
    'Your capture is still pending. Which app version do you use?',
  ]) assert.equal(stripPingNarration(text), text);
});

test('a genuine human-review requirement remains distinct from an invented delivery claim', () => {
  const requirement = 'A person on the team needs to review this.';
  const output = presentReviewedAnswer(requirement);
  assert.ok(output.includes(requirement));
  assert.equal(answerNeedsPerson(output), true);
  noInventedReceipt(output);
});

test('a body containing only unverified notification narration still uses an honest fallback', () => {
  assert.equal(stripPingNarration('I have sent this along.'), '');
  const output = presentReviewedAnswer('I have sent this along.');
  assert.ok(output.trim());
  noInventedReceipt(output);
});

test('conditions, negation, uncertainty and quoted requirements are not unconditional person signals', () => {
  for (const text of [
    'No person on the team needs to review this.',
    'A person on the team may need to review this.',
    'If the upload fails again, a person on the team needs to review this.',
    'A person on the team needs to review this only if upload fails again.',
    'The example says "A person on the team needs to review this."',
    '> A person on the team needs to review this.',
    '`A person on the team needs to review this.` is a quoted diagnostic label.',
  ]) {
    assert.equal(answerNeedsPerson(text), false, text);
  }
});

test('structured escalation remains authoritative when presentation carries no unconditional person statement', () => {
  const result = decideEscalation({ route: { lane: 'faq' }, question: 'Where is a documented setting?',
    answer: 'This may need review if it fails again.', agent: { confidence: 0.8, escalate: true },
    triaged: { lane: 'faq' }, reviewApproved: true });
  assert.equal(result.escalate, true);
  assert.ok(result.signals.includes('model_review'));
});

test('a clear person requirement is still detected beside independent context or a later conditional detail request', () => {
  for (const text of [
    'Your capture is still pending; a person needs to review this.',
    'This needs a person who can look.',
    'A person on the team needs to review this; if you know the app version, include it.',
    'The capture is still pending, so a person needs to check it.',
  ]) assert.equal(answerNeedsPerson(text), true, text);
});

test('unverified completed delivery, access and active investigation remain excluded', () => {
  for (const text of [
    'A person on the team has this now.',
    'A person on the team will reply tomorrow.',
    'A person on the team can open your account.',
    'A person on the team is reviewing your recordings.',
  ]) {
    const output = stripPingNarration(text);
    assert.equal(output, '', text);
    noInventedReceipt(output);
  }
});

test('display formatting cannot hide an unverified person receipt or access claim', () => {
  for (const text of [
    'A **person on the team** has this now.',
    'A _person on the team_ will reply tomorrow.',
    'A `person on the team` can open your account.',
    'A ~~person on the team~~ is reviewing your recordings.',
  ]) assert.equal(stripPingNarration(text), '', text);
});

test('has to remains a requirement with repeated whitespace and display formatting', () => {
  for (const text of [
    'A person on the team has  to review this.',
    'A person on the team has\tto review this.',
    'A **person on the team** has to review this.',
  ]) assert.equal(stripPingNarration(text).replace(/\s+/g, ' '), text.replace(/\s+/g, ' '), text);
});

test('unknown staff predicates, modifiers and appended ownership remain fail closed', () => {
  for (const text of [
    'A person on the team received your case.',
    'A person on the team is currently checking your account.',
    'A person on the team assigned to this case can inspect your recordings.',
    'A person on the team will personally review your recordings.',
    'A person on the team needs to review this and they already accepted it.',
    'A person on the team needs to review this; they already accepted it.',
  ]) assert.equal(stripPingNarration(text), '', text);
});

test('technical compound nouns do not establish a human-review requirement', () => {
  for (const text of [
    'This requires a human-readable timestamp.',
    'This needs a person-shaped icon.',
    "This needs a person's name.",
    'This requires a human operator label.',
  ]) assert.equal(answerNeedsPerson(text), false, text);
});

test('a conditional detail request does not hide a later independent requirement', () => {
  assert.equal(answerNeedsPerson('If you know the app version, include it; a person needs to review this.'), true);
  assert.equal(answerNeedsPerson('If the upload fails again; a person needs to review this.'), false);
});

test('honest uncertainty is retained with the actual reported symptom', () => {
  const text = 'I am not sure what the orange light means; your capture is still pending.';
  assert.equal(stripPingNarration(text), text);
});

test('removing narration never leaves a stronger action after deleting a condition or approval', () => {
  for (const text of [
    'Only after a person on the team verifies the backup; clear local storage.',
    'If a person on the team confirms that upload completed — delete the local capture.',
    'Do not clear local storage unless a person on the team confirms the backup.',
    'Wait for a person on the team before you reset the device.',
  ]) {
    const output = stripPingNarration(text);
    if (/clear local storage|delete the local capture|reset the device/i.test(output)) {
      assert.match(output, /only after|if |unless|wait for|before/i, text);
      assert.match(output, /person|team|review|backup|upload completed/i, text);
    }
    noInventedReceipt(output);
  }
});

test('a review requirement cannot disappear while its following action survives', () => {
  const output = stripPingNarration('This needs a person who can look before any device reset; do not reset it yet.');
  if (/device reset|reset it/i.test(output)) assert.match(output, /before|do not|needs|review/i);
  noInventedReceipt(output);
});

test('presentation preserves the context independently of successful or failed staff delivery copy', () => {
  const fact = 'Your capture is still pending after the retry';
  const presented = presentReviewedAnswer(`${fact}; ${narration}.\nSource: ${source}`, {
    question: 'A capture is still waiting to upload.', appendNextStep: false,
  });
  assert.ok(presented.includes(fact));
  assert.ok(presented.includes(source));
  noInventedReceipt(presented);
  const delivered = escalateReply(presented, { pinged: true, replyInThread: true });
  assert.ok(delivered.includes(fact));
  assert.equal((delivered.match(/has this now and will reply in this thread/g) || []).length, 1);
  const failed = escalateReply(presented, { pinged: false, deliveryFailed: true });
  assert.ok(failed.includes(fact));
  assert.doesNotMatch(failed, /has this now|team has accepted/i);
});
