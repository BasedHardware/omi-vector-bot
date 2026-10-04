const { relevantDocs, newDocsLookupCache } = require('./docs');
const { supportQueries, mergeEvidenceUnique } = require('./retrieval');

function startDocsRetrieval(customerQuestion, lookup = relevantDocs) {
  const cache = newDocsLookupCache();
  const originalQueries = new Set(supportQueries(customerQuestion));
  const initial = lookup(customerQuestion, { lookupCache: cache });
  return async (contextQuestion, plannedQueries = []) => {
    const additional = supportQueries(contextQuestion, plannedQueries)
      .filter((query) => !originalQueries.has(query));
    if (!additional.length) return initial;
    const expanded = lookup(contextQuestion, { queries: additional, lookupCache: cache });
    return mergeEvidenceUnique(await expanded, await initial);
  };
}

module.exports = { startDocsRetrieval };
