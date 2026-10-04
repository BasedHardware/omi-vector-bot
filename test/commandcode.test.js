const assert = require('node:assert/strict');
const test = require('node:test');
const {
  parseAgentJson,
  parseSearchPlan,
  contextualQuestion,
  groundedSourceLine,
  planSearch,
  queryAgent,
  reviewAnswer,
  providerConfig,
  technicalReviewSafety,
  officialHandoffLinks,
} = require('../commandcode');

test('review failure links include at most two retrieved official pages', () => {
  const evidence = '[S1 | Help]\nhttps://help.omi.me/a\nOne\n[S2 | GitHub]\nhttps://github.com/BasedHardware/omi/issues/1\nTwo\n[S3 | Docs]\nhttps://docs.omi.me/b\nThree\n[S4 | Help]\nhttps://help.omi.me/c\nFour';
  assert.deepEqual(officialHandoffLinks(evidence), ['https://help.omi.me/a', 'https://docs.omi.me/b']);
});

test('CommandCode uses its own key, model and endpoint without a legacy session header', async () => {
  const previous = { command: process.env.CMD_API_KEY, open: process.env.OPENCODE_API_KEY };
  process.env.CMD_API_KEY = 'command-test-key';
  process.env.OPENCODE_API_KEY = 'legacy-test-key';
  try {
    assert.equal(providerConfig().name, 'CommandCode');
    await queryAgent({
      question: 'How do I pair Omi?',
      post: async (url, body, options) => {
        assert.equal(url, 'https://api.commandcode.ai/provider/v1/chat/completions');
        assert.equal(body.model, process.env.CMD_MODEL || 'deepseek/deepseek-v4.1-flash');
        assert.equal(options.headers.Authorization, 'Bearer command-test-key');
        assert.equal(options.headers['x-opencode-session'], undefined);
        return { data: { choices: [{ message: { content: '{"final_answer":"Use the official pairing guide.","confidence":0.8,"escalate":false}' } }] } };
      },
    });
  } finally {
    if (previous.command === undefined) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = previous.command;
    if (previous.open === undefined) delete process.env.OPENCODE_API_KEY;
    else process.env.OPENCODE_API_KEY = previous.open;
  }
});

test('planned staff handoff tells both answer and review to keep the customer in this thread', async () => {
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  try {
    await queryAgent({
      question: 'Where is my shipment?', route: { area: 'shop', lane: 'shop', escalate: true },
      post: async (_url, body) => {
        assert.match(body.messages[0].content, /person from the Omi team will reply in this thread/i);
        assert.match(body.messages[0].content, /Don't tell the customer to contact support, email, use a contact form or post in another channel/i);
        return { data: { choices: [{ message: { content: '{"final_answer":"Check the tracking link.","confidence":0.8,"escalate":true}' } }] } };
      },
    });
    await reviewAnswer({
      question: 'Where is my shipment?', draft: 'Check the tracking link.',
      sources: '[S1 | Help]\nhttps://help.omi.me/shipping\nCheck the carrier tracking link.',
      lane: 'shop', handoffPlanned: true,
      post: async (_url, body) => {
        assert.match(body.messages[0].content, /person from the Omi team will reply in this thread/i);
        assert.match(body.messages[0].content, /Don't tell the customer to contact support, email, use a contact form or post in another channel/i);
        return { data: { choices: [{ message: { content: '{"final_answer":"Check the tracking link.","grounded":true,"relevant":true,"sources_used":["S1"]}' } }] } };
      },
    });
  } finally {
    if (previous === undefined) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = previous;
  }
});

test('each provider stage reports completion and reasoning tokens to its reply callback', async () => {
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  const events = [];
  const onUsage = (event) => events.push(event);
  const post = (content) => async () => ({ data: {
    choices: [{ message: { content } }],
    usage: { completion_tokens: 23, completion_tokens_details: { reasoning_tokens: 9 } },
  } });
  try {
    await planSearch({ question: 'How do I pair?', onUsage, post: post('{"standalone_question":"How do I pair?","search_queries":[]}') });
    await queryAgent({ question: 'How do I pair?', onUsage, post: post('{"final_answer":"Open the app.","confidence":0.8}') });
    await reviewAnswer({ question: 'How do I pair?', draft: 'Open the app.', lane: 'faq', onUsage,
      post: post('{"final_answer":"Open the app.","grounded":true,"relevant":true,"sources_used":[]}') });
    assert.deepEqual(events.map(({ stage, completionTokens, reasoningTokens }) => ({ stage, completionTokens, reasoningTokens })), [
      { stage: 'planner', completionTokens: 23, reasoningTokens: 9 },
      { stage: 'answer', completionTokens: 23, reasoningTokens: 9 },
      { stage: 'review', completionTokens: 23, reasoningTokens: 9 },
    ]);
  } finally {
    if (previous === undefined) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = previous;
  }
});

test('planner, answer and review redact customer identifiers before the provider sees them', async () => {
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  const privateText = 'Email ada@example.com; phone: 612 345 678; address: 12 Main Street; Order #22777; token user_123456789012345678901234.';
  const sent = [];
  const post = (content) => async (_url, body) => {
    sent.push(JSON.stringify(body.messages));
    return { data: { choices: [{ message: { content } }] } };
  };
  try {
    await planSearch({ question: privateText, threadHistory: [{ author: 'customer', content: privateText }], post: post('{"standalone_question":"Where is my order?","support_kind":"order_lookup"}') });
    await queryAgent({ question: privateText, threadHistory: [{ author: 'customer', content: privateText }], toolFacts: privateText, post: post('{"final_answer":"A person needs to check this.","confidence":0.8,"escalate":true}') });
    await reviewAnswer({ question: privateText, threadHistory: [{ author: 'customer', content: privateText }], draft: privateText, sources: privateText, understanding: { customerFacts: [privateText] }, lane: 'shop', post: post('{"final_answer":"A person needs to check this.","grounded":true,"relevant":true,"confidence":0.8,"sources_used":[]}') });
    assert.equal(sent.length, 3);
    for (const payload of sent) {
      assert.doesNotMatch(payload, /ada@example\.com|612 345 678|12 Main Street|#22777|user_123456789012345678901234/);
      assert.match(payload, /\[email\]/);
      assert.match(payload, /\[order number\]/);
    }
  } finally {
    if (previous === undefined) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = previous;
  }
});

test('provider redaction retains Omi’s public support address but not a customer email', async () => {
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  let sent = '';
  try {
    await queryAgent({
      question: 'My email is ada@example.com and my phone is 612 345 678',
      toolFacts: 'Official support contacts: help@omi.me and team@basedhardware.com.',
      post: async (_url, body) => {
        sent = JSON.stringify(body.messages);
        return { data: { choices: [{ message: { content: '{"final_answer":"Contact support","confidence":0.8,"escalate":false}' } }] } };
      },
    });
    assert.match(sent, /help@omi\.me/);
    assert.match(sent, /team@basedhardware\.com/);
    assert.doesNotMatch(sent, /ada@example\.com/);
    assert.doesNotMatch(sent, /612 345 678/);
  } finally {
    if (previous === undefined) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = previous;
  }
});

test('each provider response records model and token usage without logging content', async () => {
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  const events = [];
  const listener = (event) => events.push(event);
  process.on('omiSupportModelUsage', listener);
  try {
    await planSearch({ question: 'How do I pair Omi?', post: async () => ({ data: {
      model: 'test-model', usage: { prompt_tokens: 123, completion_tokens: 45, completion_tokens_details: { reasoning_tokens: 12 } },
      choices: [{ message: { content: '{"standalone_question":"How do I pair Omi?","support_kind":"official_information"}' } }],
    } }) });
    assert.deepEqual(events, [{ stage: 'planner', model: 'test-model', promptTokens: 123, completionTokens: 45, reasoningTokens: 12 }]);
  } finally {
    process.off('omiSupportModelUsage', listener);
    if (previous === undefined) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = previous;
  }
});

test('technical reviewer allows only cited official, reversible checks', () => {
  const help = '[S1 | Official Help Center]\nhttps://help.omi.me/en/articles/13154278-omi-necklace-issues\nRestart the app and phone.';
  const feedback = '[S2 | Omi Feedback portal]\nhttps://feedback.omi.me/p/example\nA customer suggested restarting.';
  assert.equal(technicalReviewSafety('Restart the app.', 'tech', help, ['S1']).safe, true);
  assert.equal(technicalReviewSafety('Restart the app.', 'tech', feedback, ['S2']).safe, false);
  assert.equal(technicalReviewSafety('Restart the app.', 'tech', help, []).safe, false);
  assert.equal(technicalReviewSafety('Reinstall the app, then try again.', 'tech', help, ['S1']).safe, false);
  assert.equal(technicalReviewSafety('Clear Pending recordings.', 'firmware', help, ['S1']).safe, false);
  assert.equal(technicalReviewSafety('Flash firmware.', 'firmware', help, ['S1']).safe, false);
});

test('technical safety gate does not append an English data warning to a non-English reply', () => {
  const result = technicalReviewSafety('Reinstall the app.', 'tech', '', [], {
    question: 'No se guardó el audio de mi reunión', language: 'es', dataLossRisk: true,
  });
  assert.equal(result.escalate, true);
  assert.doesNotMatch(result.answer, /Recordings may still be unsynced|Do not reinstall/i);
});

test('technical safety checks instruction structure, not stray action words', () => {
  const help = '[S1 | Official Help Center]\nhttps://help.omi.me/en/articles/app-issues\nCheck battery settings.';
  const docs = '[S2 | Official documentation]\nhttps://docs.omi.me/onboarding/firmware\nUpdate in the app.';
  const unchanged = [
    "I'm not sure what's causing this. Please tell me your app version and phone model so a person can check.",
    'The app keeps this conversation open until it syncs. Your app version and phone model would help.',
    'Do not reinstall the app or log out while recordings are unsynced.',
  ];
  for (const reply of unchanged) {
    const checked = technicalReviewSafety(reply, 'tech', '', []);
    assert.equal(checked.answer, reply);
    assert.equal(checked.escalate, false);
  }
  assert.equal(
    technicalReviewSafety('If that does not help, the team may suggest a reinstall later, so tell me your app version.', 'tech', '', []).escalate,
    true
  );
  const battery = 'You can check Battery Optimization and Background App Refresh. Source: https://help.omi.me/en/articles/app-issues';
  assert.equal(technicalReviewSafety(battery, 'tech', help, ['S1']).answer, battery);
  const firmware = 'Update the firmware in the app. Source: https://docs.omi.me/onboarding/firmware';
  assert.equal(technicalReviewSafety(firmware, 'firmware', docs, ['S2']).answer, firmware);
  const release = '[S99 | Official release note]\nhttps://github.com/BasedHardware/omi/releases/tag/v0.12.413\nVersion 0.12.413 fixes the microphone restart issue.';
  const update = 'Update to version 0.12.413, which fixes this.';
  assert.equal(technicalReviewSafety(update, 'tech', release, ['S99']).answer, update);
});

test('technical safety removes only unsupported instructions and warns on unsynced recordings', () => {
  const github = '[S1 | Official GitHub]\nhttps://github.com/BasedHardware/omi/issues/123\nCustomer report';
  const partial = technicalReviewSafety('Sorry about the crash. Clear the app cache, then restart the phone.', 'tech', github, ['S1']);
  assert.match(partial.answer, /Sorry about the crash/);
  assert.doesNotMatch(partial.answer, /Clear the app cache|restart the phone/i);
  assert.equal(partial.escalate, true);
  const unsynced = technicalReviewSafety('Reinstall the app to fix it.', 'tech', github, ['S1'], { question: 'sync is stuck at 40%' });
  assert.doesNotMatch(unsynced.answer, /^Reinstall the app/i);
  assert.match(unsynced.answer, /unsynced|not yet synced/i);
  assert.equal(unsynced.escalate, true);
  const onlyBad = technicalReviewSafety('Reinstall the app. Source: https://github.com/BasedHardware/omi/issues/123', 'tech', github, ['S1']);
  assert.equal(onlyBad.fallback, true);
  assert.doesNotMatch(onlyBad.answer, /Reinstall the app|github\.com/i);
});

test('unsafe actions are removed even in conditional or descriptive sentences', () => {
  const help = '[S1 | Official Help Center]\nhttps://help.omi.me/en/articles/sync\nKeep recordings safe.';
  const unsafe = [
    'If that does not work, reinstall the app.',
    'Then log out and log back in.',
    'Otherwise, clear Pending storage in Settings.',
    'After that, do a factory reset from the app.',
    'If it is still stuck, delete the app and install it again.',
    'Your best bet is to reinstall the app.',
    'Reinstalling the app usually fixes this.',
    'When it keeps failing, flash the firmware again from the docs.',
    'Uninstall the app and reinstall it.',
  ];
  for (const sentence of unsafe) {
    const checked = technicalReviewSafety(sentence, 'tech', help, ['S1'], { question: 'sync is stuck at 40%' });
    assert.equal(checked.escalate, true, sentence);
    assert.equal(checked.fallback, true, sentence);
    assert.doesNotMatch(checked.answer, new RegExp(sentence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), sentence);
    assert.match(checked.answer, /unsynced|not yet synced/i, sentence);
  }
  for (const sentence of [
    'Do not reinstall the app or log out while recordings are unsynced.',
    'Avoid reinstalling until a person checks.',
  ]) {
    const checked = technicalReviewSafety(sentence, 'tech', help, ['S1'], { question: 'sync is stuck at 40%' });
    assert.equal(checked.answer, sentence);
    assert.equal(checked.escalate, false);
  }
});

test('dropping an unsafe sentence preserves other bullets and paragraph breaks', () => {
  const answer = 'The recording is still on your phone.\n\n- Keep the app open.\n- If that fails, reinstall the app.\n- Tell a person the app version.\n\nPlease keep the device nearby.';
  const sources = '[S1 | Official Help Center]\nhttps://help.omi.me/en/articles/sync\nKeep the app open and device nearby.';
  const checked = technicalReviewSafety(answer, 'tech', sources, ['S1'], { question: 'sync is stuck at 40%' });
  assert.equal(checked.escalate, true);
  assert.doesNotMatch(checked.answer, /If that fails, reinstall the app/i);
  assert.match(checked.answer, /The recording is still on your phone\.\n\n- Keep the app open\.\n- Tell a person the app version\.\n\nPlease keep the device nearby\./);
});

test('reviewer timeout retries once with shorter evidence and never accepts the draft directly', async () => {
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-key';
  const inputs = [];
  try {
    const reviewed = await reviewAnswer({
      question: 'What happened?',
      draft: 'Unreviewed draft',
      lane: 'faq',
      policy: 'P'.repeat(5000),
      sources: `[S1 | Official Help Center]\nhttps://help.omi.me/example\n${'S'.repeat(13000)}`,
      post: async (_url, body) => {
        inputs.push(body.messages[1].content);
        if (inputs.length === 1) throw Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
        return { data: { choices: [{ message: { content: '{"final_answer":"A person needs to check.","grounded":true,"relevant":true,"escalate":true,"sources_used":[]}' } }] } };
      },
    });
    assert.equal(inputs.length, 2);
    assert.ok(inputs[1].length < inputs[0].length);
    assert.equal(reviewed.final_answer, 'A person needs to check.');
  } finally {
    if (previous === undefined) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = previous;
  }
});

test('a legacy provider key cannot silently select the old endpoint', async () => {
  const previous = { command: process.env.CMD_API_KEY, open: process.env.OPENCODE_API_KEY };
  delete process.env.CMD_API_KEY;
  process.env.OPENCODE_API_KEY = 'legacy-only-test-key';
  try {
    assert.equal(providerConfig().key, '');
    assert.equal(providerConfig().url, 'https://api.commandcode.ai/provider/v1/chat/completions');
    await assert.rejects(queryAgent({ question: 'Hi', post: async () => { throw new Error('must not call provider'); } }), /Missing CMD_API_KEY/);
  } finally {
    if (previous.command === undefined) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = previous.command;
    if (previous.open === undefined) delete process.env.OPENCODE_API_KEY;
    else process.env.OPENCODE_API_KEY = previous.open;
  }
});

test('parseAgentJson reads a fenced reply and a broken one', () => {
  const ok = parseAgentJson('```json\n{"final_answer":"Hold the button.","escalate":false,"confidence":0.8}\n```');
  assert.match(ok.final_answer, /Hold the button/);
  assert.equal(ok.escalate, false);
  const broken = parseAgentJson('{"final_answer": }');
  assert.equal(broken.reason, 'model json failed');
  assert.equal(broken.escalate, true);
});

test('search planning rewrites a follow-up into several source searches', async () => {
  const prev = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-key';
  try {
    const planned = await planSearch({
      question: 'How do I make one?',
      threadHistory: [{ author: 'customer', content: 'I need a developer API key.' }],
      route: { lane: 'faq', area: 'unknown' },
      post: async (_url, body) => {
        assert.equal(body.reasoning_effort, 'low');
        assert.match(body.messages[0].content, /Do not answer the customer/);
        assert.match(body.messages[1].content, /developer API key/);
        return {
          data: {
            choices: [
              {
                message: {
                  content:
                    '{"standalone_question":"How do I create an Omi developer API key?","conversation_summary":"The customer asked where to create a developer key.","message_kind":"question","customer_goal":"Create a developer API key","must_answer":["Where the key is created"],"customer_facts":["The customer needs a developer API key"],"support_kind":"official_information","search_queries":["create Omi API key","developer settings credentials"],"device":"","topic":"developer API"}',
                },
              },
            ],
          },
        };
      },
    });
    assert.match(planned.standaloneQuestion, /developer API key/);
    assert.equal(planned.queries.length, 2);
    assert.match(planned.customerGoal, /Create a developer API key/);
    assert.deepEqual(planned.mustAnswer, ['Where the key is created']);
    assert.equal(planned.supportKind, 'official_information');
    assert.equal(planned.messageKind, 'question');
    assert.match(planned.conversationSummary, /developer key/);
  } finally {
    if (prev == null) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = prev;
  }
});

test('contextual retrieval keeps human thread facts and drops prior bot wording', () => {
  const question = contextualQuestion('I am having the same problem too.', [
    { author: 'Jack', content: 'The battery jumps from 73% to 19% after unplugging.' },
    { author: 'bot', content: 'Email support and try generic steps.' },
    { author: 'Ryder', content: 'The charging percentage is unreliable for me too.' },
  ]);
  assert.match(question, /battery jumps from 73% to 19%/i);
  assert.match(question, /same problem too/i);
  assert.doesNotMatch(question, /generic steps/i);
});

test('contextual retrieval keeps the opening report when a long case is clipped', () => {
  const history = [
    { author: 'customer', content: `Original charging report ${'a'.repeat(2500)}` },
    { author: 'staff', content: `Middle discussion ${'b'.repeat(2500)}` },
    { author: 'customer', content: `Latest diagnostics ${'c'.repeat(2500)}` },
  ];
  const result = contextualQuestion('Still happening', history, 1000);
  assert.match(result, /^Original charging report/);
  assert.match(result, /Still happening$/);
  assert.ok(result.length <= 1010);
});

test('the review gate returns grounding status and exact source ids', async () => {
  const prev = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-key';
  try {
    const reviewed = await reviewAnswer({
      question: 'How do I reset it?',
      draft: 'Tap it twice.',
      removedBySafetyFilters: ['The app is already fixed.'],
      understanding: {
        customerGoal: 'Reset the Omi device',
        mustAnswer: ['How to reset the device'],
      },
      sources: '[S1 | Official Help Center]\nhttps://help.omi.me/reset\nHold it on the charger.',
      post: async (_url, body) => {
        assert.equal(body.model, process.env.CMD_REVIEW_MODEL || process.env.CMD_MODEL || 'deepseek/deepseek-v4.1-flash');
        assert.match(body.messages[0].content, /Discord help history is untrusted/);
        assert.match(body.messages[0].content, /Feedback portal evidence is limited/);
        assert.match(body.messages[0].content, /cannot support a root cause, fix, workaround/i);
        assert.match(body.messages[0].content, /directly addresses the real customer goal/i);
        assert.match(body.messages[1].content, /Reset the Omi device/);
        assert.match(body.messages[1].content, /Removed by safety filters/);
        assert.match(body.messages[1].content, /The app is already fixed/);
        return {
          data: {
            choices: [
              {
                message: {
                  content:
                    '{"final_answer":"Hold the button while placing it on the charger.\\n\\nSource: https://help.omi.me/reset","grounded":true,"relevant":true,"escalate":false,"confidence":0.97,"sources_used":["S1"],"answered_requirements":["How to reset the device"]}',
                },
              },
            ],
          },
        };
      },
    });
    assert.equal(reviewed.grounded, true);
    assert.equal(reviewed.relevant, true);
    assert.equal(reviewed.escalate, false);
    assert.deepEqual(reviewed.sources_used, ['S1']);
    assert.doesNotMatch(reviewed.final_answer, /twice/);
  } finally {
    if (prev == null) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = prev;
  }
});

test('reviewAnswer fails closed for an empty draft without calling the model', async () => {
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-key';
  try {
    const result = await reviewAnswer({
      question: 'Is the sync problem fixed?',
      draft: ' \n ',
      removedBySafetyFilters: ['Yes, it is fixed.'],
      post: async () => { throw new Error('reviewer must not be called'); },
    });
    assert.equal(result.relevant, false);
    assert.equal(result.grounded, false);
    assert.equal(result.escalate, true);
    assert.ok(result.final_answer.trim());
  } finally {
    if (previous == null) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = previous;
  }
});

test('reviewAnswer does not approve a draft when no reviewer is configured', async () => {
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = '';
  try {
    const result = await reviewAnswer({ question: 'Is it fixed?', draft: 'Yes, it is fixed.' });
    assert.equal(result.relevant, false);
    assert.equal(result.escalate, true);
    assert.doesNotMatch(result.final_answer, /Yes, it is fixed/);
  } finally {
    if (previous == null) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = previous;
  }
});

test('the review gate rejects a grounded but irrelevant answer', async () => {
  const prev = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-key';
  try {
    const reviewed = await reviewAnswer({
      question: 'Why is shipping at checkout €145?',
      draft: 'Use /order to check tracking.',
      understanding: {
        customerGoal: 'Ask whether a lower checkout shipping option is available',
        mustAnswer: ['Whether another shipping route can be arranged'],
      },
      policy: 'This is not an existing-order lookup. Do not suggest /order.',
      threadHistory: [
        { author: 'customer', content: 'Checkout shows €145 shipping.' },
        { author: 'bot', content: 'Use /order.' },
      ],
      sources: '',
      post: async (_url, body) => {
        assert.match(body.messages[1].content, /Earlier thread:\ncustomer: Checkout shows €145 shipping/);
        assert.match(body.messages[1].content, /Newest customer message:\nWhy is shipping/);
        return {
          data: {
            choices: [
              {
                message: {
                  content:
                    '{"final_answer":"I cannot verify a lower checkout route from the available information.","grounded":true,"relevant":false,"escalate":true,"confidence":0.3,"sources_used":[],"answered_requirements":[]}',
                },
              },
            ],
          },
        };
      },
    });
    assert.equal(reviewed.grounded, true);
    assert.equal(reviewed.relevant, false);
    assert.equal(reviewed.escalate, true);
    assert.doesNotMatch(reviewed.final_answer, /\/order/);
  } finally {
    if (prev == null) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = prev;
  }
});

test('planner parses an explicit human-request flag without treating text as truthy', () => {
  assert.equal(parseSearchPlan('{"standalone_question":"Help","wants_person":true}', 'Help').wantsPerson, true);
  assert.equal(parseSearchPlan('{"standalone_question":"Help","wants_person":"false"}', 'Help').wantsPerson, false);
});

test('planner parses data-loss risk only from a boolean true', () => {
  assert.equal(parseSearchPlan('{"standalone_question":"No audio was saved","data_loss_risk":true}', 'No audio was saved').dataLossRisk, true);
  assert.equal(parseSearchPlan('{"standalone_question":"How do I record?","data_loss_risk":"false"}', 'How do I record?').dataLossRisk, false);
});

test('parseSearchPlan clips and deduplicates unsafe output shape', () => {
  const parsed = parseSearchPlan(
    '{"standalone_question":"Pair Omi","customer_goal":"Pair the device","must_answer":["first","first","second"],"customer_facts":["has Omi"],"support_kind":"official_information","search_queries":["pairing","bluetooth","device setup","fourth","fifth"]}',
    'fallback'
  );
  assert.equal(parsed.queries.length, 4);
  assert.deepEqual(parsed.mustAnswer, ['first', 'second']);
  assert.deepEqual(parsed.customerFacts, ['has Omi']);
});

test('source lines can only use URLs from retrieved evidence blocks', () => {
  const answer = groundedSourceLine(
    'Hold the button.\n\nSource: https://docs.omi.me',
    '[Static fallback]\nhttps://docs.omi.me\n\n[S1 | Official Help Center]\nReset\nhttps://help.omi.me/en/articles/reset\nHold it.',
    ['S1']
  );
  assert.doesNotMatch(answer, /Source: https:\/\/docs\.omi\.me/);
  assert.match(answer, /Source: https:\/\/help\.omi\.me\/en\/articles\/reset/);
});

test('source formatting removes inline model citations and emits each chosen URL once', () => {
  const answer = groundedSourceLine(
    'The report is still open. Source: [link](https://help.omi.me/reset) Source: https://help.omi.me/reset',
    '[S1 | Official Help Center]\nReset\nhttps://help.omi.me/reset\nHold it.',
    ['S1', 'S1']
  );
  assert.equal((answer.match(/Source:/g) || []).length, 1);
  assert.equal((answer.match(/https:\/\/help\.omi\.me\/reset/g) || []).length, 1);
});

test('localized source labels stay localized and never gain an English Source line', () => {
  const evidence = '[S1 | Official Help Center]\nhttps://help.omi.me/reset\nReset instructions.';
  for (const [language, label] of [['es', 'Fuente'], ['de', 'Quelle'], ['pt', 'Fonte'], ['tr', 'Kaynak']]) {
    const answer = groundedSourceLine(`Respuesta útil.\n\n${label}: https://help.omi.me/reset`, evidence, ['S1'], language);
    assert.equal((answer.match(/https:\/\/help\.omi\.me\/reset/g) || []).length, 1, language);
    assert.match(answer, new RegExp(`\\b${label}:`), language);
    assert.doesNotMatch(answer, /\bSource:/i, language);
  }
});

test('Chinese, Korean, and Russian replies retain exactly one localized source line', () => {
  const evidence = '[S1 | Official Help Center]\nhttps://help.omi.me/en/articles/delete-one\nDelete one item.';
  for (const [language, label] of [['zh', '来源'], ['ko', '출처'], ['ru', 'Источник']]) {
    const answer = groundedSourceLine(`这里是回答。\n\n${label}: https://help.omi.me/en/articles/delete-one`, evidence, ['S1'], language);
    assert.equal((answer.match(/https:\/\/help\.omi\.me\/en\/articles\/delete-one/g) || []).length, 1, language);
    assert.equal((answer.match(new RegExp(`${label}:`, 'g')) || []).length, 1, language);
    assert.doesNotMatch(answer, /\bSource:/i, language);
  }
});

test('an unfamiliar localized source label is replaced instead of duplicated', () => {
  const evidence = '[S1 | Official Help Center]\nhttps://help.omi.me/en/articles/delete-one\nDelete one item.';
  const answer = groundedSourceLine('Risposta utile.\n\nRiferimenti: https://help.omi.me/en/articles/delete-one', evidence, ['S1'], 'it');
  assert.equal((answer.match(/Riferimenti:/g) || []).length, 1);
  assert.equal((answer.match(/https:\/\/help\.omi\.me\/en\/articles\/delete-one/g) || []).length, 1);
});

test('FAQ review may use lower-ranked team product facts without treating them as tech troubleshooting', async () => {
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-key';
  try {
    const reply = await reviewAnswer({
      question: 'Does 24 hours mean recording with the app closed?',
      draft: 'The 24-hour figure is battery life, not standalone recording time.',
      lane: 'faq',
      sources: '[Static fallback | lower priority than Help Center and docs]\nThe 24-hour figure is battery life, not standalone recording time.',
      post: async (_url, body) => {
        assert.match(body.messages[0].content, /static product facts are usable below the Help Center and docs/i);
        return { data: { choices: [{ message: { content: JSON.stringify({
          final_answer: 'The 24-hour figure is battery life, not standalone recording time.',
          grounded: true, relevant: true, escalate: false, confidence: 0.9, sources_used: [],
        }) } }] } };
      },
    });
    assert.equal(reply.grounded, true);
    assert.match(reply.final_answer, /battery life, not standalone recording time/);
  } finally {
    if (previous === undefined) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = previous;
  }
});

test('a bad model JSON is tried once more, and a usage limit is not', async () => {
  const prev = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-key';
  try {
    let calls = 0;
    const parsed = await queryAgent({
      question: 'How do I turn it off?',
      route: { lane: 'faq', area: 'unknown' },
      post: async () => {
        calls += 1;
        if (calls === 1) return { data: { choices: [{ message: { content: '{"final_answer":' } }] } };
        return {
          data: {
            choices: [{ message: { content: '{"final_answer":"Hold the button for about 3 seconds.","escalate":false}' } }],
          },
        };
      },
    });
    assert.equal(calls, 2);
    assert.match(parsed.final_answer, /3 seconds/);

    let limited = 0;
    await assert.rejects(
      () =>
        queryAgent({
          question: 'How do I turn it off?',
          route: { lane: 'faq' },
          post: async () => {
            limited += 1;
            const err = new Error('limited');
            err.response = { status: 429, data: { error: { message: 'Go usage limit exceeded' } } };
            throw err;
          },
        }),
      /CommandCode HTTP 429/
    );
    assert.equal(limited, 1);
  } finally {
    if (prev == null) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = prev;
  }
});
