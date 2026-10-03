const assert = require('node:assert/strict');
const test = require('node:test');
const { cases, selectCases, judge, makeChannel, makeMessage } = require('../scripts/live-eval');
const { scenarios, liveScenarios } = require('../scripts/customer-eval');

test('live evaluation includes every previous customer case and all 18 new cases', () => {
  assert.equal(cases.length, scenarios.length + liveScenarios.length + 18);
  const ids = cases.map((scene) => scene.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('empty-transcripts-followup'));
  assert.ok(ids.includes('windows-compatibility'));
  assert.ok(ids.includes('apple-watch'));
  assert.deepEqual(selectCases('power-off,blinking-red').map((scene) => scene.id), ['power-off', 'blinking-red']);
  assert.throws(() => selectCases('power-off,missing-case'), /Unknown case/);
});

test('live evaluation rejects empty, broken, unsourced and misrouted replies', () => {
  const scene = { id: 'example', first: 'person', lane: 'tech', must: [/battery/i] };
  assert.ok(judge(scene, '', false).includes('empty reply'));
  assert.ok(judge(scene, 'Something broke on my side.', true).includes('generic crash reply'));
  assert.ok(judge(scene, 'Check the battery.', true).some((item) => /without official/.test(item)));
  assert.deepEqual(judge(scene, 'Check the battery.\n\nSource: https://help.omi.me/en/articles/123', true), []);
  assert.ok(judge(scene, 'Check the battery.\n\nSource: https://feedback.omi.me/post/123', true).some((item) => /without official/.test(item)));
  assert.ok(judge({ first: 'answer' }, 'Hello.', true).includes('unwanted handoff'));
  assert.deepEqual(judge({ first: 'none' }, '', false), []);
  assert.deepEqual(
    judge(
      { first: 'person', lane: 'tech' },
      'A person needs to check this.\n\nThe problem is written in this thread. Keep talking here — you do not need to ping anyone.',
      true
    ),
    []
  );
  const voice = cases.find((item) => item.id === 'voice-question-no-answer');
  assert.deepEqual(
    judge(voice, 'The transcription appeared, but the reply never arrives.\nSource: https://help.omi.me/en/articles/123', true),
    []
  );
  const release = cases.find((item) => item.id === 'memories-sync-fixed');
  assert.deepEqual(judge(release, "I couldn't verify whether that fix shipped.", true), []);
  const order = cases.find((item) => item.id === 'order-three-weeks');
  assert.deepEqual(judge(order, "I can't tell when it will arrive. Email help@omi.me.", true), []);
  assert.ok(judge(order, 'Your order will arrive tomorrow. Email help@omi.me.', true).some((item) => /said/.test(item)));
  const stuck = cases.find((item) => item.id === 'sync-stuck-offline');
  assert.ok(judge(stuck, 'Tapping the prompt opens a page. Do not reinstall or log out.', true).some((item) => /missing/.test(item)));
  assert.deepEqual(judge(stuck, 'Keep the app open near the device. Do not reinstall or log out.', true), []);
});

test('Discord evaluation stub keeps a single-thread two-turn history', async () => {
  const { channel, history } = makeChannel('899999999999999999');
  const first = makeMessage('my transcripts are empty today', channel, history, '42');
  await first.reply({ content: 'Which app version?' });
  const second = makeMessage('same problem after restart', channel, history, '42');
  const fetched = await channel.messages.fetch();
  assert.equal(fetched.size, 3);
  assert.equal(second.replies.length, 0);
  assert.equal([...fetched.values()][0].content, second.content);
});
