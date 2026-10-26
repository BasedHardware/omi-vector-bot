// Public source provenance, never crawl-time freshness or inferred product facts.
const DATE_ORIGINS = new Set(['article-jsonld', 'article-meta', 'declared']);
const SOURCE_DATE_POLICY = 'Keep the existing source-authority hierarchy. Prefer a newer document over a conflicting older rule only after the same topic, product, surface and version applicability is established from the evidence. Dates, titles, missing scope and crawl times do not establish applicability. A newer lower-trust page cannot override a higher-trust source. Keep complementary instructions and safety details; omission is not contradiction. If a material conflict or applicability remains unresolved, state uncertainty and escalate through the existing person workflow instead of asserting either rule. Document dates do not prove a release, deployment or account outcome.';
function absoluteDate(value, now = Date.now()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return null;
  const date = value.slice(0,10), day = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0,10) !== date) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= now + 300000 ? new Date(parsed).toISOString() : null;
}

function normalizeProvenance(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {}, dates = {};
  if (DATE_ORIGINS.has(value.dateOrigin)) {
    for (const field of ['publishedAt','updatedAt']) {
      if (value[field] === undefined) continue;
      const date = absoluteDate(value[field],now);
      if (!date) return {};
      dates[field] = date;
    }
    if (dates.publishedAt && dates.updatedAt && dates.updatedAt < dates.publishedAt) return {};
    if (Object.keys(dates).length) Object.assign(out,dates,{dateOrigin:value.dateOrigin});
  }
  const scope = {};
  for (const field of ['product','surface','version']) {
    const item = value.applicability?.[field];
    if (typeof item === 'string' && /^[\p{L}\p{N} ._+:/-]{1,80}$/u.test(item) && item.trim()) scope[field] = item.trim();
  }
  if (Object.keys(scope).length) out.applicability = scope;
  return out;
}

function pageIdentity(value) {
  try { const url = new URL(value); url.hash = ''; return url.href; } catch { return ''; }
}

function articleProvenance(html, url, now = Date.now()) {
  const found = [];
  const scripts = String(html || '').matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  let scanned = 0;
  for (const match of scripts) {
    if (++scanned > 16) break;
    if (match[1].length > 64000) continue;
    let root;
    try { root = JSON.parse(match[1]); } catch { continue; }
    const nodes = (Array.isArray(root) ? root : [root, ...(Array.isArray(root?.['@graph']) ? root['@graph'] : [])]).slice(0,32);
    for (const node of nodes) {
      const types = Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']];
      if (!types.some(type => ['Article','TechArticle','NewsArticle','BlogPosting'].includes(type))) continue;
      const identity = node.url || node.mainEntityOfPage?.['@id'];
      if (!identity || pageIdentity(identity) !== pageIdentity(url)) continue;
      const value = { dateOrigin:'article-jsonld' };
      if (node.datePublished !== undefined) value.publishedAt = node.datePublished;
      if (node.dateModified !== undefined) value.updatedAt = node.dateModified;
      // Scope is known only when the publisher explicitly names the software.
      // A page's language, viewport or inferred topic is not application scope.
      if (node.about?.['@type'] === 'SoftwareApplication') value.applicability = {
        product:node.about.name, surface:node.about.operatingSystem, version:node.about.softwareVersion,
      };
      found.push(normalizeProvenance(value,now));
    }
  }
  if (!found.length) return {};
  const unique = new Map(found.map(value => [JSON.stringify(value),value]));
  return unique.size === 1 ? found[0] : {};
}

function provenanceLine(value) {
  const data = normalizeProvenance(value), parts = [];
  if (data.publishedAt) parts.push('Published: ' + data.publishedAt);
  if (data.updatedAt) parts.push('Updated: ' + data.updatedAt);
  if (data.dateOrigin) parts.push('date source=' + data.dateOrigin);
  if (data.applicability) parts.push('Explicit applicability: ' + Object.entries(data.applicability).map(([key,value]) => key+'='+value).join('; '));
  if (parts.length && !['product','surface','version'].every(key=>data.applicability?.[key])) parts.push('applicability incomplete; do not infer from date');
  return parts.join(' | ');
}

function preferNewerApplicable(rows, sourceOf, relevanceOf) {
  const result=[...rows], groups=new Map();
  const normalized=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const scopeIdentity=value=>String(value).normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
  result.forEach((row,index)=>{
    const source=sourceOf(row);
    if (!['help','docs','github','website'].includes(source)) return;
    const data=normalizeProvenance(row.provenance), scope=data.applicability;
    if (!['product','surface','version'].every(key=>scope?.[key])) return;
    const title=normalized(row.title), section=normalized(row.section);
    if (!title) return;
    const relevance=relevanceOf?.(row);
    if (!Array.isArray(relevance) || !relevance.length || !relevance.every(Number.isFinite)) return;
    const dateKind=data.updatedAt?'updatedAt':data.publishedAt?'publishedAt':null;
    if (!dateKind) return;
    // Generic section names cannot establish article topic equivalence. Dates
    // also cannot replace a stronger lexical match or multi-query support.
    const group=JSON.stringify([source,title,section,...['product','surface','version'].map(key=>scopeIdentity(scope[key])),dateKind,relevance]);
    if (!groups.has(group)) groups.set(group,[]);
    groups.get(group).push({index,row,at:data[dateKind]});
  });
  for (const group of groups.values()) {
    if (group.length<2 || new Set(group.map(value=>value.at)).size<2) continue;
    const ordered=[...group].sort((a,b)=>b.at.localeCompare(a.at)||a.index-b.index);
    // Reorder only the already-ranked slots belonging to this proven scope.
    // Nothing is removed; other authorities/topics retain their positions.
    group.forEach((slot,index)=>{result[slot.index]={...ordered[index].row,
      sourcePreference:'newer_same_topic_and_explicit_scope'};});
  }
  return result;
}

module.exports = { absoluteDate,normalizeProvenance,articleProvenance,provenanceLine,preferNewerApplicable,SOURCE_DATE_POLICY };
