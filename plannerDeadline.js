// The optional planner may improve retrieval; it must not hold the answer hostage.
const PLANNER_DEADLINE_MS = 20_000;

function runPlannerWithDeadline(task, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimer(() => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      const error = Object.assign(new Error('Planner deadline reached'), { code: 'PLANNER_DEADLINE' });
      reject(error);
      controller.abort();
    }, PLANNER_DEADLINE_MS);
    timer.unref?.();
    const finish = (complete, value) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      complete(value);
    };
    // Both outcomes are observed even when an adapter ignores cancellation.
    // Late plans cannot replace the deterministic plan or trigger an unhandled rejection.
    Promise.resolve().then(() => task({ signal: controller.signal, timeoutMs: PLANNER_DEADLINE_MS }))
      .then(value => finish(resolve, value), error => finish(reject, error));
  });
}

module.exports = { runPlannerWithDeadline, PLANNER_DEADLINE_MS };
