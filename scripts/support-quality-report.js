// Operator-only, read-only aggregate report. No messages, IDs, credentials,
// prompts, model calls or automatic knowledge publication leave this command.
require('dotenv').config({ quiet: true });
const { configFromEnv } = require('../supportMemory');

async function report() {
  const config = configFromEnv();
  if (!config.enabled) return { status: 'disabled', coverage: 'No new retained support history or quality events are enabled.' };
  const pool = require('../db').pool;
  try {
    const outcomes = await require('../supportMemoryStore').createPostgresStore(pool).report(Date.now());
    return { status: 'ok', retentionDays: config.retentionDays,
      coverage: 'New observed events in approved support forums only; counts are events, not a resolution-rate estimate.',
      outcomes, improvements: require('../supportLearning').improvementCandidates(outcomes) };
  } finally { await pool.end(); }
}

if (require.main === module) report().then(value => console.log(JSON.stringify(value, null, 2))).catch(() => {
  console.error(JSON.stringify({ status: 'unavailable', code: 'quality_report_failed' })); process.exitCode = 1;
});
module.exports = { report };
