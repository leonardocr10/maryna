/**
 * Rich text for section editing. The plain text ("## " topic titles, blank line between paragraphs) stays the canonical
 * content used by the AI, checks and reader; the HTML only carries formatting for the Word export. The worker uses the
 * HTML only while its plain text still equals the saved content (same rules as textFromHtml below).
 */
const BLOCKS = new Set(['P', 'H3', 'LI', 'DIV']);
const INLINE = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SPAN', 'BR', 'SUB', 'SUP']);
const BLOCK_STYLES = ['text-align', 'line-height', 'margin-top', 'margin-bottom', 'margin-left'];
const INLINE_STYLES = ['font-size', 'color', 'background-color', 'font-weight', 'font-style', 'text-decoration-line', 'text-decoration', 'font-family'];
/** Fonts the editor offers; the Word export writes the same name in the run (worker/docx_worker.py). */
export const EDITOR_FONTS = ['Arial', 'Calibri', 'Cambria', 'Georgia', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Verdana'];
const fontOk = (v: string) => EDITOR_FONTS.includes(v.split(',')[0].replace(/["']/g, '').trim());

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Plain section text to editor HTML. */
export function htmlFromText(t: string): string {
  const out: string[] = [];
  for (const chunk of (t || '').replace(/\r/g, '').split(/\n\s*\n/)) {
    for (const raw of chunk.split('\n')) {
      const line = raw.trim(); if (!line) continue;
      const bold = /^\*\*([^*]{1,80})\*\*:?$/.exec(line);
      if (/^#{1,6}\s/.test(line) || bold) out.push(`<h3>${esc((bold ? bold[1] : line.replace(/^#+\s*/, '')).replace(/\*\*(.+?)\*\*/g, '$1'))}</h3>`);
      else out.push(`<p>${esc(line).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>`);
    }
  }
  return out.join('') || '<p><br></p>';
}

/** Editor HTML to plain section text. Must match plain_from_html in worker/docx_worker.py. */
export function textFromHtml(html: string): string {
  const box = document.createElement('div'); box.innerHTML = html || '';
  for (const br of Array.from(box.querySelectorAll('br'))) br.replaceWith(' ');
  const out: string[] = [];
  const walk = (el: Element) => {
    for (const c of Array.from(el.children)) {
      if (c.tagName === 'UL' || c.tagName === 'OL') { walk(c); continue; }
      const text = norm((c as HTMLElement).innerText ?? c.textContent ?? '');
      if (!text) continue;
      if (c.tagName === 'H3') out.push('## ' + text);
      else if (c.tagName === 'LI') out.push((el.tagName === 'OL' ? (Array.from(el.children).indexOf(c) + 1) + '. ' : '- ') + text);
      else out.push(text);
    }
  };
  walk(box);
  return out.join('\n\n');
}

function keepStyle(el: HTMLElement, allowed: string[]) {
  const kept = allowed.map(p => [p, el.style.getPropertyValue(p)]).filter(([p, v]) => v && v.length < 40 && !/url|expression|[;<>]/i.test(v) && (p !== 'font-family' || fontOk(v)));
  el.removeAttribute('style');
  for (const [p, v] of kept) el.style.setProperty(p, v);
  if (!el.getAttribute('style')) el.removeAttribute('style');
}

/** Keeps only the formatting the Word export understands; everything else becomes plain text. */
export function sanitizeHtml(html: string): string {
  const box = document.createElement('div'); box.innerHTML = html || '';
  const clean = (el: Element) => {
    for (const c of Array.from(el.children) as HTMLElement[]) {
      clean(c);
      let tag = c.tagName;
      if (tag === 'FONT') { const s = document.createElement('span'); if (c.getAttribute('color')) s.style.color = c.getAttribute('color')!; s.style.cssText += c.style.cssText; s.append(...Array.from(c.childNodes)); c.replaceWith(s); continue; }
      if (/^H[1-6]$/.test(tag) && tag !== 'H3') { const h = document.createElement('h3'); h.append(...Array.from(c.childNodes)); c.replaceWith(h); continue; }
      if (tag === 'DIV') { const p = document.createElement('p'); p.style.cssText = c.style.cssText; p.append(...Array.from(c.childNodes)); c.replaceWith(p); keepStyle(p, BLOCK_STYLES); continue; }
      if (!BLOCKS.has(tag) && !INLINE.has(tag) && tag !== 'UL' && tag !== 'OL') { c.replaceWith(...Array.from(c.childNodes)); continue; }
      for (const a of Array.from(c.attributes)) if (a.name !== 'style') c.removeAttribute(a.name);
      keepStyle(c, BLOCKS.has(tag) || tag === 'H3' ? BLOCK_STYLES : tag === 'SPAN' ? INLINE_STYLES : []);
      if (tag === 'SPAN' && !c.getAttribute('style')) c.replaceWith(...Array.from(c.childNodes));
    }
  };
  clean(box);
  // loose text or inline runs at the top level become their own paragraph
  let run: HTMLElement | null = null;
  for (const n of Array.from(box.childNodes)) {
    const block = n instanceof HTMLElement && (BLOCKS.has(n.tagName) || n.tagName === 'UL' || n.tagName === 'OL');
    if (block) { run = null; continue; }
    if (!run) { run = document.createElement('p'); box.insertBefore(run, n); }
    run.append(n);
  }
  return box.innerHTML;
}
