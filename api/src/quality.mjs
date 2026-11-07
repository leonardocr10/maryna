// How much the psychologist changed the AI text before approving it: 0 = approved as written, 100 = rewritten.
// Dice coefficient on word pairs: cheap enough for every section, and insensitive to small reorderings.
const pairs = text => {
  const w = String(text || '').toLowerCase().normalize('NFC').match(/[\p{L}\p{N}]+/gu) || [];
  const out = new Map();
  for (let i = 0; i < w.length - 1; i++) { const k = w[i] + ' ' + w[i + 1]; out.set(k, (out.get(k) || 0) + 1); }
  if (w.length === 1) out.set(w[0], 1);
  return out;
};
export function changedPercent(aiText, finalText) {
  const a = pairs(aiText), b = pairs(finalText);
  const total = [...a.values()].reduce((s, n) => s + n, 0) + [...b.values()].reduce((s, n) => s + n, 0);
  if (!total) return 0;
  let common = 0; for (const [k, n] of a) common += Math.min(n, b.get(k) || 0);
  return Math.round((1 - 2 * common / total) * 100);
}
/** Rows {section_key, ai_text, content} -> per section: texts, average and maximum change. */
export function qualityBySection(rows) {
  const by = new Map();
  for (const r of rows) { if (!r.ai_text) continue; const l = by.get(r.section_key) || []; l.push(changedPercent(r.ai_text, r.content)); by.set(r.section_key, l); }
  return [...by].map(([section_key, l]) => ({section_key, texts: l.length, avg_changed: Math.round(l.reduce((s, n) => s + n, 0) / l.length), max_changed: Math.max(...l), unchanged: l.filter(n => n === 0).length}))
    .sort((x, y) => y.avg_changed - x.avg_changed);
}
