const MAX_DOCUMENT = 60_000;
const CHUNK_SIZE = 1_400;
const CHUNK_OVERLAP = 220;

const STOP_WORDS = new Set([
  'about',
  'an',
  'after',
  'again',
  'also',
  'and',
  'are',
  'because',
  'been',
  'before',
  'being',
  'but',
  'can',
  'could',
  'does',
  'do',
  'doing',
  'for',
  'from',
  'had',
  'has',
  'have',
  'help',
  'how',
  'into',
  'issue',
  'like',
  'my',
  'not',
  'omi',
  'please',
  'problem',
  'should',
  'that',
  'the',
  'their',
  'then',
  'there',
  'they',
  'this',
  'was',
  'what',
  'when',
  'where',
  'which',
  'will',
  'with',
  'would',
  'you',
  'your',
]);

function decodeEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value) || 32));
}

function cleanDocument(text, max = MAX_DOCUMENT) {
  const plain = decodeEntities(text)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(?:p|div|section|article|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<(?:br|hr)\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/```[a-z0-9_-]*\s*/gi, '\n')
    .replace(/```/g, '\n')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return plain.slice(0, max);
}

function sourceKind(url) {
  const value = String(url || '').toLowerCase();
  if (value.startsWith('https://help.omi.me/')) return 'help';
  if (value.startsWith('https://docs.omi.me/')) return 'docs';
  if (value.startsWith('https://feedback.omi.me/')) return 'feedback';
  if (/^https:\/\/(?:www\.)?omi\.me\//.test(value)) return 'website';
  if (value.startsWith('https://discord.com/channels/')) return 'discord';
  if (value.startsWith('https://github.com/basedhardware/')) return 'github';
  return 'other';
}

function sourceLabel(kind) {
  if (kind === 'help') return 'Official Help Center';
  if (kind === 'docs') return 'Official documentation';
  if (kind === 'website') return 'Official Omi website';
  if (kind === 'github') return 'Official GitHub';
  if (kind === 'feedback') return 'Omi Feedback portal';
  if (kind === 'discord') return 'Discord help history';
  return 'Retrieved page';
}

function sourceAuthority(kind) {
  if (kind === 'help') return 5;
  if (kind === 'docs') return 4;
  if (kind === 'github') return 4;
  if (kind === 'website') return 3;
  if (kind === 'feedback') return 2;
  if (kind === 'discord') return 1;
  return 2;
}

function headingLine(line) {
  const value = String(line || '').trim();
  if (/^#{1,6}\s+\S/.test(value)) return value.replace(/^#{1,6}\s+/, '').trim();
  if (value.length <= 90 && /^(?:[A-Z][^.!?]{2,}|\d+\.\s+\S+)$/.test(value)) return value;
  return '';
}

function splitLongPart(part, size = CHUNK_SIZE) {
  const out = [];
  let rest = String(part || '').trim();
  while (rest.length > size) {
    const window = rest.slice(0, size + 1);
    const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '));
    const space = window.lastIndexOf(' ');
    const cut = sentence > size * 0.55 ? sentence + 1 : space > size * 0.55 ? space : size;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function chunkDocument({ url, title, body }, { size = CHUNK_SIZE, overlap = CHUNK_OVERLAP } = {}) {
  const clean = cleanDocument(body);
  if (!clean) return [];
  const parts = clean
    .split(/\n+/)
    .flatMap((part) => splitLongPart(part, size))
    .filter(Boolean);
  const chunks = [];
  let current = '';
  let section = '';

  function push() {
    const text = current.trim();
    if (!text) return;
    chunks.push({
      url: String(url || ''),
      title: String(title || ''),
      section,
      body: text,
      source: sourceKind(url),
      chunkIndex: chunks.length,
    });
    const tail = text.slice(Math.max(0, text.length - overlap));
    const boundary = tail.indexOf(' ');
    current = boundary >= 0 ? tail.slice(boundary + 1).trim() : tail;
  }

  for (const part of parts) {
    const heading = headingLine(part);
    if (heading) section = heading;
    const next = current ? `${current}\n${part}` : part;
    if (next.length > size && current) push();
    current = current ? `${current}\n${part}` : part;
  }
  push();
  return chunks;
}

function queryTerms(text, limit = 14) {
  const seen = new Set();
  const terms = [];
  for (const raw of String(text || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_.+-]*/gu) || []) {
    const word = raw.replace(/^[-_.+]+|[-_.+]+$/g, '');
    if (word.length < 2 || STOP_WORDS.has(word) || seen.has(word)) continue;
    seen.add(word);
    terms.push(word);
    if (terms.length >= limit) break;
  }
  return terms;
}

function uniqueQueries(question, planned = []) {
  const seen = new Set();
  const out = [];
  for (const value of [question, ...(planned || [])]) {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= 5) break;
  }
  return out;
}

function isSingleItemDeletionQuestion(question) {
  const text = String(question || '');
  return /\b(?:delete|remove|erase)\b/i.test(text) &&
    /\b(?:memory|memories|recording|conversation|transcript)s?\b/i.test(text) &&
    /\b(?:one|single|individual|from my list)\b/i.test(text);
}

function isDeveloperIntent(question) {
  const text = String(question || '');
  if (/\b(?:api|sdk|webhook|endpoint|developer|programmatic(?:ally)?|curl|oauth)\b/i.test(text)) return true;
  return /\b(?:build|building|make|making|create|creating|develop|developing|write|writing|code|coding)\b[^.!?]{0,90}\b(?:apps?|integrations?|plugins?)\b|\b(?:apps?|integrations?|plugins?)\b[^.!?]{0,90}\b(?:build|building|make|making|create|creating|develop|developing|write|writing|code|coding)\b|\b(?:pull|fetch|read|access)\b[^.!?]{0,80}\b(?:memories|conversations|data)\b[^.!?]{0,80}\b(?:from|with|through)\s+(?:my\s+)?(?:own\s+)?(?:app|integration|plugin)\b/i.test(text);
}

function isDeveloperPageCompatibleQuestion(question) {
  return isDeveloperIntent(question) ||
    /\b(?:firmware|flash\w*|dev\s*kit|devkit|compil\w*|source|repos?itor\w*|repos?|github|npm|flutter)\b/i.test(String(question || ''));
}

function supportQueries(question, planned = []) {
  const text = [question, ...(planned || [])].filter(Boolean).join(' ');
  const variants = [];
  if (/\b(?:build|building|create|make|develop)\b/i.test(question) &&
      /\bapps?\b/i.test(question) && /\bomi\b/i.test(question)) {
    variants.push('Omi building apps developer integrations conversations memory');
  }
  if (/\b(?:buy|buying|purchase|which\s+(?:omi|device)|choose\s+(?:an?\s+)?(?:omi|device))\b/i.test(question) &&
      /\b(?:omi|device|hardware)\b/i.test(question)) {
    variants.push('Omi device buying guide parts list choose hardware');
  }
  if (isSingleItemDeletionQuestion(question)) {
    variants.push('Omi app delete individual conversation memory recording from list');
  }
  const hasVoiceInput = /\b(?:transcri\w*|voice|spoken|ask(?:ed|ing)?|question)\b/i.test(text);
  const hasMissingOutput = /\b(?:answer\w*|response\w*|repl(?:y|ies|ied)|respond\w*|silent|nothing)\b/i.test(text);
  if (hasVoiceInput && hasMissingOutput) {
    variants.push('voice question chat answer AI message response visible foreground background');
  }
  if (
    /\b(?:delete|remove|clear|erase)\w*\b/i.test(text) &&
    /\b(?:conversation|transcript)s?\b/i.test(text) &&
    /\b(?:app|phone|local|device|recording)s?\b/i.test(text)
  ) {
    variants.push(
      'delete conversation transcript cloud phone local synced recording copies Offline Sync Manage Storage'
    );
  }
  return uniqueQueries(question, [...variants, ...(planned || [])]);
}

function diverseTop(rows, limit, maxPerPage = 2) {
  const selected = [];
  const selectedRows = new Set();
  const perPage = new Map();
  for (let pass = 0; pass < maxPerPage; pass += 1) {
    for (const row of rows || []) {
      if (selectedRows.has(row)) continue;
      const key = String(row.url || row.title || '');
      const count = perPage.get(key) || 0;
      if (count !== pass) continue;
      selected.push(row);
      selectedRows.add(row);
      perPage.set(key, count + 1);
      if (selected.length >= limit) return selected;
    }
  }
  return selected;
}

function mergeRanked(resultSets, limit = 8) {
  const merged = new Map();
  for (const rows of resultSets || []) {
    (rows || []).forEach((row, index) => {
      const key = `${row.url || ''}#${row.chunk_index ?? row.chunkIndex ?? index}`;
      const authority = Number(row.authority || sourceAuthority(row.source || sourceKind(row.url)));
      const score = 1 / (60 + index + 1) + authority * 0.0005 + Number(row.rank || 0) * 0.01;
      const prior = merged.get(key);
      if (prior) prior.fusedScore += score;
      else merged.set(key, { ...row, authority, fusedScore: score });
    });
  }
  const ranked = [...merged.values()]
    .sort((a, b) => b.fusedScore - a.fusedScore || b.authority - a.authority);
  return diverseTop(ranked, limit);
}

function rankLocalChunks(queries, rows, limit = 8, { customerQuestion = '' } = {}) {
  const wanted = (queries || []).map((query) => new Set(queryTerms(query, 20)));
  const consumerQuestion = !isDeveloperIntent(customerQuestion || queries?.[0] || '');
  const singleItemDeletion = consumerQuestion && isSingleItemDeletionQuestion(customerQuestion || queries?.[0] || '');
  const ranked = (rows || [])
    .map((row) => {
      const title = String(row.title || '').toLowerCase();
      const body = String(row.body || '').toLowerCase();
      let score = 0;
      for (const terms of wanted) {
        let covered = 0;
        for (const term of terms) {
          if (title.includes(term)) {
            score += 4;
            covered += 1;
          } else if (body.includes(term)) {
            score += 1;
            covered += 1;
          }
        }
        if (terms.size && covered === terms.size) score += 5;
      }
      if (consumerQuestion && (row.source || sourceKind(row.url)) === 'help') score += 4;
      if (consumerQuestion && /\/api-reference\//i.test(String(row.url || ''))) score -= 8;
      if (!consumerQuestion && score > 0 && /docs\.omi\.me\/(?:api-reference|docs?\/developer)\//i.test(String(row.url || ''))) score += 12;
      if (singleItemDeletion && (row.source || sourceKind(row.url)) === 'help' &&
          /\b(?:delete|remove|erase)\b/i.test(body) &&
          /\b(?:individual|single|one)\s+(?:conversations?|memories|memory|recordings?|transcripts?)\b/i.test(body)) score += 16;
      return { ...row, authority: sourceAuthority(row.source || sourceKind(row.url)), rank: score };
    })
    .filter((row) => row.rank > 0)
    .sort((a, b) => b.rank - a.rank || b.authority - a.authority);
  return diverseTop(ranked, limit);
}

function formatEvidence(rows, { maxChars = 9_000, maxPerPage = 2 } = {}) {
  const blocks = [];
  const perPage = new Map();
  let used = 0;
  for (const row of rows || []) {
    const url = String(row.url || '');
    const count = perPage.get(url) || 0;
    if (count >= maxPerPage) continue;
    const kind = row.source || sourceKind(url);
    const trust =
      kind === 'discord'
        ? 'corroboration only; not an official fact'
        : kind === 'feedback'
          ? 'issue/status signal only; customer report is not product documentation'
          : 'authoritative';
    const id = `S${blocks.length + 1}`;
    const section = row.section ? ` — ${row.section}` : '';
    const body = cleanDocument(row.body, 1_700);
    if (!body) continue;
    const block = `[${id} | ${sourceLabel(kind)} | ${trust}]\n${row.title || 'Untitled'}${section}\n${url}\n${body}`;
    if (used + block.length > maxChars && blocks.length) break;
    blocks.push(block);
    used += block.length;
    perPage.set(url, count + 1);
  }
  return blocks.join('\n\n');
}

function combineEvidence(...values) {
  let next = 0;
  return values
    .flat()
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((value) => value.replace(/\[S\d+\s*\|/g, () => `[S${++next} |`))
    .join('\n\n');
}

module.exports = {
  MAX_DOCUMENT,
  CHUNK_SIZE,
  CHUNK_OVERLAP,
  cleanDocument,
  sourceKind,
  sourceLabel,
  sourceAuthority,
  chunkDocument,
  queryTerms,
  uniqueQueries,
  isSingleItemDeletionQuestion,
  isDeveloperIntent,
  isDeveloperPageCompatibleQuestion,
  supportQueries,
  mergeRanked,
  rankLocalChunks,
  formatEvidence,
  combineEvidence,
};
