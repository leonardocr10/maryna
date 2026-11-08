// Devolutiva schedule ("agenda de devolutivas"): reads the clinic's spreadsheet (CSV with ";", exported by Excel) once.
// Columns, by header: PACIENTE; IDADE; SUSPEITA DIAGNOSTICA; TESTE A SER APLICADO; INICIO; PRONTOS?; DEVOLUTIVA.
// A row without a devolutiva date is "pendente", whatever text the DEVOLUTIVA column has ("retorna só em agosto").
// The texts are kept exactly as typed; dates found in them ("FINALIZADO DIA 13/05/2026", "OK DIA 09/06/2026") are also
// stored as ISO dates so the screen can sort and filter.

/** Splits CSV text into rows of fields; handles quotes ("a;b", "say ""hi"""), CRLF and a UTF-8 BOM. */
export function parseCsv(text, sep = ';') {
  const s = String(text || '').replace(/^﻿/, '');
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** First valid dd/mm/yyyy (or yyyy-mm-dd) date inside a text, as ISO; null when there is none. */
export function dateInText(v) {
  const s = String(v || '');
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  let iso = m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  if (!iso) {
    m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (!m) return null;
    iso = `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  const d = new Date(iso + 'T12:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

const key = h => String(h || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const clean = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Patient name for matching a spreadsheet row with an evaluation: no accents, case or extra spaces. */
export const nameKey = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Pairs spreadsheet rows (newest position first) with evaluations of the same patient name (newest first), one each.
 *  `sheet`: [{id, patient_name, position}] not linked yet; `evals`: [{id, name, created_at}] not linked to a sheet row. */
export function agendaLinks(sheet, evals) {
  const free = new Map();
  for (const e of [...evals].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))) {
    const k = nameKey(e.name); if (!k) continue;
    if (!free.has(k)) free.set(k, []); free.get(k).push(e.id);
  }
  const out = [];
  for (const r of [...sheet].sort((a, b) => b.position - a.position)) {
    const id = free.get(nameKey(r.patient_name))?.shift(); if (id) out.push({row: r.id, evaluation: id});
  }
  return out;
}

/** "Prontos?" is a Sim/Não choice. A free text from the spreadsheet ("pronto", "OK DIA 09/06") means Sim and is kept
 *  in the notes (`moved`); empty means Não. */
export function readiness(v) {
  const text = clean(v, 160), k = key(text);
  if (!text || k === 'NAO' || k === 'N') return {value: 'Não', moved: ''};
  return {value: 'Sim', moved: k === 'SIM' || k === 'S' ? '' : text};
}
/** Notes with the old "Prontos?" text in front ("Prontos: pronto · notes"). */
export const notesWithReadiness = (notes, moved, max = 600) => (moved ? ['Prontos: ' + moved, notes].filter(Boolean).join(' · ') : notes || '').slice(0, max);

/** Spreadsheet rows to schedule records. Rows without a patient name are blank lines and are skipped. */
export function agendaFromCsv(text) {
  const rows = parseCsv(text);
  const head = (rows.shift() || []).map(key);
  const at = n => head.indexOf(n);
  const col = {patient: at('PACIENTE'), age: at('IDADE'), notes: at('SUSPEITADIAGNOSTICA'), tests: at('TESTEASERAPLICADO'),
    start: at('INICIO'), ready: at('PRONTOS'), delivery: at('DEVOLUTIVA')};
  if (col.patient < 0) throw new Error('Não encontrei a coluna PACIENTE na primeira linha do arquivo.');
  const get = (r, i, max = 300) => i < 0 ? '' : clean(r[i], max);
  const out = [];
  for (const r of rows) {
    const patient = get(r, col.patient, 160); if (!patient) continue;
    const tests = get(r, col.tests), delivery = get(r, col.delivery), ready = readiness(get(r, col.ready, 160));
    out.push({patient_name: patient, age_text: get(r, col.age, 40), notes: notesWithReadiness(get(r, col.notes, 600), ready.moved), tests_text: tests,
      tests_done_date: dateInText(tests), start_text: get(r, col.start, 120), readiness: ready.value,
      delivery_text: delivery, delivery_date: dateInText(delivery)});
  }
  return out;
}

/** "feita" (date reached), "agendada" (future date) or "pendente" (no date yet). */
export function agendaStatus(deliveryDate, today = new Date().toLocaleDateString('sv-SE')) {
  return !deliveryDate ? 'pendente' : deliveryDate <= today ? 'feita' : 'agendada';
}
