// Mandatory metadata retention, not publication or a conversation observer.
// It remains available with both the inbox and memory switches off.
function createKnowledgeCleanup({ store, track = operation => operation(), now = Date.now,
  stopping = () => false, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (!store?.pruneExpiredProvenance) throw Error('A provenance cleanup store is required');
  let started = false, stopped = false, timer, pending;
  const unavailable = () => stopped || stopping();
  function schedule(delay) {
    if (unavailable()) return;
    timer = setTimer(() => { timer = undefined; run(); }, delay);
    timer.unref?.();
  }
  function run() {
    if (!started || unavailable()) return Promise.resolve(null);
    if (pending) return pending;
    if (timer) { clearTimer(timer); timer = undefined; }
    let nextDelay = 60000;
    pending = Promise.resolve().then(() => {
      if (unavailable()) return null;
      return track(() => store.pruneExpiredProvenance(now(), { shouldStop: unavailable }));
    }).then(result => {
      if (result?.remaining) nextDelay = 250;
      return result;
    }).catch(() => {
      console.error('[KnowledgeReview] retention cleanup unavailable; pending retry');
      return null;
    }).finally(() => { pending = null; schedule(nextDelay); });
    return pending;
  }
  return {
    start() { if (started) return pending || Promise.resolve(null); started = true; return run(); },
    run,
    stop() { stopped = true; if (timer) clearTimer(timer); timer = undefined; },
  };
}

module.exports = { createKnowledgeCleanup };
