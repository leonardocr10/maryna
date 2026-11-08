import {Component, ElementRef, EventEmitter, Input, Output, ViewChild} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {IconComponent} from './icon.component';
import {STATUS, ageText, brDate, listStatus} from '../shared';

export interface PaletteScreen {id: string; label: string; icon: string}
interface Row {kind: 'eval' | 'menu'; id: string; title: string; sub: string; tag: string; icon?: string; initials?: string}

const fold = (s: string) => (s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const RECENT = 'nl-recent';
/** Ids of the evaluations opened last on this browser (only ids: names come from the list loaded after sign-in). */
export function rememberRecent(id: string) {
  try { const list = JSON.parse(localStorage.getItem(RECENT) || '[]').filter((x: string) => x !== id); localStorage.setItem(RECENT, JSON.stringify([id, ...list].slice(0, 8))); } catch {}
}
function recentIds(): string[] { try { const v = JSON.parse(localStorage.getItem(RECENT) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }

/** Ctrl+K search: evaluations by patient name and the app's screens, keyboard first (↑ ↓ Enter, Esc). */
@Component({
  selector: 'nl-command-palette',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
<div class="cp-bg" (mousedown)="$event.target===$event.currentTarget && closed.emit()">
  <div class="cp" role="dialog" aria-modal="true" aria-label="Buscar">
    <div class="cp-in"><nl-icon name="search"/>
      <input #box [(ngModel)]="q" (ngModelChange)="at=0" (keydown)="key($event)" placeholder="Buscar paciente, avaliação ou tela…" aria-label="Buscar paciente, avaliação ou tela" autocomplete="off" role="combobox" aria-controls="cp-list" [attr.aria-activedescendant]="rows().length ? 'cp-' + at : null">
      <kbd>Esc</kbd></div>
    <div id="cp-list" class="cp-list" role="listbox">
      <ng-container *ngFor="let g of groups(); let gi=index">
        <p class="cp-h">{{g.label}}</p>
        <button *ngFor="let r of g.rows" type="button" role="option" [id]="'cp-' + r.i" [class.on]="r.i===at" [attr.aria-selected]="r.i===at" (mousemove)="at=r.i" (click)="pick(r)">
          <span class="cp-ic" [class.av]="r.kind==='eval'"><ng-container *ngIf="r.kind==='eval'">{{r.initials}}</ng-container><nl-icon *ngIf="r.kind==='menu'" [name]="r.icon || 'doc'"/></span>
          <span class="cp-tx"><b>{{r.title}}</b><small>{{r.sub}}</small></span>
          <span class="cp-tag">{{r.tag}}</span>
        </button>
      </ng-container>
      <p *ngIf="!rows().length" class="cp-empty">Nada encontrado para "{{q}}".</p>
    </div>
    <div class="cp-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navegar</span><span><kbd>Enter</kbd> abrir</span><span><kbd>Esc</kbd> fechar</span></div>
  </div>
</div>`,
  styles: [`
.cp-bg{position:fixed;inset:0;z-index:70;background:rgba(8,24,22,.35);display:flex;justify-content:center;align-items:flex-start;padding:10vh 16px 16px}
.cp{width:min(620px,100%);max-height:70vh;display:flex;flex-direction:column;background:var(--card);border:1px solid var(--border-card);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.25);overflow:hidden}
.cp-in{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--divider);--ico-size:20px;color:var(--text-3)}
.cp-in input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:500 16px var(--font);color:var(--text)}
kbd{font:500 11px var(--mono);color:var(--text-3);background:var(--chip);border:1px solid var(--border-card);border-radius:5px;padding:1px 5px}
.cp-list{overflow:auto;padding:6px}
.cp-h{margin:8px 10px 4px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--caption,var(--text-3))}
.cp-list button{display:flex;align-items:center;gap:12px;width:100%;padding:8px 10px;border:0;border-left:3px solid transparent;border-radius:8px;background:none;text-align:left;cursor:pointer;color:var(--text)}
.cp-list button.on{background:var(--primary-soft);border-left-color:var(--primary)}
.cp-ic{width:34px;height:34px;flex:none;border-radius:8px;display:grid;place-items:center;background:var(--chip);color:var(--text-2);--ico-size:17px}
.cp-ic.av{background:var(--primary-soft);color:var(--primary-text);font:600 12px var(--font)}
.cp-tx{flex:1;min-width:0;display:flex;flex-direction:column}
.cp-tx b{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cp-tx small{font-size:12px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cp-tag{font-size:12px;font-weight:600;color:var(--text-3)}
.cp-empty{padding:18px;text-align:center;color:var(--text-3);font-size:13px}
.cp-foot{display:flex;gap:16px;padding:8px 14px;border-top:1px solid var(--divider);font-size:12px;color:var(--text-3)}
.cp-foot kbd{margin-right:3px}
`],
})
export class CommandPaletteComponent {
  @Input() evaluations: any[] = [];
  @Input() screens: PaletteScreen[] = [];
  @Output() openEvaluation = new EventEmitter<string>();
  @Output() goScreen = new EventEmitter<string>();
  @Output() closed = new EventEmitter<void>();
  @ViewChild('box') box?: ElementRef<HTMLInputElement>;
  q = ''; at = 0;

  ngAfterViewInit() { setTimeout(() => this.box?.nativeElement.focus()); }

  private evalRow(e: any): Row {
    const name = e.patient_name || 'Sem nome', parts = name.trim().split(/\s+/);
    const st = STATUS[listStatus(e)], age = ageText(e.birth_date);
    return {kind: 'eval', id: e.id, title: name, sub: [st.label, age, e.start_date ? 'início ' + brDate(e.start_date) : 'criada ' + brDate(e.created_at)].filter(Boolean).join(' · '),
      tag: 'Avaliação', initials: ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()};
  }
  groups(): {label: string; rows: (Row & {i: number})[]}[] {
    const q = fold(this.q.trim()), out: {label: string; rows: Row[]}[] = [];
    if (!q) {
      const byId = new Map(this.evaluations.map(e => [e.id, e]));
      const recent = recentIds().map(id => byId.get(id)).filter(Boolean).map(e => this.evalRow(e));
      const rest = this.evaluations.filter(e => !recentIds().includes(e.id)).slice(0, Math.max(0, 6 - recent.length)).map(e => this.evalRow(e));
      if (recent.length) out.push({label: 'Abertos recentemente', rows: recent});
      if (rest.length) out.push({label: 'Avaliações', rows: rest});
      out.push({label: 'Ir para', rows: this.screens.map(s => ({kind: 'menu' as const, id: s.id, title: s.label, sub: 'Menu', tag: 'Menu', icon: s.icon}))});
    } else {
      const words = q.split(/\s+/);
      const evals = this.evaluations.filter(e => words.every(w => fold(e.patient_name).includes(w))).slice(0, 12).map(e => this.evalRow(e));
      const menus = this.screens.filter(s => words.every(w => fold(s.label).includes(w))).map(s => ({kind: 'menu' as const, id: s.id, title: s.label, sub: 'Menu', tag: 'Menu', icon: s.icon}));
      if (evals.length) out.push({label: 'Avaliações', rows: evals});
      if (menus.length) out.push({label: 'Telas', rows: menus});
    }
    let i = 0;
    return out.map(g => ({label: g.label, rows: g.rows.map(r => ({...r, i: i++}))}));
  }
  rows() { return this.groups().flatMap(g => g.rows); }
  key(e: KeyboardEvent) {
    const n = this.rows().length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); this.at = (this.at + 1) % n; this.scroll(); }
    else if (e.key === 'ArrowUp' && n) { e.preventDefault(); this.at = (this.at - 1 + n) % n; this.scroll(); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = this.rows()[this.at]; if (r) this.pick(r); }
    else if (e.key === 'Escape') { e.preventDefault(); this.closed.emit(); }
  }
  private scroll() { setTimeout(() => document.getElementById('cp-' + this.at)?.scrollIntoView({block: 'nearest'})); }
  pick(r: Row) { if (r.kind === 'eval') this.openEvaluation.emit(r.id); else this.goScreen.emit(r.id); this.closed.emit(); }
}
