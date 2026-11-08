import {Component, EventEmitter, OnInit, Output, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Api} from './api.service';
import {brDate, fold, todayISO} from './shared';
import {IconComponent} from './ui/icon.component';
import {PagerComponent} from './ui/pager.component';

type AgendaStatus = 'pendente' | 'agendada' | 'feita';
interface AgendaRow {
  id: string; source: 'import' | 'evaluation'; evaluation_id: string | null; evaluation_status: string | null;
  patient: string; age: string; notes: string; tests: string; tests_done_date: string | null; start: string; readiness: string;
  delivery_text: string; delivery_date: string | null; status: AgendaStatus;
}
type Filter = 'all' | AgendaStatus;
const STATUS_LABEL: Record<AgendaStatus, {label: string; css: string}> = {
  pendente: {label: 'Pendente', css: 'warn'}, agendada: {label: 'Agendada', css: 'idle'}, feita: {label: 'Feita', css: 'ok'}};

/** "Devolutivas": the clinic's spreadsheet (imported once) plus one row per evaluation created in the app.
 *  For evaluation rows the end of testing and the devolutiva date come from the evaluation ("Entrega" in the report). */
@Component({
  selector: 'nl-devolutivas',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PagerComponent],
  template: `
<div class="pagehead">
  <span class="hicon"><nl-icon name="calendar"/></span>
  <div><h1>Devolutivas</h1><p>Fim da testagem e data da devolutiva de cada paciente. Cada avaliação nova entra aqui sozinha.</p></div>
  <ng-container *ngIf="loaded && !imported && canWrite()">
    <label class="btn btn-primary" for="agenda-csv" [class.disabled]="importing"><nl-icon name="upload"/> {{importing ? 'Importando…' : 'Importar planilha (CSV)'}}</label>
    <input id="agenda-csv" class="file-input" type="file" accept=".csv,text/csv" [disabled]="importing" (change)="importFile($event)">
  </ng-container>
</div>

<div class="kpis">
  <div class="card card-raised kpi"><span class="kpi-icon"><nl-icon name="table"/></span><div><div class="kpi-label">Registros</div><div class="kpi-value">{{rows.length}}</div><div class="kpi-sub">{{fromEval()}} de avaliações do sistema</div></div></div>
  <div class="card card-raised kpi"><span class="kpi-icon warn"><nl-icon name="clock"/></span><div><div class="kpi-label">Pendentes</div><div class="kpi-value">{{count('pendente')}}</div><div class="kpi-sub">Sem data de devolutiva</div></div></div>
  <div class="card card-raised kpi"><span class="kpi-icon review"><nl-icon name="calendar"/></span><div><div class="kpi-label">Agendadas</div><div class="kpi-value">{{count('agendada')}}</div><div class="kpi-sub">Data marcada a partir de amanhã</div></div></div>
  <div class="card card-raised kpi"><span class="kpi-icon ok"><nl-icon name="check"/></span><div><div class="kpi-label">Feitas no mês</div><div class="kpi-value">{{doneThisMonth()}}</div><div class="kpi-sub">{{count('feita')}} no total</div></div></div>
</div>

<section class="card">
  <div class="listhead"><h2>Agenda de devolutivas <span>({{filtered().length}})</span></h2></div>
  <div class="filters">
    <div class="search-box"><nl-icon name="search"/><input class="input" [value]="query" (input)="query=$any($event.target).value;page=1" placeholder="Buscar paciente, convênio ou observação…" aria-label="Buscar na agenda de devolutivas"></div>
    <button *ngFor="let f of filters" type="button" class="fchip" [class.on]="filter===f.id" [attr.aria-pressed]="filter===f.id" (click)="filter=f.id;page=1">{{f.label}} <b>{{f.id==='all' ? rows.length : count(f.id)}}</b></button>
  </div>
  <div class="tablewrap">
    <table class="tbl">
      <thead><tr><th>Paciente</th><th>Idade</th><th>Fim da testagem</th><th>Convênio / início</th><th>Prontos?</th><th>Observações</th><th>Devolutiva</th></tr></thead>
      <tbody>
        <tr *ngFor="let r of pageRows(); trackBy: byId" tabindex="0" [class.sel]="sel?.id===r.id" (click)="select(r)" (keydown.enter)="select(r)">
          <td><b>{{r.patient}}</b><small *ngIf="r.source==='evaluation'" class="src"><nl-icon name="clipboard"/> Avaliação no sistema</small></td>
          <td>{{r.age || '—'}}</td>
          <td>{{r.tests_done_date ? brDate(r.tests_done_date) : (r.tests || '—')}}</td>
          <td>{{r.start || '—'}}</td>
          <td>{{r.readiness || '—'}}</td>
          <td class="notes">{{r.notes || '—'}}</td>
          <td><span [class]="'badge '+label(r).css">{{label(r).label}}</span><small class="dt">{{r.delivery_date ? brDate(r.delivery_date) : r.delivery_text}}</small></td>
        </tr>
      </tbody>
    </table>
    <p *ngIf="!filtered().length" class="empty-row">{{rows.length ? 'Nenhum registro encontrado.' : emptyText()}}</p>
  </div>
  <nl-pager *ngIf="filtered().length" [total]="filtered().length" [page]="page" [perPage]="per" noun="registros" (pageChange)="page=$event" (perPageChange)="per=$event"></nl-pager>
</section>

<!-- Record panel: notes and status columns are editable; the date only on spreadsheet rows (evaluations use "Entrega"). -->
<div *ngIf="sel" class="overlay" (click)="sel=null"></div>
<aside *ngIf="sel" class="card side" role="dialog" aria-modal="true" [attr.aria-label]="'Devolutiva de ' + sel.patient" (keydown.escape)="sel=null">
  <div class="shead"><div><h3>{{sel.patient}}</h3><small>{{sel.age || 'Idade não informada'}} · {{sel.source==='evaluation' ? 'avaliação no sistema' : 'da planilha'}}</small></div>
    <button class="link close" (click)="sel=null" aria-label="Fechar">×</button></div>
  <dl>
    <dt>Fim da testagem</dt><dd>{{sel.tests_done_date ? brDate(sel.tests_done_date) : (sel.source==='evaluation' ? 'Preencha a data de término na identificação da avaliação' : sel.tests || '—')}}</dd>
    <dt *ngIf="sel.source==='import' && sel.delivery_text">Na planilha</dt><dd *ngIf="sel.source==='import' && sel.delivery_text">{{sel.delivery_text}}</dd>
  </dl>
  <label class="fld">Data da devolutiva
    <input *ngIf="sel.source==='import'" class="input" type="date" [(ngModel)]="draft.delivery_date" [disabled]="!canWrite()">
    <span *ngIf="sel.source==='evaluation'" class="ro">{{sel.delivery_date ? brDate(sel.delivery_date) : 'Ainda não registrada'}}</span>
  </label>
  <p *ngIf="sel.source==='evaluation'" class="caption">A data entra sozinha quando a entrega é registrada no laudo aprovado (Entrega).</p>
  <label class="fld">Convênio / início<input class="input" [(ngModel)]="draft.start" maxlength="120" [disabled]="!canWrite()"></label>
  <label class="fld">Prontos?<input class="input" [(ngModel)]="draft.readiness" maxlength="160" [disabled]="!canWrite()"></label>
  <label class="fld">Observações<textarea class="input" rows="3" [(ngModel)]="draft.notes" maxlength="600" [disabled]="!canWrite()"></textarea></label>
  <div class="acts">
    <button *ngIf="sel.evaluation_id" class="btn btn-sm" (click)="openEvaluation.emit(sel.evaluation_id)"><nl-icon name="external"/> Abrir avaliação</button>
    <span class="grow"></span>
    <button *ngIf="canWrite()" class="btn btn-primary btn-sm" [disabled]="saving || !changed()" (click)="save()"><nl-icon name="save"/> {{saving ? 'Salvando…' : 'Salvar'}}</button>
  </div>
</aside>`,
  styles: [`
:host{display:block}
.file-input{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
.pagehead label.btn{cursor:pointer}.pagehead label.btn.disabled{opacity:.6;pointer-events:none}
.pagehead:has(.file-input:focus-visible) label.btn{outline:2px solid var(--primary);outline-offset:2px}
.tbl td b{display:block;font-weight:600}
.src{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:var(--primary-text);--ico-size:13px;margin-top:2px}
.dt{display:block;font-size:12px;color:var(--text-3);margin-top:3px}
.notes{max-width:260px;color:var(--text-2);font-size:12.5px}
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.18);z-index:40}
.side{position:fixed;top:72px;right:20px;bottom:20px;width:min(380px,calc(100vw - 40px));z-index:41;padding:18px;overflow:auto;display:flex;flex-direction:column;gap:12px}
.shead{display:flex;align-items:flex-start;gap:10px}.shead>div{flex:1}.shead h3{font-size:16px;font-weight:650}.shead small{font-size:12px;color:var(--text-3)}
.close{font-size:22px;line-height:1;background:none;border:0;cursor:pointer;color:var(--text-2)}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:13px}dt{color:var(--text-3)}dd{margin:0}
.fld{display:flex;flex-direction:column;gap:5px;font-size:12.5px;font-weight:600;color:var(--text-2)}
.ro{font-weight:400;font-size:13.5px;color:var(--text)}
.acts{display:flex;align-items:center;gap:8px;margin-top:auto;padding-top:6px}.grow{flex:1}
`],
})
export class DevolutivasComponent implements OnInit {
  private api = inject(Api);
  @Output() openEvaluation = new EventEmitter<string>();
  rows: AgendaRow[] = [];
  imported = false; loaded = false; importing = false; saving = false;
  query = ''; filter: Filter = 'pendente'; page = 1; per = 25;
  sel: AgendaRow | null = null;
  draft = {delivery_date: '', start: '', readiness: '', notes: ''};
  readonly filters: {id: Filter; label: string}[] = [
    {id: 'pendente', label: 'Pendentes'}, {id: 'agendada', label: 'Agendadas'}, {id: 'feita', label: 'Feitas'}, {id: 'all', label: 'Todas'}];
  readonly brDate = brDate;

  ngOnInit() { this.load(); }
  canWrite() { const r = this.api.me()?.role; return r === 'admin' || r === 'psychologist'; }

  async load() {
    try { const r = await this.api.req<{imported: boolean; rows: AgendaRow[]}>('GET', '/devolutiva-agenda'); this.rows = r.rows; this.imported = r.imported; }
    catch {} finally { this.loaded = true; }
  }

  async importFile(ev: Event) {
    const input = ev.target as HTMLInputElement, file = input.files?.[0]; input.value = '';
    if (!file || this.importing) return;
    this.importing = true;
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await this.api.req<{imported: number; with_date: number}>('POST', '/devolutiva-agenda/import', fd);
      this.api.notify(`Planilha importada: ${r.imported} pacientes, ${r.with_date} com data de devolutiva.`);
      this.filter = 'all'; await this.load();
    } catch {} finally { this.importing = false; }
  }

  label(r: AgendaRow) { return STATUS_LABEL[r.status]; }
  count(s: AgendaStatus) { return this.rows.filter(r => r.status === s).length; }
  fromEval() { return this.rows.filter(r => r.source === 'evaluation').length; }
  doneThisMonth() { const m = todayISO().slice(0, 7); return this.rows.filter(r => r.status === 'feita' && r.delivery_date?.startsWith(m)).length; }
  emptyText() { return this.imported || !this.canWrite() ? 'Nenhum registro ainda. Cada avaliação criada entra aqui.' : 'Importe a planilha de devolutivas (uma vez só). Depois, cada avaliação criada entra aqui sozinha.'; }
  byId(_: number, r: AgendaRow) { return r.id; }

  /** Pending first by end of testing (oldest waiting longest); dated rows by devolutiva date, most recent first. */
  filtered() {
    const q = fold(this.query.trim());
    return this.rows.filter(r => (this.filter === 'all' || r.status === this.filter) &&
      (!q || fold([r.patient, r.start, r.readiness, r.notes, r.tests, r.delivery_text].join(' ')).includes(q)))
      .sort((a, b) => {
        const rank = (r: AgendaRow) => r.status === 'pendente' ? 0 : r.status === 'agendada' ? 1 : 2;
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        if (a.status === 'pendente') return (a.tests_done_date || '9999').localeCompare(b.tests_done_date || '9999');
        if (a.status === 'agendada') return (a.delivery_date || '').localeCompare(b.delivery_date || '');
        return (b.delivery_date || '').localeCompare(a.delivery_date || '');
      });
  }
  pageRows() { const f = this.filtered(); const last = Math.max(1, Math.ceil(f.length / this.per)); if (this.page > last) this.page = last; return f.slice((this.page - 1) * this.per, this.page * this.per); }

  select(r: AgendaRow) { this.sel = r; this.draft = {delivery_date: r.delivery_date || '', start: r.start, readiness: r.readiness, notes: r.notes}; }
  changed() {
    const s = this.sel; if (!s) return false;
    return this.draft.start !== s.start || this.draft.readiness !== s.readiness || this.draft.notes !== s.notes || (s.source === 'import' && this.draft.delivery_date !== (s.delivery_date || ''));
  }
  async save() {
    const s = this.sel; if (!s || this.saving) return;
    this.saving = true;
    try {
      const body: any = {start: this.draft.start, readiness: this.draft.readiness, notes: this.draft.notes};
      if (s.source === 'import') body.delivery_date = this.draft.delivery_date || null;
      const r = await this.api.req<AgendaRow>('PUT', `/devolutiva-agenda/${s.id}`, body);
      this.rows = this.rows.map(x => x.id === r.id ? r : x); this.select(r);
      this.api.notify('Registro salvo.');
    } catch {} finally { this.saving = false; }
  }
}
