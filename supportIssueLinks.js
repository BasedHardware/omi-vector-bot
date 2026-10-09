const supportCases = require('./supportCases');

function id(value, required = true) {
  const result = String(value || '').trim();
  if ((!result && required) || (result && !/^[A-Za-z0-9_.:-]{1,128}$/.test(result))) throw new Error('Invalid issue link identifier');
  return result || null;
}

function repository(value) {
  const result = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,99}\/[a-z0-9._-]{1,100}$/.test(result)) throw new Error('Invalid issue link repository');
  return result;
}

function number(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid issue number');
  return value;
}

function record(row) {
  if (!row) return null;
  return { repo: row.repo, issueNumber: Number(row.issue_number), caseId: row.case_id, customerId: row.customer_id,
    channelId: row.channel_id, threadId: row.thread_id, sourceMessageId: row.source_message_id, approvedBy: row.approved_by, createdAt: row.created_at };
}

async function initSchema(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS support_issue_links (
    repo TEXT NOT NULL, case_id TEXT NOT NULL, issue_number INTEGER NOT NULL CHECK (issue_number > 0),
    customer_id TEXT NOT NULL, channel_id TEXT NOT NULL, thread_id TEXT, source_message_id TEXT NOT NULL,
    approved_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (repo, case_id, source_message_id)
  );
  DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='support_issue_links'::regclass
      AND conname='support_issue_links_pkey' AND cardinality(conkey)=2) THEN
      ALTER TABLE support_issue_links DROP CONSTRAINT support_issue_links_pkey;
      ALTER TABLE support_issue_links ADD CONSTRAINT support_issue_links_pkey PRIMARY KEY(repo,case_id,source_message_id);
    END IF;
  END $$;
  CREATE INDEX IF NOT EXISTS support_issue_links_target_idx ON support_issue_links(repo, issue_number);`);
}

function createPostgresStore(client) {
  return {
    async link(input) {
      const { rows } = await client.query(`INSERT INTO support_issue_links
        (repo, case_id, issue_number, customer_id, channel_id, thread_id, source_message_id, approved_by)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8 FROM support_cases c
        WHERE c.id=$2 AND c.customer_id=$4
          AND $5=ANY(ARRAY[c.channel_id,c.customer_thread_id,c.handoff_thread_id])
          AND ($6::text IS NULL OR $6=ANY(ARRAY[c.channel_id,c.customer_thread_id,c.handoff_thread_id]))
        ON CONFLICT (repo,case_id,source_message_id) DO UPDATE SET case_id=EXCLUDED.case_id
          WHERE support_issue_links.issue_number=EXCLUDED.issue_number
            AND support_issue_links.customer_id=EXCLUDED.customer_id
            AND support_issue_links.channel_id=EXCLUDED.channel_id
            AND support_issue_links.thread_id IS NOT DISTINCT FROM EXCLUDED.thread_id
        RETURNING *`, [input.repo, input.caseId, input.issueNumber, input.customerId, input.channelId, input.threadId, input.sourceMessageId, input.approvedBy]);
      if (!rows.length) throw new Error('issue_link_ownership_or_target_conflict');
      return record(rows[0]);
    },
    async findForCase(caseId, repo) {
      const { rows } = await client.query('SELECT * FROM support_issue_links WHERE case_id=$1 AND repo=$2 LIMIT 2', [caseId, repo]);
      return rows.length === 1 ? record(rows[0]) : null;
    },
    async findForSource(caseId, repo, sourceMessageId) {
      const { rows } = await client.query('SELECT * FROM support_issue_links WHERE case_id=$1 AND repo=$2 AND source_message_id=$3', [caseId, repo, sourceMessageId]);
      return record(rows[0]);
    },
    async listForCase(caseId, repo) {
      const { rows } = await client.query('SELECT * FROM support_issue_links WHERE case_id=$1 AND repo=$2 ORDER BY created_at', [caseId, repo]);
      return rows.map(record);
    },
    async listForThread(caseId, repo, threadId) {
      const { rows } = await client.query('SELECT * FROM support_issue_links WHERE case_id=$1 AND repo=$2 AND thread_id=$3 ORDER BY created_at', [caseId, repo, threadId]);
      return rows.map(record);
    },
    async listForIssue(repo, issueNumber) {
      const { rows } = await client.query('SELECT * FROM support_issue_links WHERE repo=$1 AND issue_number=$2 ORDER BY created_at', [repo, issueNumber]);
      return rows.map(record);
    },
  };
}

function createMemoryStore(state = { links: new Map() }) {
  const clone = (value) => value ? JSON.parse(JSON.stringify(value)) : null;
  return {
    state,
    async link(input) {
      const key = JSON.stringify([input.repo, input.caseId, input.sourceMessageId]);
      const existing = state.links.get(key);
      if (existing) {
        if (['issueNumber', 'customerId', 'channelId', 'threadId'].some((field) => existing[field] !== input[field])) throw new Error('issue_link_ownership_or_target_conflict');
        return clone(existing);
      }
      const value = { ...input, createdAt: new Date().toISOString() };
      state.links.set(key, value);
      return clone(value);
    },
    async findForCase(caseId, repo) {
      const matches = [...state.links.values()].filter((value) => value.caseId === caseId && value.repo === repo);
      return matches.length === 1 ? clone(matches[0]) : null;
    },
    async findForSource(caseId, repo, sourceMessageId) { return clone(state.links.get(JSON.stringify([repo, caseId, sourceMessageId]))); },
    async listForCase(caseId, repo) { return [...state.links.values()].filter((value) => value.caseId === caseId && value.repo === repo).map(clone); },
    async listForThread(caseId, repo, threadId) { return [...state.links.values()].filter((value) => value.caseId === caseId && value.repo === repo && value.threadId === threadId).map(clone); },
    async listForIssue(repo, issueNumber) { return [...state.links.values()].filter((value) => value.repo === repo && value.issueNumber === issueNumber).map(clone); },
  };
}

function createIssueLinkService(store, { getCase = supportCases.getCaseById } = {}) {
  return {
    async link(input) {
      const value = { repo: repository(input.repo), issueNumber: number(input.issueNumber), caseId: id(input.caseId),
        customerId: id(input.customerId), channelId: id(input.channelId), threadId: id(input.threadId, false),
        sourceMessageId: id(input.sourceMessageId), approvedBy: id(input.approvedBy) };
      const owner = await getCase(value.caseId);
      const channels = owner ? [owner.channelId, owner.customerThreadId, owner.handoffThreadId].filter(Boolean) : [];
      if (!owner || owner.customerId !== value.customerId || !channels.includes(value.channelId) || (value.threadId && !channels.includes(value.threadId))) throw new Error('issue_link_ownership_or_target_conflict');
      return store.link(value);
    },
    findForCase: (caseId, repo) => store.findForCase(id(caseId), repository(repo)),
    findForSource: (caseId, repo, sourceMessageId) => store.findForSource(id(caseId), repository(repo), id(sourceMessageId)),
    listForCase: (caseId, repo) => store.listForCase(id(caseId), repository(repo)),
    listForThread: (caseId, repo, threadId) => store.listForThread(id(caseId), repository(repo), id(threadId)),
    listForIssue: (repo, issueNumber) => store.listForIssue(repository(repo), number(issueNumber)),
  };
}

let injected;
const memory = createMemoryStore();
let postgres;
function service() {
  if (injected) return injected;
  if (!process.env.DATABASE_URL) return createIssueLinkService(memory);
  if (!postgres) postgres = createPostgresStore(require('./db').pool);
  return createIssueLinkService(postgres);
}

module.exports = {
  initSchema, createPostgresStore, createMemoryStore, createIssueLinkService,
  setStoreForTests: (store, options) => { injected = store ? createIssueLinkService(store, options) : null; },
  ...Object.fromEntries(['link', 'findForCase', 'findForSource', 'listForCase', 'listForThread', 'listForIssue'].map((name) => [name, (...args) => service()[name](...args)])),
};
