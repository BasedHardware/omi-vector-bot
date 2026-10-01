const memory = new Map();

async function recordRating(threadId, userId, helped) {
  const thread = String(threadId || '');
  const user = String(userId || '');
  const yes = Boolean(helped);
  if (process.env.DATABASE_URL) {
    const db = require('./db');
    await db.saveRating(thread, user, yes);
    return db.ratingCounts();
  }
  if (thread) memory.set(thread, yes);
  return memoryCounts();
}

function memoryCounts() {
  let yes = 0;
  let no = 0;
  for (const helped of memory.values()) {
    if (helped) yes += 1;
    else no += 1;
  }
  return { yes, no };
}

async function ratingCounts() {
  if (process.env.DATABASE_URL) {
    try {
      return await require('./db').ratingCounts();
    } catch (err) {
      console.error('[Bot] rating count failed:', err.message);
    }
  }
  return memoryCounts();
}

function resetRatings() {
  memory.clear();
}

module.exports = { recordRating, ratingCounts, resetRatings };
