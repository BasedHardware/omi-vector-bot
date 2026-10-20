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

function uniqueQueries(question, planned = [], limit = 5) {
  const seen = new Set();
  const out = [];
  for (const value of [question, ...(planned || [])]) {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= limit) break;
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
  if (/\b(?:api|sdk|webhook|endpoint|oauth|curl|programmatic(?:ally)?)\b|\bdeveloper\s+(?:docs?|guides?|api)\b/i.test(text)) return true;
  return /\b(?:build|building|make|making|create|creating|develop|developing|write|writing|code|coding|publish|publishing)\s+(?:(?:a|an)(?:\s+(?:custom|new))?|(?:my|our|your)\s+own|custom|new)\s+(?:omi\s+)?(?:app|integration|plugin)s?\b/i.test(text);
}

function isDeveloperPageCompatibleQuestion(question) {
  return isDeveloperIntent(question) ||
    /\b(?:firmware|flash\w*|dev\s*kit|devkit|developer|compil\w*|source|repos?itor\w*|repos?|github|npm|flutter)\b/i.test(String(question || ''));
}

function normalizeSubQuestions(value) {
  const seen = new Set();
  const parts = [];
  for (const item of Array.isArray(value) ? value : []) {
    const rawQuestion = typeof item === 'string' ? item : item?.question;
    if (typeof rawQuestion !== 'string') continue;
    const question = rawQuestion
      .replace(/\s+/g, ' ').trim().slice(0, 240);
    const key = question.toLowerCase();
    if (!question || seen.has(key)) continue;
    const rawQuery = typeof item === 'string' ? item : item?.query ?? item?.search_query;
    const query = (typeof rawQuery === 'string' ? rawQuery : question)
      .replace(/\s+/g, ' ').trim().slice(0, 180) || question.slice(0, 180);
    seen.add(key);
    parts.push({ question, query });
    if (parts.length >= 8) break;
  }
  return parts;
}

function hasMultipleParts(value) {
  return normalizeSubQuestions(value).length >= 2;
}

function supportQueries(question, planned = [], { subQuestions = [] } = {}) {
  const text = [question, ...(planned || [])].filter(Boolean).join(' ');
  const variants = [];
  if (isDeveloperIntent(question) && /\bapps?\b/i.test(question) && /\bomi\b/i.test(question)) {
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
  const parts = normalizeSubQuestions(subQuestions);
  // Preserve every interpreted part before optional synonyms or generic searches.
  // Two/three-part requests keep the existing five-query budget. Longer requests
  // have at most eight part queries plus the customer's original wording.
  return hasMultipleParts(parts)
    ? uniqueQueries(question, [...parts.map((part) => part.query), ...(planned || []), ...variants], parts.length > 3 ? 9 : 5)
    : uniqueQueries(question, [...variants, ...(planned || [])]);
}

function queryMatchScore(query, row) {
  const terms = queryTerms(query, 20);
  const title = String(row.title || '').toLowerCase();
  const body = String(row.body || row.blurb || '').toLowerCase();
  return terms.reduce((score, term) => score + (title.includes(term) ? 4 : body.includes(term) ? 1 : 0), 0);
}

function isConsumerPhoneQuestion(question) {
  const text = String(question || '');
  return !isDeveloperIntent(text) && /\b(?:phone|iphone|android|ios|mobile)\b/i.test(text) &&
    !/\b(?:desktop|macos|windows|computer|laptop)\b|\bmac\b(?!\s+(?:address|id)\b)/i.test(text);
}

function consumerSourceFit(question, row) {
  if (!isConsumerPhoneQuestion(question)) return 0;
  // Classify the page, not incidental terms inside a cross-platform guide.
  // Fit only breaks relevance ties: incompatible audiences get a demotion,
  // never a positive domain bonus for an otherwise unrelated page.
  let metadata = `${row.title || ''} ${row.url || ''}`;
  try { metadata = decodeURIComponent(metadata); } catch { /* Keep literal metadata. */ }
  metadata = metadata.replace(/[_-]+/g, ' ');
  return /\b(?:developer|sdk|api|python|javascript|typescript|curl|desktop|macos|windows)\b|\bmac\b(?!\s+(?:address|id)\b)/i.test(metadata) ? -1 : 0;
}

function selectSubQuestionEvidence(rows, subQuestions, limit = 8, { customerQuestion = '' } = {}) {
  const parts = normalizeSubQuestions(subQuestions);
  if (!hasMultipleParts(parts)) return rows.slice(0, limit);
  const byPage = new Map();
  for (const [index, part] of parts.entries()) {
    const matches = rows.map((row) => ({ row, score: queryMatchScore(part.query, row) }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score || consumerSourceFit(customerQuestion, b.row) - consumerSourceFit(customerQuestion, a.row) ||
        sourceAuthority(b.row.source || sourceKind(b.row.url)) - sourceAuthority(a.row.source || sourceKind(a.row.url)));
    const row = matches[0]?.row;
    if (!row) continue;
    const key = String(row.url || row.title || '');
    const page = byPage.get(key) || { key, firstPart: index, rows: [] };
    page.rows.push(row);
    byPage.set(key, page);
  }
  // Prefer pages answering several parts, then preserve the requested order.
  // One useful chunk per page goes first so the unchanged character cap cannot
  // spend its budget on repeats before complementary guidance arrives.
  const selectedPages = [...byPage.values()]
    .sort((a, b) => b.rows.length - a.rows.length || a.firstPart - b.firstPart)
    .slice(0, 4);
  const allowedPages = new Set(selectedPages.map((page) => page.key));
  for (const row of rows) {
    const key = String(row.url || row.title || '');
    if (allowedPages.size >= 4) break;
    if (!allowedPages.has(key)) {
      allowedPages.add(key);
      selectedPages.push({ key, rows: [row] });
    }
  }
  const selected = [];
  const seen = new Set();
  for (const row of [
    ...selectedPages.map((page) => page.rows[0]),
    ...selectedPages.flatMap((page) => page.rows.slice(1)),
    ...rows,
  ]) {
    const page = String(row.url || row.title || '');
    const key = `${page}#${row.chunk_index ?? row.chunkIndex ?? 0}`;
    if (!allowedPages.has(page) || seen.has(key)) continue;
    seen.add(key);
    selected.push(row);
    if (selected.length >= limit) break;
  }
  return selected;
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

function mergeRanked(resultSets, limit = 8, { customerQuestion = '' } = {}) {
  const phoneQuestion = isConsumerPhoneQuestion(customerQuestion);
  const merged = new Map();
  for (const rows of resultSets || []) {
    (rows || []).forEach((row, index) => {
      const key = `${row.url || ''}#${row.chunk_index ?? row.chunkIndex ?? index}`;
      const authority = Number(row.authority || sourceAuthority(row.source || sourceKind(row.url)));
      const relevanceScore = 1 / (60 + index + 1) + Number(row.rank || 0) * 0.01;
      // Keep the existing non-phone score and recall fusion unchanged. Phone
      // questions compare relevance without an authority/domain bonus first.
      const score = 1 / (60 + index + 1) + authority * 0.0005 + Number(row.rank || 0) * 0.01;
      const prior = merged.get(key);
      if (prior) {
        prior.relevanceScore += relevanceScore;
        prior.fusedScore += score;
      } else merged.set(key, { ...row, authority, relevanceScore, fusedScore: score });
    });
  }
  const ranked = [...merged.values()]
    .sort((a, b) => (phoneQuestion ? b.relevanceScore - a.relevanceScore : 0) ||
      consumerSourceFit(customerQuestion, b) - consumerSourceFit(customerQuestion, a) ||
      b.fusedScore - a.fusedScore || b.authority - a.authority);
  return diverseTop(ranked, limit);
}

function rankLocalChunks(queries, rows, limit = 8, { customerQuestion = '', subQuestions = [] } = {}) {
  const wanted = (queries || []).map((query) => new Set(queryTerms(query, 20)));
  const phoneQuestion = isConsumerPhoneQuestion(customerQuestion || queries?.[0]);
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
      const relevanceScore = score;
      if (consumerQuestion && (row.source || sourceKind(row.url)) === 'help') score += 4;
      if (consumerQuestion && /\/api-reference\//i.test(String(row.url || ''))) score -= 8;
      if (!consumerQuestion && score > 0 && /docs\.omi\.me\/(?:api-reference|docs?\/developer)\//i.test(String(row.url || ''))) score += 12;
      if (singleItemDeletion && (row.source || sourceKind(row.url)) === 'help' &&
          /\b(?:delete|remove|erase)\b/i.test(body) &&
          /\b(?:individual|single|one)\s+(?:conversations?|memories|memory|recordings?|transcripts?)\b/i.test(body)) score += 16;
      return { ...row, authority: sourceAuthority(row.source || sourceKind(row.url)), relevanceScore, rank: score };
    })
    .filter((row) => row.rank > 0)
    .sort((a, b) => (phoneQuestion ? b.relevanceScore - a.relevanceScore : 0) ||
      consumerSourceFit(customerQuestion || queries?.[0], b) - consumerSourceFit(customerQuestion || queries?.[0], a) ||
      b.rank - a.rank || b.authority - a.authority);
  return hasMultipleParts(subQuestions)
    ? selectSubQuestionEvidence(ranked, subQuestions, limit, { customerQuestion: customerQuestion || queries?.[0] })
    : diverseTop(ranked, limit);
}

function formatEvidence(rows, { maxChars = 9_000, maxPerPage = 2, onSources } = {}) {
  const blocks = [];
  const sourceUrls = new Set();
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
    const separatorChars = blocks.length ? 2 : 0;
    if (used + separatorChars + block.length > maxChars && blocks.length) break;
    blocks.push(block);
    if (url) sourceUrls.add(url);
    used += separatorChars + block.length;
    perPage.set(url, count + 1);
  }
  // Provenance travels outside formatted prose. A title/body can contain links
  // or forged evidence markers, but cannot add a retrieved source identity.
  onSources?.([...sourceUrls]);
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

function evidenceChunkRows(evidence) {
  const text = String(evidence || '');
  const markers = [...text.matchAll(/^\[S\d+\s*\|[^\n]*\]\s*$/gm)];
  const chunks = [];
  for (const [index, marker] of markers.entries()) {
    const block = text.slice(marker.index, markers[index + 1]?.index ?? text.length).trim().split('\n');
    const url = String(block[2] || '').trim();
    const source = sourceKind(url);
    // Authority comes from the known URL, never from a prose trust label.
    if (!['docs', 'help', 'website', 'github'].includes(source)) continue;
    const body = block.slice(3).join('\n').trim();
    if (!body) continue;
    chunks.push({ url, title: String(block[1] || '').trim(), body, source, chunkIndex: `fetched-${index}` });
  }
  return chunks;
}

function jointMultipartEvidence(question, docsEvidence, officialChunks, { queries = [], subQuestions = [], sourceUrls = [], onSources } = {}) {
  const parts = normalizeSubQuestions(subQuestions);
  const seen = new Set();
  const chunks = [];
  for (const row of [...evidenceChunkRows(docsEvidence), ...(officialChunks || [])]) {
    const key = `${row.url || ''}\n${cleanDocument(row.body)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chunks.push(row);
  }
  const retrieved = new Set([...sourceUrls, ...(officialChunks || []).map(row => row.url)]);
  return formatEvidence(rankLocalChunks(
    supportQueries(question, queries, { subQuestions: parts }), chunks, 8,
    { customerQuestion: question, subQuestions: parts }
  ), { onSources: urls => onSources?.(urls.filter(url => retrieved.has(url))) });
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
  normalizeSubQuestions,
  hasMultipleParts,
  selectSubQuestionEvidence,
  consumerSourceFit,
  mergeRanked,
  rankLocalChunks,
  formatEvidence,
  combineEvidence,
  jointMultipartEvidence,
};
