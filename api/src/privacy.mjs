// Pseudonymisation of identifying data before text leaves the clinic (OpenAI API or manual ChatGPT).
// Identifying values are replaced by stable placeholders such as [PACIENTE]; restore() puts them back.

const PARTICLES = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
// Words that introduce a person's or institution's name in clinical notes.
const PERSON_CUES = ['dr', 'dra', 'doutor', 'doutora', 'psi', 'psicóloga', 'psicologa', 'psicólogo', 'psicologo', 'pediatra', 'neuropediatra', 'neurologista', 'psiquiatra', 'fonoaudióloga', 'fono', 'terapeuta', 'professor', 'professora', 'prof', 'profa', 'tia', 'tio', 'avó', 'avô', 'madrinha', 'padrinho', 'irmã', 'irmão'];
const PLACE_CUES = ['colégio', 'colegio', 'escola', 'creche', 'clínica', 'clinica', 'hospital', 'instituto'];
// Capitalised words after a cue that are not names.
const NOT_NAMES = new Set(['que', 'faz', 'com', 'ele', 'ela', 'não', 'nao', 'sem', 'por', 'para', 'pra', 'mas', 'tem', 'foi', 'era', 'está', 'esta', 'mais', 'muito', 'pois', 'quando', 'onde', 'sessão', 'sessao', 'sessoes', 'sessões', 'materna', 'materno', 'paterna', 'paterno', 'particular', 'pública', 'publica', 'estadual', 'municipal']);

const strip = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function dateVariants(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/) || String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return [];
  const [y, mo, d] = m[1].length === 4 ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
  const month = MONTHS[Number(mo) - 1];
  const out = [`${d}/${mo}/${y}`, `${Number(d)}/${Number(mo)}/${y}`, `${d}-${mo}-${y}`, `${y}-${mo}-${d}`, `${d}.${mo}.${y}`];
  if (month) out.push(`${Number(d)} de ${month} de ${y}`, `${d} de ${month} de ${y}`);
  return out;
}

function namesAfterCue(line, cues, {anyCase}) {
  const tokens = line.split(/\s+/);
  const found = [];
  for (let i = 0; i < tokens.length; i++) {
    const cue = strip(tokens[i].toLowerCase().replace(/[.:,;]+$/, ''));
    if (!cues.some(c => strip(c) === cue)) continue;
    const words = [];
    for (let j = i + 1; j < tokens.length && words.length < 3; j++) {
      const raw = tokens[j];
      const word = raw.replace(/^[("']+|[)"'.,;:!?]+$/g, '');
      const lower = strip(word.toLowerCase());
      if (cues.some(c => strip(c) === lower)) continue; // "pediatra Dr Joel"
      if (!word || word.length < 3 || NOT_NAMES.has(lower) || /\d/.test(word)) break;
      if (!anyCase && !/^\p{Lu}/u.test(word)) break;
      words.push(word);
      if (/[.,;:!?)]$/.test(raw)) break;
    }
    if (words.length) found.push(words.join(' '));
  }
  return found;
}

const titleCase = s => s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

/**
 * Collects identifying values.
 * @param {{patientName?:string, birthDate?:string|Date, baseLines?:string[], anamnesisLines?:string[]}} input
 * @returns {{value:string, kind:string}[]}
 */
export function detectTerms({patientName, birthDate, baseLines = [], anamnesisLines = []}) {
  const terms = [];
  const add = (value, kind) => { value = clean(value); if (value.length >= 2 && !terms.some(t => t.value.toLowerCase() === value.toLowerCase())) terms.push({value, kind}); };
  let name = clean(patientName);
  let birth = birthDate instanceof Date ? birthDate.toISOString().slice(0, 10) : birthDate;
  for (const line of baseLines.map(clean)) {
    const field = line.match(/^([^:]{3,45}):\s*(.+)$/);
    if (!field) continue;
    const label = strip(field[1].toLowerCase()), value = field[2].trim();
    if (!value || value === '-') continue;
    if (label === 'nome' && !name) name = value;
    else if (label.startsWith('data de nascimento')) birth = birth || value;
    else if (/^(autora?|responsavel|encaminhad[oa] por|medic[oa]|psicolog[oa])/.test(label)) add(value, 'person');
    else if (label.startsWith('local de realizacao')) add(value, 'place');
    else if (label.startsWith('telefone')) add(value, 'phone');
    else if (/^(crp|crm|cpf|rg)$/.test(label)) add(value, 'document');
    else if (label.startsWith('e-mail') || label === 'email') add(value, 'email');
  }
  if (name) {
    add(name, 'patient');
    const parts = name.split(' ').filter(p => p.length >= 3 && !PARTICLES.has(p.toLowerCase()));
    if (parts[0]) add(parts[0], 'first_name');
    parts.slice(1).forEach(p => add(p, 'surname'));
  }
  if (birth) for (const v of dateVariants(String(birth))) add(v, 'birth');
  const allText = [...baseLines, ...anamnesisLines].join('\n');
  for (const m of allText.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)) add(m[0], 'email');
  for (const m of allText.matchAll(/(?:\(?\b\d{2}\)?\s?)?9?\d{4}[-\s]?\d{4}\b/g)) if (m[0].replace(/\D/g, '').length >= 8) add(m[0], 'phone');
  for (const m of allText.matchAll(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g)) add(m[0], 'document');
  for (const line of anamnesisLines) {
    for (const n of namesAfterCue(line, PERSON_CUES, {anyCase: false})) add(/^[\p{Lu}\s]+$/u.test(n) ? titleCase(n) : n, 'person');
    for (const n of namesAfterCue(line, PLACE_CUES, {anyCase: true})) add(n, 'place');
  }
  return terms;
}

const PREFIX = {patient: 'PACIENTE', first_name: 'PRIMEIRO_NOME', surname: 'SOBRENOME', birth: 'DATA_NASCIMENTO', person: 'PESSOA', place: 'LOCAL', phone: 'TELEFONE', email: 'EMAIL', document: 'DOCUMENTO', extra: 'DADO'};
const SINGLE = new Set(['patient', 'first_name', 'birth']);

/**
 * Turns terms into placeholder entries. Numbering follows term order, so the same inputs give the same map.
 * @param {{value:string, kind:string}[]} terms
 * @param {{extra?:string[], ignored?:string[]}} prefs
 */
export function buildMap(terms, {extra = [], ignored = []} = {}) {
  const skip = new Set(ignored.map(v => clean(v).toLowerCase()));
  const all = [...terms, ...extra.map(v => ({value: clean(v), kind: 'extra'}))].filter(t => t.value && !skip.has(t.value.toLowerCase()));
  const counters = {}, entries = [];
  for (const t of all) {
    let placeholder;
    if (SINGLE.has(t.kind)) placeholder = `[${PREFIX[t.kind]}]`;
    else { counters[t.kind] = (counters[t.kind] || 0) + 1; placeholder = `[${PREFIX[t.kind] || 'DADO'}_${counters[t.kind]}]`; }
    entries.push({value: t.value, kind: t.kind, placeholder});
    const plain = strip(t.value);
    if (plain !== t.value) entries.push({value: plain, kind: t.kind, placeholder, variant: true});
  }
  return entries;
}

function matcher(entries) {
  const sorted = [...entries].sort((a, b) => b.value.length - a.value.length);
  if (!sorted.length) return null;
  return {re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${sorted.map(e => escapeRe(e.value)).join('|')})(?![\\p{L}\\p{N}])`, 'giu'), byValue: new Map(sorted.map(e => [e.value.toLowerCase(), e.placeholder]))};
}

/** Replaces identifying values in a string or in every string of an object. */
export function redact(input, entries) {
  const m = matcher(entries);
  if (!m) return input;
  const one = s => s.replace(m.re, hit => m.byValue.get(hit.toLowerCase()) || hit);
  const walk = v => typeof v === 'string' ? one(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v;
  return walk(input);
}

/** Puts real values back; the first (canonical) value of each placeholder wins. */
export function restore(text, entries) {
  const back = new Map();
  for (const e of entries) if (!e.variant && !back.has(e.placeholder)) back.set(e.placeholder, e.value);
  return String(text || '').replace(/\[[A-Z_]+(?:_\d+)?\]/g, p => back.get(p) ?? p);
}

export const leftoverPlaceholders = text => [...new Set(String(text || '').match(/\[[A-Z]+(?:_[A-Z]+)*(?:_\d+)?\]/g) || [])];
