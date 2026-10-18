// Reads result JSONs only. Never pass a protected input/case file to this tool.
const fs = require('node:fs');
const path = require('node:path');

const segmenter = new Intl.Segmenter('und', { granularity: 'word' });
function wordCount(text) {
  return [...segmenter.segment(String(text || '').replace(/https?:\/\/\S+/g, 'link'))].filter(part => part.isWordLike).length;
}
function percentile(values, pct) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * pct / 100) - 1)] : null;
}
function keyed(result) {
  const rows = new Map();
  for (const row of result.rows || []) {
    const key = JSON.stringify([row.id, row.run]);
    if (rows.has(key)) throw Error('Duplicate case/run result');
    rows.set(key, row);
  }
  return rows;
}
function projected(row) {
  return { reply: row.reply, turnReplies: row.turnReplies || [row.reply], handoff: row.handoff,
    pass: row.pass, invalid: Boolean(row.invalid), problems: row.problems || [],
    escalationSignals: row.escalationSignals || [],
    signalCoverage: Array.isArray(row.escalationSignals) ? 'captured' : 'unavailable',
    latencyMs: row.latencyMs, timings: row.timings || {} };
}
function armSummary(rows) {
  const groups = new Map();
  for (const row of rows) {
    const group = groups.get(row.id) || [];
    group.push(row); groups.set(row.id, group);
  }
  const summary = { rows: rows.length, cases: groups.size, passBoth: 0, flaky: 0, failBoth: 0, unscoredCases: 0,
    handoffs: rows.filter(row => row.handoff).length, invalidRows: rows.filter(row => row.invalid).length,
    unwantedHandoffs: rows.filter(row => row.problems?.includes('unwanted handoff')).length,
    missingHandoffs: rows.filter(row => row.problems?.includes('missing handoff')).length };
  for (const group of groups.values()) {
    if (group.some(row => row.invalid || typeof row.pass !== 'boolean')) summary.unscoredCases++;
    else if (group.every(row => row.pass)) summary.passBoth++;
    else if (group.some(row => row.pass)) summary.flaky++;
    else summary.failBoth++;
  }
  summary.latency = Object.fromEntries(['planner', 'retrieval', 'answer', 'review', 'total'].map(stage => {
    const values = rows.map(row => row.timings?.[stage] ?? (stage === 'total' ? row.latencyMs : NaN));
    return [stage, { p50: percentile(values, 50), p95: percentile(values, 95) }];
  }));
  return summary;
}
function words(rows) {
  const turns = rows.flatMap(row => row.turnReplies || [row.reply]);
  const count = values => ({ count: values.length, median: percentile(values, 50), p90: percentile(values, 90) });
  return { deliveredTurns: count(turns.filter(text => String(text || '').trim()).map(wordCount)),
    emptyTurns: turns.filter(text => !String(text || '').trim()).length,
    finalReplies: count(rows.filter(row => String(row.reply || '').trim()).map(row => wordCount(row.reply))) };
}
function compareResults(main, candidate) {
  const left = keyed(main), right = keyed(candidate);
  if (!left.size || left.size !== right.size || [...left.keys()].some(key => !right.has(key))) throw Error('Both arms must have the same case/run rows');
  const changed = new Set([...left].filter(([key, row]) => row.pass !== right.get(key).pass || row.handoff !== right.get(key).handoff).map(([, row]) => row.id));
  const cases = [...changed].map(id => ({ id, runs: [...left].filter(([, row]) => row.id === id).sort((a, b) => a[1].run - b[1].run)
    .map(([key, row]) => ({ run: row.run, changed: row.pass !== right.get(key).pass || row.handoff !== right.get(key).handoff,
      main: projected(row), candidate: projected(right.get(key)) })) }));
  const summary = { main: armSummary([...left.values()]), candidate: armSummary([...right.values()]),
    changedCases: cases.length, readyForGrading: !main.incomplete && !candidate.incomplete &&
      [...left.values(), ...right.values()].every(row => !row.invalid && typeof row.pass === 'boolean'),
    note: 'Structural flags are not factual/safety approval. No rows are excluded; independent grading is required.' };
  return { summary, cases, wordCounts: {
    method: 'Intl.Segmenter word-like tokens; each URL counts as one word; delivered turns exclude empty replies, which are counted separately. Median/p90 use nearest rank.',
    main: words([...left.values()]), candidate: words([...right.values()]),
  } };
}

if (require.main === module) {
  const [mainPath, candidatePath, outputDirectory] = process.argv.slice(2);
  if (!mainPath || !candidatePath || !outputDirectory) throw Error('Usage: compare-support-eval MAIN_RESULT.json CANDIDATE_RESULT.json OUTPUT_DIRECTORY');
  const report = compareResults(JSON.parse(fs.readFileSync(mainPath, 'utf8')), JSON.parse(fs.readFileSync(candidatePath, 'utf8')));
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const [name, data] of [['comparison-summary', report.summary], ['per-case-comparison', report.cases], ['word-counts', report.wordCounts]]) {
    fs.writeFileSync(path.join(outputDirectory, `${name}.json`), JSON.stringify(data, null, 2) + '\n');
  }
  console.log(JSON.stringify({ changedCases: report.cases.length, readyForGrading: report.summary.readyForGrading }));
}

module.exports = { compareResults, wordCount };
