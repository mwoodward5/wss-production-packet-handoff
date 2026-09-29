// Bounded projection of already-observed Markdown. Parsing is not identity or trust certification.
const UNSAFE = /<\s*\/?\s*[a-z][^>]*>|(?:java|vb)script\s*:|data\s*:|!\[[^\]]*\]\([^)]*\)|[\u0000\u202a-\u202e\u2066-\u2069]/i;
const PRIVATE_DIRECTIVE = /\b(?:system prompt|developer message|ignore (?:all |the )?(?:previous|prior) instructions|api[_ -]?key|secret[_ -]?key|builder instructions)\b/i;
const key = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function paragraph(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length < 12 || text.length > 1800 || UNSAFE.test(text) || PRIVATE_DIRECTIVE.test(text)) return '';
  if (/^(?:[-*]|\d+[.)])\s|^\|/.test(text)) return '';
  return text;
}
function unique(values, max = 12) { return [...new Set(values.filter(Boolean))].slice(0, max); }
export function sourceSections(copy, services = []) {
  const out = { about: [], services: {}, faqs: [] };
  if (typeof copy !== 'string' || copy.length > 250000) return out;
  const allowed = new Map(services.map(s => typeof s === 'string' ? s : s?.name).filter(Boolean).map(s => [key(s), s]));
  let section = '', service = '', question = '', faqLevel = 0, pending = [], fenced = false, plainService = false;
  function flush() {
    const text = paragraph(pending.join(' ')); pending = [];
    const plain = plainService; plainService = false;
    if (!text) { if (plain) { section = ''; service = ''; } return; }
    if (question) {
      const prior = out.faqs.find(row => row.q === question);
      if (prior) { if (!prior.a.includes(text) && prior.a.length + text.length < 1800) prior.a += '\n\n' + text; }
      else if (out.faqs.length < 12) out.faqs.push({ q: question, a: text });
    } else if (section === 'about') out.about.push(text);
    else if (section === 'service' && service) {
      if (!Object.hasOwn(out.services, service)) Object.defineProperty(out.services, service, { value: [], enumerable: true, writable: true });
      out.services[service].push(text);
    }
    // A flattened heading authorizes its NEXT prose block only, never a footer.
    if (plain) { section = ''; service = ''; }
  }
  const lines = copy.replace(/\r\n/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (/^```|^~~~/.test(line)) { flush(); fenced = !fenced; continue; }
    if (fenced) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    // The owned HTML extractor also emits isolated plain-text service headings.
    // Exact admitted service match + blank boundaries; do not infer new services.
    if (!heading && line && allowed.has(key(line))
      && (index === 0 || !lines[index - 1].trim())
      && index + 1 < lines.length && !lines[index + 1].trim()) {
      flush(); section = 'service'; service = allowed.get(key(line));
      question = ''; faqLevel = 0; plainService = true; continue;
    }
    if (heading) {
      flush();
      const level = heading[1].length, title = heading[2].trim(), normalized = key(title);
      question = ''; service = '';
      if (/^(?:frequently asked questions|faqs?|questions(?: and answers)?)$/.test(normalized)) { section = 'faq'; faqLevel = level; }
      else if (section === 'faq' && level > faqLevel && /\?$/.test(title) && paragraph(title) && title.length <= 240) question = title;
      else if (/^(?:about(?: us| the (?:company|team|business))?|our (?:story|company|team))$/.test(normalized)) { section = 'about'; faqLevel = 0; }
      else if (allowed.has(normalized)) { section = 'service'; service = allowed.get(normalized); faqLevel = 0; }
      else { section = ''; faqLevel = 0; }
    } else if (!line) { if (pending.length) flush(); }
    else pending.push(line);
  }
  flush();
  out.about = unique(out.about, 8);
  for (const name of Object.keys(out.services)) out.services[name] = unique(out.services[name], 4);
  out.faqs = out.faqs.filter(row => paragraph(row.q) && paragraph(row.a));
  return out;
}
export function packetSourceSections(packet = {}) {
  const copy = packet.enrichment_sources?.copy;
  if (!copy || copy.source !== 'source-intake' || copy.generated === true || copy.verified === false) return { about: [], services: {}, faqs: [] };
  return sourceSections(copy.value, packet.services || []);
}
export function safeVisitorMarkdown(body) {
  return typeof body === 'string' && body.length <= 32000 && !UNSAFE.test(body) && !PRIVATE_DIRECTIVE.test(body);
}
export function observedCopy(discovery = {}, website = '') {
  if (typeof discovery.found?.copy !== 'string' || !Array.isArray(discovery.sources) || !discovery.sources.length) return '';
  try {
    const base = new URL(website);
    if (!/^https?:$/.test(base.protocol) || base.username || base.password) return '';
    const prefix = base.pathname.replace(/\/+$/, '') || '/';
    const own = discovery.sources.every(value => {
      if (typeof value !== 'string') return false;
      const url = new URL(value);
      return !url.username && !url.password && url.origin === base.origin
        && (prefix === '/' || url.pathname === prefix || url.pathname.startsWith(prefix + '/'));
    });
    return own ? discovery.found.copy : '';
  } catch { return ''; }
}
