/** Word-level difference between two texts (longest common subsequence), for the section version view. */
export interface DiffPart {text: string; kind: 'same' | 'add' | 'del'}

export function wordDiff(before: string, after: string): DiffPart[] {
  // spaces and punctuation are their own tokens, so "mãe." -> "mãe," marks only the punctuation
  const tokens = (t: string) => (t || '').split(/(\s+|[.,;:!?()"«»—–-])/).filter(Boolean);
  const a = tokens(before), b = tokens(after);
  // Very long texts: show the whole old text removed and the new one added instead of an expensive table.
  if (a.length * b.length > 4_000_000) return [{text: before, kind: 'del'}, {text: after, kind: 'add'}];
  const n = a.length, m = b.length, lcs: Uint16Array[] = Array.from({length: n + 1}, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (text: string, kind: DiffPart['kind']) => { const last = out[out.length - 1]; if (last && last.kind === kind) last.text += text; else out.push({text, kind}); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push(a[i], 'same'); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) push(a[i++], 'del');
    else push(b[j++], 'add');
  }
  while (i < n) push(a[i++], 'del');
  while (j < m) push(b[j++], 'add');
  return out;
}
