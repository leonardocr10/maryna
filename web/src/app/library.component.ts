import {Component, HostListener, OnInit, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Api} from './api.service';
import {ConfirmService} from './confirm.service';
import {fold} from './shared';
import {IconComponent} from './ui/icon.component';
import {FilterSelectComponent} from './ui/filter-select.component';

type GuideFilter = 'all' | 'custom' | 'default';
const FILTERS: {value: GuideFilter; label: string}[] = [{value: 'all', label: 'Todos os guias'}, {value: 'custom', label: 'Com guia da clínica'}, {value: 'default', label: 'Sem guia da clínica'}];

/** One block of a guide on screen: heading, paragraph, bulleted or numbered list (only when the source text has it). */
type Block = {kind: 'h' | 'p' | 'ul' | 'ol'; text?: string; items?: string[]};

/** "Biblioteca de testes": the instruments the system recognises in the base tables and the guide the AI receives for each.
 *  Instruments on the left, the selected one's guide on the right. The AI uses the clinic's guide when there is one,
 *  otherwise the system default (api/src/prompts.mjs, instrumentGuides with the overrides of instrument_guides). */
@Component({
  selector: 'nl-library',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, FilterSelectComponent],
  template: `
<div class="pagehead lh"><span class="hicon"><nl-icon name="book"/></span>
  <div><h1>Biblioteca de testes</h1><p>Consulte os instrumentos reconhecidos e personalize os guias de interpretação.</p></div></div>

<div class="lib" [class.detail]="mobileDetail">
  <!-- Instruments -->
  <section class="card list" aria-label="Instrumentos">
    <div class="lhd">
      <h2>Instrumentos <span class="cnt">{{list.length}}</span></h2>
      <div class="ctl">
        <div class="search-box"><nl-icon name="search"/><input class="input" [ngModel]="q" (ngModelChange)="q=$event; refilter()" placeholder="Buscar instrumento…" aria-label="Buscar instrumento por nome ou sigla"></div>
        <nl-filter-select size="sm" [searchable]="false" [alignRight]="true" ariaLabel="Filtrar por guia" [options]="filterOptions" [value]="filterLabel()" (valueChange)="setFilter($event)"></nl-filter-select>
      </div>
    </div>
    <div class="items" role="listbox" aria-label="Instrumentos" (keydown)="listKey($event)" #listEl>
      <button *ngFor="let i of shown; trackBy: byId" type="button" role="option" class="item" [class.on]="sel?.id===i.id" [attr.aria-selected]="sel?.id===i.id" [attr.data-id]="i.id" (click)="pick(i)">
        <span class="nm">{{i.name}}</span>
        <span *ngIf="i.multi" class="tag">Multidimensional</span>
        <span *ngIf="i.custom_guide" class="tag ok" title="Tem guia da clínica">Guia da clínica</span>
        <span class="grow"></span><nl-icon name="chevr"/>
      </button>
      <div *ngIf="!shown.length" class="empty"><p>Nenhum instrumento encontrado.</p><button class="btn btn-secondary btn-sm" type="button" (click)="clearFilters()">Limpar filtros</button></div>
    </div>
    <div class="lft">{{list.length}} instrumentos · {{customCount()}} com guia da clínica<ng-container *ngIf="q.trim() || filter !== 'all'"> · {{shown.length}} {{shown.length === 1 ? 'resultado' : 'resultados'}}</ng-container></div>
  </section>

  <!-- Guide of the selected instrument -->
  <section class="card guide" *ngIf="sel as i" aria-live="polite">
    <button type="button" class="back" (click)="backToList()"><nl-icon name="chevl"/> Voltar aos instrumentos</button>
    <div class="ghd">
      <h2>{{i.name}}</h2>
      <span *ngIf="i.multi" class="tag">Multidimensional</span>
      <span class="grow"></span>
      <button *ngIf="canWrite() && !editing" class="btn btn-primary" type="button" (click)="startEdit()"><nl-icon name="edit"/> {{i.custom_guide ? 'Editar guia da clínica' : 'Escrever guia da clínica'}}</button>
    </div>
    <div class="tabs" role="tablist" aria-label="Guias" (keydown)="tabKey($event)">
      <button type="button" role="tab" id="tab-def" [attr.aria-selected]="tab==='default'" [attr.tabindex]="tab==='default' ? 0 : -1" [class.on]="tab==='default'" (click)="setTab('default')">Guia padrão</button>
      <button type="button" role="tab" id="tab-own" [attr.aria-selected]="tab==='custom'" [attr.tabindex]="tab==='custom' ? 0 : -1" [class.on]="tab==='custom'" (click)="setTab('custom')">Guia da clínica <span *ngIf="!i.custom_guide" class="tag">Não configurado</span></button>
    </div>
    <p class="inuse"><i [class.own]="!!i.custom_guide" aria-hidden="true"></i> Guia em uso pela IA: <b>{{i.custom_guide ? 'guia da clínica' : 'padrão do sistema'}}</b></p>

    <div class="gbody" role="tabpanel" [attr.aria-labelledby]="tab==='default' ? 'tab-def' : 'tab-own'">
      <ng-container *ngIf="editing; else view">
        <textarea class="input" rows="14" [(ngModel)]="draft" aria-label="Guia da clínica" [disabled]="busy"></textarea>
        <p class="caption">Este texto vai para a IA sempre que o instrumento aparecer na seção, no lugar do guia padrão. Não coloque dados de paciente. {{draft.trim().length}} de 30 a 6.000 caracteres.</p>
        <p *ngIf="saveError" class="err" role="alert">{{saveError}}</p>
        <div class="row">
          <button class="btn btn-primary btn-sm" type="button" [disabled]="busy || draft.trim().length<30 || draft.trim().length>6000" (click)="save(draft)">{{busy ? 'Salvando…' : 'Salvar guia da clínica'}}</button>
          <button class="btn btn-secondary btn-sm" type="button" [disabled]="busy" (click)="cancelEdit()">Cancelar</button>
          <span class="grow"></span>
          <button *ngIf="i.custom_guide" class="link" type="button" [disabled]="busy" (click)="resetToDefault()">Voltar ao guia padrão</button>
        </div>
      </ng-container>
      <ng-template #view>
        <ng-container *ngIf="tab==='default' || i.custom_guide; else empty">
          <div class="doc">
            <ng-container *ngFor="let b of blocks(tab==='default' ? i.default_guide : i.custom_guide)">
              <h3 *ngIf="b.kind==='h'">{{b.text}}</h3>
              <p *ngIf="b.kind==='p'">{{b.text}}</p>
              <ul *ngIf="b.kind==='ul'"><li *ngFor="let t of b.items">{{t}}</li></ul>
              <ol *ngIf="b.kind==='ol'"><li *ngFor="let t of b.items">{{t}}</li></ol>
            </ng-container>
          </div>
          <p *ngIf="i.planned_in" class="caption">Planejado em {{i.planned_in}} {{i.planned_in === 1 ? 'avaliação' : 'avaliações'}}.</p>
        </ng-container>
        <ng-template #empty>
          <div class="none"><p><b>Não configurado.</b> Sem guia da clínica, a IA usa o guia padrão do sistema para este instrumento.</p>
            <button *ngIf="canWrite()" class="btn btn-secondary btn-sm" type="button" (click)="startEdit()"><nl-icon name="edit"/> Escrever guia da clínica</button></div>
        </ng-template>
      </ng-template>
    </div>
  </section>
</div>
<p class="caption note">Para um instrumento novo ser reconhecido nas tabelas, ele precisa ser incluído em <span class="mono">api/src/prompts.mjs</span> (INSTRUMENTS).</p>`,
  styles: [`
:host{display:block}
nl-icon{--ico-size:16px}
.lh{margin-bottom:12px;gap:12px}
.lh .hicon{width:36px;height:36px;border-radius:10px;--ico-size:20px}
.lh h1{font-size:24px;line-height:30px}
.lh p{margin-top:0;font-size:13px;color:var(--text-3)}
.lib{display:grid;grid-template-columns:minmax(280px,1fr) 2fr;gap:16px;align-items:start}
.list{display:flex;flex-direction:column;position:sticky;top:12px;max-height:calc(100vh - 140px);overflow:hidden}
.lhd{padding:14px 14px 10px;display:flex;flex-direction:column;gap:10px;border-bottom:1px solid var(--divider)}
.lhd h2{margin:0;font-size:17px;display:flex;align-items:center;gap:8px}
.cnt{font-size:12px;font-weight:600;padding:2px 9px;border-radius:99px;background:var(--chip);color:var(--text-2)}
.ctl{display:grid;grid-template-columns:1fr auto;gap:8px}
.ctl .search-box .input{height:34px;font-size:13.5px}
.items{flex:1;min-height:0;overflow:auto;padding:4px 0}
.item{width:100%;display:flex;align-items:center;gap:8px;padding:9px 14px;border:0;border-left:3px solid transparent;background:none;cursor:pointer;color:var(--text);font:500 13.5px var(--font);text-align:left}
.item+.item{border-top:1px solid var(--divider)}
.item:hover{background:var(--chip)}
.item.on{background:var(--primary-soft);border-left-color:var(--primary);font-weight:600}
.item:focus-visible{outline:2px solid var(--primary);outline-offset:-2px}
.item nl-icon{color:var(--text-3);--ico-size:14px}
.nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tag{flex:none;font-size:11px;font-weight:500;padding:2px 8px;border-radius:99px;background:var(--chip);color:var(--text-2);white-space:nowrap}
.tag.ok{background:var(--primary-soft);color:var(--primary-text)}
.grow{flex:1}
.empty{padding:20px 14px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--text-2);font-size:13px}
.empty p{margin:0}
.lft{padding:10px 14px;border-top:1px solid var(--divider);font-size:12px;color:var(--caption,var(--text-3))}
.guide{padding:18px 22px;min-height:420px;display:flex;flex-direction:column;gap:12px}
.back{display:none}
.ghd{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ghd h2{margin:0;font-size:22px;font-weight:700}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--divider)}
.tabs button{display:inline-flex;align-items:center;gap:8px;padding:9px 12px;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;background:none;cursor:pointer;color:var(--text-2);font:500 14px var(--font)}
.tabs button.on{color:var(--primary-text);border-bottom-color:var(--primary);font-weight:600}
.tabs button:focus-visible{outline:2px solid var(--primary);outline-offset:2px;border-radius:6px}
.inuse{margin:0;display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text-2);padding-bottom:10px;border-bottom:1px solid var(--divider)}
.inuse i{width:8px;height:8px;border-radius:50%;background:var(--ok-dot,#1f8a68)}
.inuse i.own{background:var(--primary)}
.gbody{display:flex;flex-direction:column;gap:10px}
.doc{max-width:760px;font-size:14px;line-height:1.65;color:var(--text)}
.doc h3{font-size:15.5px;margin:16px 0 6px}.doc h3:first-child{margin-top:0}
.doc p{margin:0 0 12px}
.doc ul,.doc ol{margin:0 0 12px;padding-left:22px}.doc li{margin:0 0 6px}
.none{padding:18px;border:1px dashed var(--border-dashed,var(--border));border-radius:10px;display:flex;flex-direction:column;align-items:flex-start;gap:10px;font-size:13.5px;color:var(--text-2)}
.none p{margin:0}
textarea{width:100%;resize:vertical;font-size:13.5px;line-height:1.6}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.err{margin:0;font-size:13px;color:var(--danger,#c0392b)}
.note{margin-top:12px}
@media (max-width:760px){
  .lib{grid-template-columns:1fr}
  .list{position:static;max-height:none}
  .lib.detail .list{display:none}
  .lib:not(.detail) .guide{display:none}
  .back{display:inline-flex;align-items:center;gap:6px;align-self:flex-start;padding:0;border:0;background:none;color:var(--primary-text);font:600 13px var(--font);cursor:pointer}
}
`],
})
export class LibraryComponent implements OnInit {
  private api = inject(Api);
  private confirm = inject(ConfirmService);
  list: any[] = []; shown: any[] = []; sel: any = null;
  q = ''; filter: GuideFilter = 'all'; filterOptions = FILTERS.map(f => f.label);
  tab: 'default' | 'custom' = 'default';
  editing = false; draft = ''; busy = false; saveError = '';
  /** Small screens: the guide replaces the list until "Voltar aos instrumentos". */
  mobileDetail = false;

  async ngOnInit() { await this.load(); }
  async load() {
    try { this.list = await this.api.req<any[]>('GET', '/instruments'); } catch {}
    if (this.sel) this.sel = this.list.find(i => i.id === this.sel.id) || null;
    this.refilter();
    if (this.sel && !this.editing) this.tab = this.sel.custom_guide && this.tab === 'custom' ? 'custom' : this.tab;
  }
  canWrite() { const r = this.api.me()?.role; return r === 'admin' || r === 'psychologist'; }
  customCount() { return this.list.filter(i => i.custom_guide).length; }
  byId = (_: number, i: any) => i.id;
  filterLabel() { return FILTERS.find(f => f.value === this.filter)!.label; }
  setFilter(label: string) { this.filter = FILTERS.find(f => f.label === label)?.value || 'all'; this.refilter(); }
  clearFilters() { this.q = ''; this.filter = 'all'; this.refilter(); }
  /** Search by name or acronym, and the guide filter; the selection follows (first result when it was hidden). */
  refilter() {
    const q = fold(this.q.trim());
    this.shown = this.list.filter(i => (!q || fold(i.name).includes(q) || fold(i.id).includes(q))
      && (this.filter === 'all' || (this.filter === 'custom' ? !!i.custom_guide : !i.custom_guide)));
    if (this.editing) return;   // never switch away from an edit in progress
    if (!this.sel || !this.shown.some(i => i.id === this.sel.id)) this.select(this.shown[0] || null);
  }
  private select(i: any) { this.sel = i; this.tab = i?.custom_guide ? 'custom' : 'default'; this.editing = false; this.saveError = ''; }
  /** Leaving an edit with changes asks first: stay or discard. */
  private async leaveEdit() {
    if (!this.editing || this.draft.trim() === (this.sel?.custom_guide || this.sel?.default_guide || '').trim()) { this.editing = false; return true; }
    const discard = await this.confirm.ask({tone: 'danger', title: 'Descartar as alterações do guia?', body: 'O texto que você escreveu ainda não foi salvo.', ok: 'Descartar', cancel: 'Continuar editando'});
    if (discard) this.editing = false;
    return discard;
  }
  async pick(i: any) {
    if (i.id === this.sel?.id) { this.mobileDetail = true; return; }
    if (!await this.leaveEdit()) return;
    this.select(i); this.mobileDetail = true;
  }
  async setTab(t: 'default' | 'custom') { if (t === this.tab) return; if (!await this.leaveEdit()) return; this.tab = t; }
  async backToList() { if (!await this.leaveEdit()) return; this.mobileDetail = false; }
  startEdit() { if (!this.sel) return; this.tab = 'custom'; this.draft = this.sel.custom_guide || this.sel.default_guide; this.saveError = ''; this.editing = true; }
  async cancelEdit() { await this.leaveEdit(); }
  async save(guide: string) {
    if (!this.sel) return;
    this.busy = true; this.saveError = '';
    try {
      await this.api.req('PUT', `/instruments/${this.sel.id}`, {guide});
      this.editing = false;
      await this.load();
      this.tab = this.sel?.custom_guide ? 'custom' : 'default';
      this.api.notify(guide ? 'Guia da clínica salvo.' : 'Voltou ao guia padrão.');
    } catch { this.saveError = 'Não foi possível salvar. Seu texto continua aqui; tente de novo.'; }
    finally { this.busy = false; }
  }
  async resetToDefault() {
    if (!await this.confirm.ask({title: 'Voltar ao guia padrão?', body: 'O guia da clínica deste instrumento é apagado e a IA passa a usar o guia padrão do sistema.', ok: 'Voltar ao padrão'})) return;
    await this.save('');
  }
  /** Splits a guide into headings, paragraphs and lists only where the text already has that structure. */
  blocks(text: string): Block[] {
    const out: Block[] = [];
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim();
      if (!line) { out.push({kind: 'p', text: ''}); continue; }
      const h = line.match(/^#{1,3}\s+(.*)$/), ul = line.match(/^[-•*]\s+(.*)$/), ol = line.match(/^\d+[.)]\s+(.*)$/);
      const last = out[out.length - 1];
      if (h) out.push({kind: 'h', text: h[1]});
      else if (ul) { if (last?.kind === 'ul') last.items!.push(ul[1]); else out.push({kind: 'ul', items: [ul[1]]}); }
      else if (ol) { if (last?.kind === 'ol') last.items!.push(ol[1]); else out.push({kind: 'ol', items: [ol[1]]}); }
      else if (last?.kind === 'p' && last.text) last.text += ' ' + line;
      else out.push({kind: 'p', text: line});
    }
    return out.filter(b => b.kind !== 'p' || b.text);
  }
  /** Arrow keys move through the list (focus follows the selection). */
  listKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const at = this.shown.findIndex(i => i.id === this.sel?.id), next = this.shown[Math.max(0, Math.min(this.shown.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (!next) return;
    this.pick(next).then(() => setTimeout(() => (document.querySelector(`nl-library .item[data-id="${next.id}"]`) as HTMLElement | null)?.focus()));
  }
  tabKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    this.setTab(this.tab === 'default' ? 'custom' : 'default').then(() => setTimeout(() => (document.getElementById(this.tab === 'default' ? 'tab-def' : 'tab-own') as HTMLElement | null)?.focus()));
  }
  @HostListener('window:beforeunload', ['$event']) unsaved(e: BeforeUnloadEvent) { if (this.editing && this.draft.trim() !== (this.sel?.custom_guide || this.sel?.default_guide || '').trim()) e.preventDefault(); }
}
