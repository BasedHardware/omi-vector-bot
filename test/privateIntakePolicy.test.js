const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSystemPrompt, PUBLIC_REPLY_PRIVACY_POLICY } = require('../prompt');
const { queryAgent, reviewAnswer, understandQuestion } = require('../commandcode');
const { formatStaffTicket } = require('../handoff');

// These tests inspect real request construction through injected transports;
// they do not call a provider or claim to prove model compliance.
function assertPrivateIntake(system) {
  assert.match(system, /never ask a customer to post their account or purchase email/i);
  assert.match(system, /order number or other order details/i);
  assert.match(system, /full address, payment information, password, or verification code/i);
  assert.match(system, /only through an available private verification flow or an approved private staff-support path/i);
  assert.match(system, /do not invent a private contact path/i);
  assert.match(system, /remove any draft request to share those details here/i);
  assert.match(system, /never echo their private values/i);
  assert.match(system, /missing non-sensitive device, app, OS, and attempted-step details/i);
  assert.match(system, /every language/i);
  assert.ok(typeof PUBLIC_REPLY_PRIVACY_POLICY === 'string' && system.includes(PUBLIC_REPLY_PRIVACY_POLICY));
}
const response = value => ({ data: { choices: [{ message: { content: JSON.stringify(value) } }] } });
function providerFixture(t) {
  const before = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'synthetic-private-intake-key';
  t.after(() => { if (before === undefined) delete process.env.CMD_API_KEY; else process.env.CMD_API_KEY = before; });
}
const synthetic = 'Please explain my account options. I can give identifying details if needed.';

test('every public answer lane carries the shared private-only intake policy', () => {
  for (const lane of ['faq', 'tech', 'firmware', 'shop', 'money', 'account', 'privacy', 'unknown']) {
    assertPrivateIntake(buildSystemPrompt({ lane }));
  }
});

test('answer construction retains private-only intake on planned handoffs and retry', async t => {
  providerFixture(t);
  let calls = 0;
  const result = await queryAgent({ question: synthetic, route: { lane: 'account', area: 'shop', escalate: true },
    handoffPlanned: true,
    post: async (_url, body) => {
      assertPrivateIntake(body.messages.filter(row => row.role === 'system').map(row => row.content).join('\n'));
      calls++;
      if (calls === 1) return { data: { choices: [{ message: { content: 'invalid synthetic JSON' } }] } };
      return response({ final_answer: 'Keep those details private while the team reviews your request.', escalate: true, confidence: 0.8 });
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.escalate, true);
  assert.doesNotMatch(result.final_answer, /received|assigned|approved/i);
});

test('review construction keeps the privacy policy with no planned handoff and on compact retry', async t => {
  providerFixture(t);
  for (const reasoningEffort of ['low', null]) {
    let calls = 0;
    const reviewed = await reviewAnswer({ question: synthetic, lane: 'faq', handoffPlanned: false, reasoningEffort,
      draft: 'Please post your account email and order details here.',
      sources: '[S1 | Help]\nhttps://help.omi.me/synthetic-account-help\nA person must review account requests.',
      post: async (_url, body) => {
        assertPrivateIntake(body.messages.filter(row => row.role === 'system').map(row => row.content).join('\n'));
        assert.match(body.messages.find(row => row.role === 'user').content, /post your account email/);
        calls++;
        if (calls === 1) { const error = new Error('synthetic timeout'); error.code = 'ECONNABORTED'; throw error; }
        return response({ final_answer: 'Keep identifying details private for the team review.', grounded: true, relevant: true,
          escalate: true, confidence: 0.8, sources_used: ['S1'] });
      },
    });
    assert.equal(calls, 2);
    assert.equal(reviewed.escalate, true);
    assert.match(reviewed.final_answer, /https:\/\/help\.omi\.me\/synthetic-account-help/);
  }
});

test('planner-generated localized handoff text is constrained by the same private-only rule', async t => {
  providerFixture(t);
  const result = await understandQuestion({ question: 'Quisiera que revisen mi compra.', route: { lane: 'money', area: 'shop' },
    post: async (_url, body) => {
      assertPrivateIntake(body.messages.filter(row => row.role === 'system').map(row => row.content).join('\n'));
      return response({ standalone_question: 'Purchase review request', support_kind: 'exception_request', reply_language: 'es',
        handoff_acknowledgment: 'Una persona debe revisar tu solicitud en privado.', search_queries: ['purchase review policy'] });
    },
  });
  assert.equal(result.replyLanguage, 'es');
});

test('staff order and damage intake explicitly keeps order identifiers and details private', () => {
  for (const [lane, area, question] of [
    ['shop', 'shop', 'The delivery tracker shows an unexpected date.'],
    ['money', 'shop', 'The casing of my Omi arrived cracked.'],
  ]) {
    const ticket = formatStaffTicket({ question, area, route: { lane, area }, staffOnly: true,
      message: { author: { id: 'synthetic-owner' }, channel: { id: 'synthetic-thread' } } });
    const staff = ticket.discord.embeds[0].fields.find(field => field.name === 'Staff').value;
    assert.match(staff, /order (?:number|email)/i);
    assert.match(staff, /order (?:number|email)[^.]*privately/i);
    assert.match(staff, /never in the public thread/i);
  }
});
