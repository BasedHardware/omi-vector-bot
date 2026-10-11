const { createHash } = require('node:crypto');
const cases = require('./supportCases');
const NO_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false };
const STATUS_LABELS = { queued: 'Handoff pending', delivered: 'Awaiting staff acceptance', accepted: 'Accepted · not started', resolved: 'Resolved', closed: 'Closed' };
const WORK_LABELS = { in_progress: 'In progress', waiting_customer: 'Waiting for customer' };
const ACCEPTANCE_COPY = {
  en: p => `${p} from Omi support has picked up your case. Please keep any follow-up in this thread.`,
  es: p => `${p} del equipo de soporte de Omi se ha hecho cargo de tu caso. Continúa en este hilo con cualquier información adicional.`,
  zh: p => `${p} 已接手你的 Omi 支持请求。后续补充信息请继续发在这个讨论串。`,
  it: p => `${p} del supporto Omi ha preso in carico la tua richiesta. Continua in questa conversazione per eventuali aggiornamenti.`,
  pt: p => `${p} da equipe de suporte Omi assumiu seu caso. Continue nesta conversa com qualquer informação adicional.`,
  fr: p => `${p} du support Omi a pris en charge votre demande. Continuez dans ce fil pour toute information complémentaire.`,
  de: p => `${p} vom Omi-Support hat deinen Fall übernommen. Bitte schreibe weitere Informationen in diesen Thread.`,
  tr: p => `${p}, Omi destek ekibinden, talebinizi üstlendi. Ek bilgileri bu başlıkta paylaşabilirsiniz.`,
  id: p => `${p} dari tim dukungan Omi sudah menangani kasusmu. Silakan lanjutkan informasi tambahan di utas ini.`,
  ja: p => `Omiサポートの ${p} がこの件を担当します。追加情報は引き続きこのスレッドにお送りください。`,
  ko: p => `Omi 지원팀의 ${p} 님이 이 요청을 맡았습니다. 추가 정보는 이 스레드에 남겨 주세요.`,
  ru: p => `${p} из поддержки Omi принял ваше обращение. Дополнительную информацию отправляйте в этой ветке.`,
  'hi-Latn': p => `Omi support ke ${p} ne aapka mamla le liya hai. Aage ki jaankari isi thread mein bhejein.`,
  'hi-Deva': p => `Omi सहायता टीम के ${p} ने आपका मामला संभाल लिया है। आगे की जानकारी इसी थ्रेड में भेजें।`,
};
const version = value => [value.status, value.workStatus || '', value.acceptedBy || '', String(value.acceptedAt || ''), String(value.updatedAt || '')].join('|');
const plain = value => value?.toJSON ? value.toJSON() : JSON.parse(JSON.stringify(value?.data || value));
const fieldCase = message => (message?.embeds || []).flatMap(e => plain(e)?.fields || []).find(f => f.name === 'Case')?.value;

async function initSchema(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS support_case_cards (
    case_id TEXT NOT NULL REFERENCES support_cases(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL, message_id TEXT NOT NULL,
    synced_at TIMESTAMPTZ, synced_status TEXT, synced_work_status TEXT, synced_accepted_by TEXT,
    PRIMARY KEY (case_id, message_id)
  ); CREATE INDEX IF NOT EXISTS support_case_cards_case_idx ON support_case_cards(case_id);`);
}

function createMemoryStore(state = { cards: new Map(), locks: new Map() }) {
  return {
    state,
    async remember(caseId, channelId, messageId) {
      const key = `${caseId}:${messageId}`;
      if (!state.cards.has(key)) state.cards.set(key, { caseId, channelId, messageId });
    },
    async list(caseId) { return [...state.cards.values()].filter(c => c.caseId === caseId).map(c => ({ ...c })); },
    async forget(caseId, messageId) { state.cards.delete(`${caseId}:${messageId}`); },
    async synced(card, value) { const row = state.cards.get(`${card.caseId}:${card.messageId}`); if (row) row.version = version(value); },
    async dirty(service, limit) {
      const ids = [...new Set([...state.cards.values()].map(c => c.caseId))]; const result = [];
      for (const id of ids) {
        const value = await service.getCaseById(id);
        if (value && [...state.cards.values()].some(c => c.caseId === id && c.version !== version(value))) result.push(id);
        if (result.length >= limit) break;
      }
      return result;
    },
    async lock(caseId, work) {
      const prior = state.locks.get(caseId) || Promise.resolve();
      const running = prior.catch(() => {}).then(() => work()); state.locks.set(caseId, running);
      try { return await running; } finally { if (state.locks.get(caseId) === running) state.locks.delete(caseId); }
    },
  };
}

function createPostgresStore(pool) {
  return {
    async remember(caseId, channelId, messageId) {
      await pool.query(`INSERT INTO support_case_cards (case_id, channel_id, message_id) VALUES ($1,$2,$3)
        ON CONFLICT (case_id, message_id) DO NOTHING`, [caseId, channelId, messageId]);
    },
    async list(caseId, connection = pool) {
      const { rows } = await connection.query('SELECT case_id, channel_id, message_id FROM support_case_cards WHERE case_id=$1', [caseId]);
      return rows.map(r => ({ caseId: r.case_id, channelId: r.channel_id, messageId: r.message_id }));
    },
    async forget(caseId, messageId, connection = pool) { await connection.query('DELETE FROM support_case_cards WHERE case_id=$1 AND message_id=$2', [caseId, messageId]); },
    async synced(card, value, connection = pool) {
      await connection.query(`UPDATE support_case_cards SET synced_at=$3, synced_status=$4, synced_work_status=$5, synced_accepted_by=$6
        WHERE case_id=$1 AND message_id=$2`, [card.caseId, card.messageId, value.updatedAt, value.status, value.workStatus, value.acceptedBy]);
    },
    async dirty(_service, limit) {
      const { rows } = await pool.query(`SELECT DISTINCT c.case_id FROM support_case_cards c JOIN support_cases s ON s.id=c.case_id
        WHERE c.synced_at IS NULL OR s.updated_at > c.synced_at OR s.status IS DISTINCT FROM c.synced_status
          OR s.work_status IS DISTINCT FROM c.synced_work_status OR s.accepted_by IS DISTINCT FROM c.synced_accepted_by LIMIT $1`, [limit]);
      return rows.map(r => r.case_id);
    },
    async lock(caseId, work) {
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        await connection.query("SET LOCAL lock_timeout='5s'");
        await connection.query('SELECT pg_advisory_xact_lock(912857, hashtext($1))', [caseId]);
        const result = await work(connection); await connection.query('COMMIT'); return result;
      } catch (err) { await connection.query('ROLLBACK').catch(() => {}); throw err; }
      finally { connection.release(); }
    },
  };
}

function renderCaseCard(message, value) {
  const label = value.status === 'accepted' ? WORK_LABELS[value.workStatus] || STATUS_LABELS.accepted : STATUS_LABELS[value.status];
  if (!label || fieldCase(message) !== value.id) throw new Error('Invalid status card');
  const embeds = (message.embeds || []).map(plain);
  const embed = embeds.find(e => e.fields?.some(f => f.name === 'Case' && f.value === value.id));
  embed.fields = embed.fields.filter(f => !['Status', 'Picked up by', 'Status updated', 'Case updated'].includes(f.name));
  for (const field of embed.fields) if (field.name === 'Owner') field.name = 'Suggested specialist';
  embed.fields.unshift({ name: 'Status', value: label, inline: true });
  if (value.acceptedBy) {
    const label = /^\d{17,20}$/.test(value.acceptedBy) ? `<@${value.acceptedBy}>` : 'Omi support team';
    embed.fields.push({ name: 'Picked up by', value: label, inline: true });
  }
  const updated = Date.parse(value.updatedAt);
  if (Number.isFinite(updated)) embed.fields.push({ name: 'Case updated', value: `<t:${Math.floor(updated / 1000)}:R>`, inline: true });
  embed.title = `Support case · ${label}`;
  embed.color = ['resolved', 'closed'].includes(value.status) ? 0x2ecc71 : value.status === 'accepted' ? 0x3498db : 0xe67e22;
  const components = (message.components || []).map(plain).map(row => ({ ...row,
    components: (row.components || []).filter(c => !String(c.custom_id || c.customId || '').startsWith('case:')),
  })).filter(row => row.components.length);
  const controls = [];
  if (value.status === 'delivered') controls.push({ type: 2, style: 1, custom_id: `case:accept:${value.id}`, label: 'Accept case' });
  if (value.status === 'accepted') {
    if (value.workStatus !== 'in_progress') controls.push({ type: 2, style: 1, custom_id: `case:work:in_progress:${value.id}`, label: value.workStatus ? 'Resume work' : 'Start work' });
    if (value.workStatus !== 'waiting_customer') controls.push({ type: 2, style: 2, custom_id: `case:work:waiting_customer:${value.id}`, label: 'Waiting for customer' });
  }
  controls.push({ type: 2, style: 2, custom_id: `case:refresh:${value.id}`, label: 'Refresh status' });
  components.push({ type: 1, components: controls });
  return { embeds, components, allowedMentions: NO_MENTIONS };
}

function createCardService(store, { service = cases, log = line => console.error(line) } = {}) {
  return {
    async rememberCard(caseId, channelId, messageId) {
      if (!/^[0-9a-f-]{36}$/i.test(caseId) || !/^\d{17,20}$/.test(String(channelId)) || !/^\d{17,20}$/.test(String(messageId))) return false;
      if (!(await service.getCaseById(caseId))) return false;
      await store.remember(caseId, channelId, messageId); return true;
    },
    async syncCase(client, caseId) {
      if (!client?.channels?.fetch || !client.user?.id) return { ok: false, code: 'client_unavailable' };
      return store.lock(caseId, async (connection) => {
        const currentService = connection ? cases.createCaseService(cases.createPostgresStore(connection)) : service;
        let edited = 0; const cards = await store.list(caseId, connection);
        for (const card of cards) {
          if (!process.env.STAFF_ALERT_CHANNEL_ID || card.channelId !== process.env.STAFF_ALERT_CHANNEL_ID) continue;
          try {
            const channel = await client.channels.fetch(card.channelId);
            const message = await channel.messages.fetch(card.messageId);
            if (message.author?.id !== client.user.id || fieldCase(message) !== caseId) continue;
            // Read under the cross-copy edit lock, after the Discord fetch.
            const value = await currentService.getCaseById(caseId); if (!value) continue;
            await message.edit(renderCaseCard(message, value));
            await store.synced(card, value, connection); edited++;
          } catch (err) {
            if (Number(err.code) === 10008) await store.forget(caseId, card.messageId, connection);
            else { log('[CaseCard] status refresh failed; pending retry'); return { ok: false, code: 'refresh_failed' }; }
          }
        }
        return { ok: edited > 0, code: edited ? 'updated' : 'card_unavailable' };
      });
    },
    async syncPending(client, limit = 25) {
      const dirty = await store.dirty(service, Math.min(25, Math.max(1, limit)));
      for (const id of dirty) await this.syncCase(client, id);
      return dirty.length;
    },
  };
}

async function notifyAcceptance(client, value, { service = cases, log = line => console.error(line) } = {}) {
  if (!client?.channels?.fetch || !value?.acceptedBy || !value.acceptedAt || !value.acceptanceGeneration) return { ok: false, code: 'unavailable' };
  const destination = value.customerThreadId || value.handoffThreadId || value.channelId;
  if (!destination || destination === process.env.STAFF_ALERT_CHANNEL_ID) return { ok: false, code: 'invalid_destination' };
  let channel;
  try {
    channel = await client.channels.fetch(destination);
    if (!channel?.send) return { ok: false, code: 'unavailable' };
    if (!value.customerThreadId && !value.handoffThreadId) {
      if (!value.sourceMessageId || !channel.messages?.fetch) return { ok: false, code: 'source_unverifiable' };
      const source = await channel.messages.fetch(value.sourceMessageId);
      if (source.author?.id !== value.customerId) return { ok: false, code: 'source_unverifiable' };
    }
  } catch { return { ok: false, code: 'unavailable' }; }
  let claimed;
  try { claimed = await service.claimAcceptanceNotice(value.id, value.acceptanceGeneration); }
  catch { return { ok: false, code: 'claim_failed' }; }
  if (!claimed) {
    let current;
    try { current = await service.getCaseById(value.id); } catch { return { ok: false, code: 'read_failed' }; }
    return current?.acceptanceGeneration === value.acceptanceGeneration && current?.acceptanceNoticeId
      ? { ok: true, duplicate: true } : { ok: false, code: 'notice_unconfirmed' };
  }
  const person = /^\d{17,20}$/.test(claimed.acceptedBy) ? `<@${claimed.acceptedBy}>` : 'Omi support';
  const language = claimed.context?.replyLanguage || 'en';
  const copy = ACCEPTANCE_COPY[language] || ACCEPTANCE_COPY[language.split('-')[0]] || ACCEPTANCE_COPY.en;
  const payload = { content: copy(person),
    allowedMentions: NO_MENTIONS, nonce: createHash('sha256').update(`${claimed.id}:accept:${claimed.acceptanceGeneration}`).digest('hex').slice(0, 24), enforceNonce: true };
  if (!value.customerThreadId && !value.handoffThreadId) payload.reply = { messageReference: value.sourceMessageId, failIfNotExists: true };
  let sent;
  let current;
  try { current = await service.getCaseById(value.id); } catch { return { ok: false, code: 'read_failed' }; }
  if (current?.status !== 'accepted' || current.acceptanceGeneration !== claimed.acceptanceGeneration) return { ok: false, code: 'stale_acceptance' };
  try { sent = await channel.send(payload); }
  catch { log('[CaseCard] acceptance notice not confirmed; staff follow-up needed'); return { ok: false, code: 'send_unconfirmed' }; }
  if (!sent?.id) { log('[CaseCard] acceptance notice receipt missing; staff follow-up needed'); return { ok: false, code: 'send_unconfirmed' }; }
  try { await service.saveAcceptanceNotice(value.id, claimed.acceptanceGeneration, sent.id); }
  catch { log('[CaseCard] acceptance notice sent; receipt save failed'); return { ok: true, code: 'receipt_save_failed' }; }
  return { ok: true, code: 'sent' };
}

const memory = createMemoryStore(); let postgres; let injected;
function service() {
  const store = injected || (process.env.DATABASE_URL ? (postgres ||= createPostgresStore(require('./db').pool)) : memory);
  return createCardService(store);
}
module.exports = { initSchema, createMemoryStore, createPostgresStore, createCardService, renderCaseCard, notifyAcceptance,
  setStoreForTests: store => { injected = store; },
  ...Object.fromEntries(['rememberCard', 'syncCase', 'syncPending'].map(name => [name, (...args) => service()[name](...args)])),
};
