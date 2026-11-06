// Manual mode (ChatGPT web): the section data as readable text, with tables as Markdown tables instead of JSON.

const LABELS = {
  trecho_da_secao: 'Trecho desta seção no arquivo base', anotacoes_anamnese: 'Anotações da anamnese', identificacao: 'Identificação',
  textos_das_secoes: 'Textos das seções', idade_em_anos: 'Idade',
};
const cell = v => String(v ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();

/** Markdown table; the first row is the header. Short rows are padded so every row has the same columns. */
export function markdownTable(rows) {
  const clean = (rows || []).map(r => (Array.isArray(r) ? r : []).map(cell)).filter(r => r.some(Boolean));
  if (!clean.length) return '';
  const cols = Math.max(...clean.map(r => r.length));
  const pad = r => [...r, ...Array(cols - r.length).fill('')];
  const line = r => '| ' + pad(r).join(' | ') + ' |';
  return [line(clean[0]), '| ' + Array(cols).fill('---').join(' | ') + ' |', ...clean.slice(1).map(line)].join('\n');
}

/** The empty "Interpretação…" box of the base document is where the text goes, not data. */
const isFieldMarker = rows => rows?.length === 1 && rows[0]?.length === 1 && /interpreta/i.test(String(rows[0][0]));

function elements(list) {
  const out = [];
  for (const e of list || []) {
    if (e?.type === 'table') { if (!isFieldMarker(e.rows)) { const t = markdownTable(e.rows); if (t) out.push(t); } }
    else { const t = String(e?.text ?? '').trim(); if (t) out.push(t); }
  }
  return out.join('\n\n');
}

/** Section data for a person to read and paste: titled blocks, paragraphs as text, tables as Markdown. */
export function readableSource(source = {}) {
  const parts = [];
  for (const [key, value] of Object.entries(source)) {
    if (value == null || value === '') continue;
    const label = LABELS[key] || key;
    if (key === 'trecho_da_secao') { const body = elements(value); if (body) parts.push('### ' + label + '\n\n' + body); }
    else if (Array.isArray(value)) { const body = value.map(v => String(v ?? '').trim()).filter(Boolean).join('\n\n'); if (body) parts.push('### ' + label + '\n\n' + body); }
    else if (typeof value === 'object') parts.push('### ' + label + '\n\n' + Object.entries(value).map(([k, v]) => '#### ' + k + '\n\n' + String(v ?? '').trim()).join('\n\n'));
    else parts.push(label + ': ' + String(value).trim());
  }
  return parts.join('\n\n');
}
