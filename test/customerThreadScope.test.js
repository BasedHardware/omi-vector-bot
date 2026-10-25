const test = require('node:test');
const assert = require('node:assert/strict');
const {isDedicatedCustomerThread} = require('../customerThreadScope');
const value = {id:'case-a',customerId:'customer-a',customerThreadId:'post-a',handoffThreadId:'handoff-a'};

test('customer and handoff thread proof always uses an unfiltered unique case lookup', async () => {
  for (const id of ['post-a','handoff-a']) {
    const calls = [];
    const cases = {getCaseByThread:async(...args)=>{calls.push(args);return value;}};
    assert.equal(await isDedicatedCustomerThread({id,ownerId:'customer-a',isThread:()=>true},value,{cases}),true);
    assert.deepEqual(calls,[[id]]);
  }
});

test('ambiguous, wrong-case and wrong-owner lookup results fail closed', async () => {
  for (const result of [null,{...value,id:'case-b'},{...value,customerId:'customer-b'}]) {
    for (const id of ['post-a','handoff-a']) {
      assert.equal(await isDedicatedCustomerThread({id,ownerId:'customer-a',isThread:()=>true},value,
        {cases:{getCaseByThread:async()=>result}}),false);
    }
  }
});

test('missing or unavailable uniqueness observation is not permission to stage or broadcast', async () => {
  const channel = {id:'post-a',ownerId:'customer-a',isThread:()=>true};
  assert.equal(await isDedicatedCustomerThread(channel,value,{cases:{}}),false);
  assert.equal(await isDedicatedCustomerThread(channel,value,{cases:{getCaseByThread:async()=>{throw Error('synthetic unavailable');}}}),false);
});

test('ordinary, mismatched and unowned customer channels cannot reach uniqueness lookup', async () => {
  const cases = {getCaseByThread:async()=>assert.fail('invalid destination must be rejected first')};
  for (const channel of [
    {id:'post-a',ownerId:'customer-a',isThread:()=>false},
    {id:'other-post',ownerId:'customer-a',isThread:()=>true},
    {id:'post-a',ownerId:'customer-b',isThread:()=>true},
  ]) assert.equal(await isDedicatedCustomerThread(channel,value,{cases}),false);
});
