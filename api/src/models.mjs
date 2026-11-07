// Report models: blank base documents the intern fills in. This module turns the DOCX worker's
// `inspect` output into a check list the screen shows, without any patient value leaving the API.

export const MODEL_SECTIONS = [
  ['demanda', 'Descrição da demanda'], ['anamnesis', 'Anamnese'], ['inteligencia', 'Habilidades intelectuais'],
  ['percepcao', 'Percepção'], ['memoria', 'Memória e aprendizagem'], ['atencao', 'Processos atencionais'],
  ['funcoes_executivas', 'Funções executivas'], ['comportamento', 'Comportamento'],
  ['personalidade', 'Bateria Fatorial da Personalidade'], ['comportamento_diva', 'Comportamento / DIVA'],
  ['conclusao', 'Conclusão'], ['hipotese', 'Hipótese diagnóstica'], ['recomendacoes', 'Indicações e recomendações'],
];
/** Behaviour sub-sections not every model has. */
const OPTIONAL = new Set(['personalidade', 'comportamento_diva', 'hipotese']);
/** Percepção is only applied to people under 17. */
const CHILD_ONLY = new Set(['percepcao']);
/** Sections whose text interprets their own score tables. */
const RESULT_SECTIONS = ['inteligencia', 'percepcao', 'memoria', 'atencao', 'funcoes_executivas', 'comportamento', 'personalidade', 'comportamento_diva'];
export const AUDIENCES = ['infantil', 'adulto', 'idoso', 'geral'];

/** A value counts as filled when it has letters or digits that are not a blank placeholder (____, ..., {{x}}, [x]). */
export function isFilled(value) {
  const v = String(value || '').replace(/\{\{[^}]*\}\}|\[[^\]]*\]|<[^>]*>/g, '').replace(/[_.\-–—\s/:]+/g, '');
  return /[\p{L}\p{N}]/u.test(v);
}

/**
 * Check list for one model. `inspected` is the worker's inspect result; `audience` decides whether
 * child-only sections are required. Only labels and booleans are returned for identification fields,
 * never their values.
 */
export function modelReport(inspected, audience = 'geral') {
  const markers = inspected?.markers || [];
  const markerKeys = new Set(markers.map(m => m.key));
  const titled = new Set(Object.keys(inspected?.title_ranges || {}));
  const domains = new Set(inspected?.titled_domains || []);
  const childOnlyRequired = audience === 'infantil' || audience === 'geral';

  const sections = MODEL_SECTIONS.map(([key, name]) => {
    const required = !OPTIONAL.has(key) && (!CHILD_ONLY.has(key) || childOnlyRequired);
    const m = markers.find(x => x.key === key);
    let state, note;
    if (m) { state = 'ok'; note = key === 'hipotese' ? 'Escrita pela psicóloga; a IA não redige hipótese diagnóstica.' : 'Tem o campo onde o texto é inserido.'; }
    else if (titled.has(key)) { state = 'auto'; note = 'Tem o título, mas não o campo "Interpretação". Ao baixar o Word, o sistema cria o campo logo após as tabelas.'; }
    else if (!required) { state = 'optional'; note = OPTIONAL.has(key) ? 'Opcional: só entra quando o modelo tem esse campo.' : 'Não se aplica a esta faixa etária.'; }
    else if (domains.has(key)) { state = 'missing'; note = 'O título existe, mas falta o campo "Interpretação" dessa seção.'; }
    else { state = 'missing'; note = 'Não existe no modelo. A IA não terá onde escrever esta seção.'; }
    const old = m && key !== 'demanda' && m.existing_paragraphs > 0;
    const pos = m ? m.index : inspected?.title_ranges?.[key] ? inspected.title_ranges[key][0] : null;
    return {key, name, state, required, note, old_text: !!old, pos};
  })
    // a section the model does not have is simply not listed
    .filter(s => !(s.state === 'optional' && OPTIONAL.has(s.key)));
  // Headings of fixed parts the intern fills (sources, instruments applied...): listed so the model reads as in Word.
  const listed = sections.map(s => s.pos).filter(p => p !== null);
  const fixed = fixedHeadings(inspected, markers).filter(h => !listed.includes(h.pos));
  const ordered = [...sections.filter(s => s.pos !== null), ...fixed].sort((a, b) => a.pos - b.pos).concat(sections.filter(s => s.pos === null));

  // Fields appear in the order of SECTIONS when the document follows the expected structure.
  const order = MODEL_SECTIONS.map(([k]) => k);
  const seen = markers.map(m => order.indexOf(m.key)).filter(i => i >= 0);
  const outOfOrder = seen.some((v, i) => i > 0 && v < seen[i - 1]);
  const duplicated = [...new Set(markers.map(m => m.key).filter((k, i, a) => a.indexOf(k) !== i))];

  const idEntries = Object.entries(inspected?.identification || {});
  const identification = idEntries.map(([label, value]) => ({label, filled: isFilled(value)}));
  const filledId = identification.filter(f => f.filled).map(f => f.label);
  const tables = (inspected?.elements || []).filter(e => e.type === 'table').length;

  const warnings = [];
  const missing = sections.filter(s => s.state === 'missing');
  if (missing.length) warnings.push({level: 'danger', text: 'Faltam no modelo: ' + missing.map(s => s.name).join(', ') + '.'});
  if (filledId.length) warnings.push({level: 'danger', text: 'A identificação já está preenchida (' + filledId.join(', ') + '). Use o modelo em branco, sem dados de paciente.'});
  const old = sections.filter(s => s.old_text);
  if (old.length) warnings.push({level: 'warn', text: 'Há texto antigo nos campos de interpretação de: ' + old.map(s => s.name).join(', ') + '. Ele será substituído pelo texto aprovado.'});
  if (outOfOrder) warnings.push({level: 'warn', text: 'As seções estão fora da ordem habitual. Confira a ordem no Word.'});
  if (duplicated.length) warnings.push({level: 'warn', text: 'Campo repetido: ' + duplicated.map(k => MODEL_SECTIONS.find(([x]) => x === k)?.[1] || k).join(', ') + '. Só o primeiro recebe texto.'});
  if (!idEntries.length) warnings.push({level: 'warn', text: 'Não foram encontrados os campos de identificação (Nome, Data de nascimento…). Eles não serão preenchidos sozinhos.'});

  const counted = sections.filter(s => s.state !== 'optional');
  const shown = ordered.map(({pos, ...s}) => s);
  const ready = counted.filter(s => s.state === 'ok' || s.state === 'auto').length;
  const status = missing.length || filledId.length ? 'incomplete' : warnings.length ? 'attention' : 'complete';
  return {status, ready, total: counted.length, sections: shown, identification, tables, warnings, blank: !filledId.length};
}

/**
 * One-cell heading boxes of the document that are not a section the system writes (e.g. "FONTES FUNDAMENTAIS DE
 * INFORMAÇÕES", "INSTRUMENTOS/AVALIAÇÕES APLICADAS"): their text comes from the file and is never changed.
 */
export function fixedHeadings(inspected, markers = inspected?.markers || []) {
  const els = inspected?.elements || [];
  const first = Math.min(...markers.map(m => m.index), els.length);
  const used = new Set(markers.flatMap(m => [m.index, m.section_start != null ? m.section_start - 1 : -1]));
  for (const [s] of Object.values(inspected?.title_ranges || {})) used.add(s - 1);
  const out = [];
  els.forEach((e, i) => {
    if (i < first || used.has(i) || e.type !== 'table') return;
    const cells = [...new Set(e.rows.flat().map(c => String(c).trim()).filter(Boolean))];
    if (cells.length !== 1) return;
    const t = cells[0].replace(/\s+/g, ' ').replace(/\s*:\s*$/, '');
    if (t.length < 4 || t.length > 80 || t !== t.toUpperCase() || /^INTERPRETA/.test(t)) return;
    out.push({key: 'fixo_' + i, name: t.charAt(0) + t.slice(1).toLowerCase(), state: 'fixed', required: false, note: 'Texto do arquivo base, preenchido pela estagiária. O sistema não altera.', old_text: false, pos: i});
  });
  return out;
}

/** Normalises the metadata sent by the screen. */
export function modelInput(body = {}) {
  const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const description = String(body.description || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const audience = AUDIENCES.includes(body.audience) ? body.audience : 'geral';
  let tags = body.tags;
  if (typeof tags === 'string') { try { tags = JSON.parse(tags); } catch { tags = tags.split(','); } }
  tags = Array.isArray(tags) ? [...new Set(tags.map(t => String(t).replace(/\s+/g, ' ').trim()).filter(t => t.length >= 2 && t.length <= 30))].slice(0, 8) : [];
  const active = body.active === undefined ? true : body.active === true || body.active === 'true' || body.active === 1;
  return {name, description, audience, tags, active};
}

/**
 * Compact structure of a document for comparison: sections with the "Interpretação" field, sections with only
 * a title, and how many data tables each section has. Built by the API from the worker's inspect output.
 * @param {{markers?:{key:string}[], title_ranges?:object}} inspected
 * @param {(key:string)=>number} tablesIn number of data tables inside a section
 */
export function structureOf(inspected, tablesIn) {
  const fields = [...new Set((inspected?.markers || []).map(m => m.key))];
  const titled = Object.keys(inspected?.title_ranges || {}).filter(k => !fields.includes(k));
  // Tables are counted only in result sections: demand, anamnesis and conclusion ranges span other content.
  const tables = Object.fromEntries(RESULT_SECTIONS.map(k => [k, fields.includes(k) || titled.includes(k) ? tablesIn(k) : 0]).filter(([, n]) => n > 0));
  return {fields, titled, tables};
}

const nameOf = k => MODEL_SECTIONS.find(([x]) => x === k)?.[1] || k;

/**
 * Differences between the intern's base document and the chosen model. Only structure is compared
 * (fields, titles, number of tables), never values.
 * @returns {{ok:boolean, items:{level:'danger'|'warn'|'info', text:string}[]}}
 */
export function compareToModel(model, base) {
  const items = [];
  const has = (s, k) => s.fields.includes(k) || s.titled.includes(k);
  for (const [k] of MODEL_SECTIONS) {
    if (model.fields.includes(k) && !base.fields.includes(k)) {
      items.push(has(base, k)
        ? {level: 'warn', text: `${nameOf(k)}: o modelo tem o campo "Interpretação" e o arquivo não. O sistema cria o campo ao baixar o Word.`}
        : {level: 'danger', text: `${nameOf(k)}: existe no modelo e falta no arquivo enviado.`});
    } else if (model.titled.includes(k) && !has(base, k)) {
      items.push({level: 'danger', text: `${nameOf(k)}: existe no modelo e falta no arquivo enviado.`});
    }
    const want = model.tables?.[k] || 0, got = base.tables?.[k] || 0;
    if (want && has(base, k) && got < want) items.push({level: 'warn', text: `${nameOf(k)}: o modelo tem ${want} ${want === 1 ? 'tabela' : 'tabelas'} e o arquivo tem ${got}. Confira se alguma foi apagada.`});
    if (!has(model, k) && has(base, k)) items.push({level: 'info', text: `${nameOf(k)}: está no arquivo, mas não no modelo.`});
  }
  return {ok: !items.some(i => i.level !== 'info'), items};
}
