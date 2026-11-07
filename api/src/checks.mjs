// Consistency checks between the base document, the anamnesis and the identification typed in the system.
// They only warn: nothing is changed, calculated or classified (no norms, no scores).
import {INSTRUMENTS} from './prompts.mjs';

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const toBr = iso => ISO.test(iso || '') ? iso.split('-').reverse().join('/') : '';
function brToIso(v) { const m = String(v || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; }
/** Whole years between two ISO dates. */
export function yearsBetween(birth, at) {
  if (!ISO.test(birth || '') || !ISO.test(at || '')) return null;
  const [by, bm, bd] = birth.split('-').map(Number), [ry, rm, rd] = at.split('-').map(Number);
  let y = ry - by; if (rm < bm || (rm === bm && rd < bd)) y--; return y;
}
const isDataTable = x => x.type === 'table' && (x.rows || []).length > 1;
/** A results table whose rows after the header are all blank. */
const isEmptyTable = t => t.rows.slice(1).every(r => r.slice(1).every(c => !String(c ?? '').trim()));

/**
 * @param base inspected base document (elements, markers, identification)
 * @param anamnesisText the anamnesis paragraphs joined
 * @param e the evaluation as stored ({patient_name, birth_date, start_date, end_date})
 * @returns [{level:'danger'|'warn', text}]
 */
export function consistencyChecks(base, anamnesisText, e, today = new Date().toISOString().slice(0, 10)) {
  const out = [], id = base?.identification || {}, warn = text => out.push({level: 'warn', text}), danger = text => out.push({level: 'danger', text});
  const baseName = String(id['Nome'] || '').trim();
  if (baseName && baseName !== '-' && e.patient_name && fold(baseName) !== fold(e.patient_name))
    warn(`Nome diferente: no arquivo base está "${baseName}", no sistema "${e.patient_name}".`);
  const baseBirth = brToIso(id['Data de Nascimento']);
  if (baseBirth && e.birth_date && baseBirth !== e.birth_date)
    warn(`Data de nascimento diferente: arquivo base ${toBr(baseBirth)}, sistema ${toBr(e.birth_date)}.`);
  const birth = e.birth_date || baseBirth, at = ISO.test(e.end_date || '') ? e.end_date : today;
  const baseAge = String(id['Idade'] || '').match(/(\d+)\s*ano/i);
  const years = yearsBetween(birth, at);
  if (baseAge && years !== null && Number(baseAge[1]) !== years)
    warn(`Idade no arquivo base (${baseAge[1]} anos) não confere com a data de nascimento (${years} anos em ${toBr(at)}).`);
  if (ISO.test(e.start_date || '') && ISO.test(e.end_date || '') && e.start_date > e.end_date)
    danger(`Datas trocadas: início (${toBr(e.start_date)}) depois da finalização (${toBr(e.end_date)}).`);
  if (birth && ISO.test(e.start_date || '') && birth > e.start_date) danger('A data de nascimento é posterior ao início da avaliação.');

  const tables = (base?.elements || []).filter(isDataTable);
  const empty = tables.filter(isEmptyTable).length;
  if (empty) warn(`${empty} ${empty === 1 ? 'tabela de resultados está' : 'tabelas de resultados estão'} sem valores preenchidos no arquivo base.`);
  // Instruments the anamnesis mentions but no table/text of the base document has.
  const baseText = (base?.elements || []).map(x => x.type === 'table' ? x.rows.flat().join(' ') : x.text || '').join(' ');
  const missing = INSTRUMENTS.filter(i => i.re.test(anamnesisText || '') && !i.re.test(baseText)).map(i => i.name);
  if (missing.length) warn(`A anamnese cita ${missing.join(', ')}, mas o arquivo base não tem resultados desse instrumento.`);
  return out;
}

/** Plan against the base document: instruments marked as applied with no results in it, and what is still only planned. */
export function planChecks(base, items) {
  const out = [], baseText = fold((base?.elements || []).map(x => x.type === 'table' ? x.rows.flat().join(' ') : x.text || '').join(' '));
  const found = name => { const known = INSTRUMENTS.find(i => i.name === name); return known ? known.re.test(baseText) || known.re.test(fold(name)) && baseText.includes(fold(name)) : baseText.includes(fold(name)); };
  const applied = (items || []).filter(i => i.status === 'applied').map(i => i.instrument);
  const missing = applied.filter(n => !found(n));
  if (missing.length) out.push({level: 'warn', text: `Aplicados no plano, mas sem resultados no arquivo base: ${missing.join(', ')}.`});
  const pending = (items || []).filter(i => i.status === 'planned').map(i => i.instrument);
  if (pending.length) out.push({level: 'info', text: `Ainda não marcados como aplicados no plano: ${pending.join(', ')}.`});
  return out;
}
