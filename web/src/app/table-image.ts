/** Draws the reference tables of a section as one PNG (for pasting into ChatGPT as an image). */
export interface GridCell { text: string; rowspan?: number; colspan?: number; }
export interface RefTable { grid: GridCell[][]; caption?: string; }

const FONT = '13px "IBM Plex Sans", Arial, sans-serif', BOLD = '600 13px "IBM Plex Sans", Arial, sans-serif';
const PAD = 8, LINE = 18, MAX_COL = 260, MIN_COL = 60, GAP = 24, MARGIN = 16;

/** Places cells on a slot grid, honouring rowspan/colspan like an HTML table. */
function layout(grid: GridCell[][]) {
  const taken: boolean[][] = [];
  const placed: {c: GridCell; r: number; col: number; rs: number; cs: number; head: boolean}[] = [];
  grid.forEach((row, r) => {
    let col = 0;
    for (const c of row) {
      while (taken[r]?.[col]) col++;
      const rs = Math.max(1, c.rowspan || 1), cs = Math.max(1, c.colspan || 1);
      for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) (taken[r + i] ||= [])[col + j] = true;
      placed.push({c, r, col, rs, cs, head: r === 0});
      col += cs;
    }
  });
  const cols = Math.max(1, ...taken.map(t => t?.length || 0));
  return {placed, cols, rows: grid.length};
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const out: string[] = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > width && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

export async function tablesToPng(tables: RefTable[]): Promise<Blob | null> {
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe || !tables.length) return null;
  // measure: column widths from the longest word/line, capped; then row heights from wrapped text
  const plans = tables.map(t => {
    const {placed, cols, rows} = layout(t.grid);
    const widths = Array(cols).fill(MIN_COL);
    for (const p of placed) if (p.cs === 1) {
      probe.font = p.head ? BOLD : FONT;
      widths[p.col] = Math.min(MAX_COL, Math.max(widths[p.col], probe.measureText(String(p.c.text || '')).width + PAD * 2));
    }
    const span = (p: {col: number; cs: number}) => widths.slice(p.col, p.col + p.cs).reduce((a, b) => a + b, 0);
    const heights = Array(rows).fill(LINE + PAD * 2);
    for (const p of placed) {
      probe.font = p.head ? BOLD : FONT;
      const need = wrap(probe, p.c.text, span(p) - PAD * 2).length * LINE + PAD * 2;
      const per = need / p.rs;
      for (let i = 0; i < p.rs; i++) heights[p.r + i] = Math.max(heights[p.r + i], per);
    }
    return {t, placed, widths, heights, span, w: widths.reduce((a, b) => a + b, 0), h: heights.reduce((a, b) => a + b, 0) + (t.caption ? LINE + 6 : 0)};
  });
  const scale = 2;
  const W = Math.ceil(Math.max(...plans.map(p => p.w)) + MARGIN * 2);
  const H = Math.ceil(plans.reduce((a, p) => a + p.h, 0) + GAP * (plans.length - 1) + MARGIN * 2);
  const canvas = document.createElement('canvas');
  canvas.width = W * scale; canvas.height = H * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'top';
  let y = MARGIN;
  for (const p of plans) {
    const top = (r: number) => y + p.heights.slice(0, r).reduce((a: number, b: number) => a + b, 0);
    const left = (c: number) => MARGIN + p.widths.slice(0, c).reduce((a: number, b: number) => a + b, 0);
    for (const cell of p.placed) {
      const x = left(cell.col), cy = top(cell.r), w = p.span(cell), h = top(cell.r + cell.rs) - cy;
      ctx.fillStyle = cell.head ? '#eef3f1' : '#ffffff'; ctx.fillRect(x, cy, w, h);
      ctx.strokeStyle = '#9aa7a3'; ctx.lineWidth = 1; ctx.strokeRect(x + .5, cy + .5, w, h);
      ctx.font = cell.head ? BOLD : FONT; ctx.fillStyle = '#16201e';
      const lines = wrap(ctx, cell.c.text, w - PAD * 2);
      const startY = cy + (h - lines.length * LINE) / 2 + 2;
      lines.forEach((l, i) => ctx.fillText(l, x + PAD, startY + i * LINE));
    }
    y += p.heights.reduce((a: number, b: number) => a + b, 0);
    if (p.t.caption) { ctx.font = '12px "IBM Plex Sans", Arial, sans-serif'; ctx.fillStyle = '#5b6a66'; ctx.fillText(p.t.caption, MARGIN, y + 6); y += LINE + 6; }
    y += GAP;
  }
  return await new Promise(r => canvas.toBlob(b => r(b), 'image/png'));
}
