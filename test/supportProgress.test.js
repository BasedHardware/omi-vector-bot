const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ledger = require('../docs/SUPPORT_PROGRESS.json');
const plan = fs.readFileSync(path.join(root, 'docs/SUPPORT_MASTER_PLAN.md'), 'utf8');

test('the fixed support progress rubric keeps 25 distinct milestone IDs and ordered evidence gates', () => {
  assert.deepEqual(ledger.milestones.map(row => row.id), Array.from({ length: 25 }, (_, i) => i + 1));
  assert.match(ledger.auditedMain, /^[a-f0-9]{40}$/);
  assert.equal(ledger.notAccuracy, true);
  for (const row of ledger.milestones) {
    for (const key of ['onMain', 'tested', 'reviewed', 'liveVerified']) assert.equal(typeof row[key], 'boolean');
    assert.ok(!row.tested || row.onMain);
    assert.ok(!row.reviewed || row.tested);
    assert.ok(!row.liveVerified || row.reviewed);
    assert.ok(row.evidence.length > 30);
  }
});

test('support dashboard totals are calculated from the evidence ledger, not PR counts', () => {
  const totals = ['onMain', 'tested', 'reviewed', 'liveVerified'].map(key => ledger.milestones.filter(row => row[key]).length);
  const done = totals.reduce((sum, count) => sum + count, 0);
  assert.match(plan, new RegExp(`## Current score — ${done} / 100 done, ${100 - done} / 100 left`));
  assert.ok(plan.includes(`${totals[0]} main + ${totals[1]} tested + ${totals[2]} reviewed + ${totals[3]} verified operations`));
  assert.match(plan, /not answer accuracy/);
});

test('implemented support milestones point to existing repository sources and the archive stays linked', () => {
  for (const row of ledger.milestones.filter(row => row.onMain)) {
    assert.ok(row.source && fs.existsSync(path.join(root, row.source)), `missing source for milestone ${row.id}`);
  }
  for (const file of ['SUPPORT_MASTER_PLAN_HISTORY_2026-10-25.md', 'SUPPORT_ISSUE_AUDIT_2026-10-25.md', 'SUPPORT_PROGRESS.json']) {
    assert.ok(plan.includes(file));
    assert.ok(fs.existsSync(path.join(root, 'docs', file)));
  }
});

test('all 21 A–E acceptance requirements remain distinct and unmerged work does not complete them', () => {
  const items = [...plan.matchAll(/^- \[([ x])\] \*\*([A-E]\d) —/gm)];
  assert.equal(items.length, 21);
  assert.equal(new Set(items.map(match => match[2])).size, 21);
  assert.deepEqual(items.filter(match => match[1] === 'x').map(match => match[2]), ['A3', 'B1']);
  assert.match(plan, /Receipt lifecycle approved October26/);
  assert.match(plan, /No memory flag until notice approval/);
});
