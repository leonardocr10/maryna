import {Component, EventEmitter, HostListener, Input, OnInit, Output, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {Api} from './api.service';
import {STATUS, ageYears, brDate, fold, listStatus, todayISO} from './shared';
import {IconComponent} from './ui/icon.component';
import {FilterSelectComponent} from './ui/filter-select.component';
import {PagerComponent} from './ui/pager.component';

type Band = 'all' | 'infantil' | 'adulto' | 'idoso';
interface Row {id: string; name: string; birth: string; age: number | null; ageText: string; sex: string; schooling: string; created: string; last: any | null; count: number}
const ORDERS = ['Mais recentes', 'Nome (A–Z)', 'Nome (Z–A)', 'Idade', 'Status'];

/** "Pacientes": built from /patients plus each patient's evaluations (no extra backend). */
@Component({
  selector: 'nl-patients',
  standalone: true,
  imports: [CommonModule, IconComponent, FilterSelectComponent, PagerComponent],
  template: `
<div class="pagehead dh">
  <span class="hicon"><nl-icon name="users"/></span>
  <div><h1>Pacientes</h1><p>Pacientes cadastrados, a avaliação mais recente de cada um e o próximo passo.</p></div>
  <button class="btn btn-primary" (click)="create.emit()"><nl-icon name="plus"/> Nova avaliação</button>
</div>

<div class="kpis dk">
  <div class="card kpi" [title]="band('infantil') + ' até 17 anos · ' + (band('adulto') + band('idoso')) + ' adultos'"><span class="kpi-icon"><nl-icon name="users"/></span><div><div class="kpi-label">Total de pacientes</div><div class="kpi-value">{{rows().length}}</div></div></div>
  <div class="card kpi" title="Cadastrados neste mês"><span class="kpi-icon warn"><nl-icon name="plus"/></span><div><div class="kpi-label">Novos no mês</div><div class="kpi-value">{{monthNew()}}</div></div></div>
  <div class="card kpi" title="Última avaliação em rascunho ou em revisão"><span class="kpi-icon ok"><nl-icon name="clock"/></span><div><div class="kpi-label">Em andamento</div><div class="kpi-value">{{inProgress()}}</div></div></div>
  <div class="card kpi" title="Última avaliação aprovada"><span class="kpi-icon review"><nl-icon name="checkc"/></span><div><div class="kpi-label">Com laudo aprovado</div><div class="kpi-value">{{approved()}}</div></div></div>
</div>

<section class="card dlist">
  <div class="listhead">
    <h2>Lista de pacientes <span>({{filtered().length}})</span></h2>
    <span class="grow"></span>
    <nl-filter-select size="sm" icon="users" [searchable]="false" [alignRight]="true" ariaLabel="Faixa de idade" [options]="bandLabels" [value]="bandLabel()" (valueChange)="setBand($event)"></nl-filter-select>
    <nl-filter-select size="sm" icon="sort" [searchable]="false" [alignRight]="true" ariaLabel="Ordenar lista" [options]="orders" [value]="order" (valueChange)="order=$event;page=1"></nl-filter-select>
  </div>
  <div class="filters">
    <div class="search-box"><nl-icon name="search"/><input class="input" [value]="query" (input)="query=$any($event.target).value;page=1" placeholder="Buscar paciente por nome…" aria-label="Buscar paciente por nome"></div>
    <button *ngFor="let f of chips" type="button" class="fchip" [class.on]="statusFilter===f.id" [attr.aria-pressed]="statusFilter===f.id" (click)="statusFilter=f.id;page=1">{{f.label}} <b>{{countStatus(f.id)}}</b></button>
  </div>
  <div class="tablewrap">
    <table class="tbl">
      <thead><tr><th><span class="thi">Paciente <nl-icon name="chevud"/></span></th><th>Idade</th><th class="c">Sexo</th><th><span class="thi"><nl-icon name="calendar"/> Última avaliação</span></th><th><span class="thi"><nl-icon name="tag"/> Status</span></th><th><span class="thi"><nl-icon name="layers"/> Próximo passo</span></th></tr></thead>
      <tbody>
        <tr *ngFor="let r of pageRows()" tabindex="0" [class.sel]="sel?.id===r.id" (click)="select(r)" (keydown.enter)="select(r)">
          <td><div class="who"><span class="av">{{initials(r.name)}}</span><span><b>{{r.name}}</b><small>{{r.schooling || 'Escolaridade não informada'}} · {{r.count}} {{r.count===1?'avaliação':'avaliações'}}</small></span></div></td>
          <td>{{r.ageText}}</td>
          <td class="c"><span *ngIf="sexIcon(r.sex) as sx" [class]="'sx ' + sx" [title]="r.sex" [attr.aria-label]="r.sex"><nl-icon [name]="sx"/></span><span *ngIf="!sexIcon(r.sex)" class="muted" [title]="r.sex || 'Não informado'">—</span></td>
          <td><span class="thi"><nl-icon name="calendar"/> {{r.last ? brDate(r.last.start_date || r.last.created_at) : '—'}}</span></td>
          <td><span *ngIf="r.last && late(r.last)" class="badge danger due" [title]="'Prazo: ' + brDate(r.last.end_date)"><nl-icon name="alert"/> Atrasada</span><span *ngIf="r.last?.delivered_at" class="badge ok due" [title]="'Entregue a ' + (r.last.delivered_to || '—')"><nl-icon name="checkc"/> Entregue</span><span *ngIf="r.last" [class]="'badge '+STATUS[st(r.last)].css"><nl-icon [name]="st(r.last)==='ap' ? 'checkfill' : st(r.last)==='rv' ? 'clock' : 'edit'"/> {{STATUS[st(r.last)].label}}</span><span *ngIf="!r.last" class="badge idle">Sem avaliação</span></td>
          <td class="prog"><span class="pm">{{next(r)}}</span><span *ngIf="r.last" class="pbar"><span class="progress" [class.full]="pct(r.last)===100"><span [style.width.%]="pct(r.last)"></span></span><b>{{pct(r.last)}}%</b></span></td>
        </tr>
      </tbody>
    </table>
    <p *ngIf="!filtered().length" class="empty-row">{{rows().length ? 'Nenhum paciente encontrado.' : 'Nenhum paciente ainda. Crie o primeiro em Nova avaliação.'}}</p>
  </div>
  <nl-pager *ngIf="filtered().length" [total]="filtered().length" [page]="page" [perPage]="per" noun="pacientes" (pageChange)="page=$event" (perPageChange)="per=$event"></nl-pager>
</section>

<!-- Patient record: side panel (closes only on the X or Esc) -->
<div *ngIf="sel" class="overlay"></div>
<aside *ngIf="sel" class="card side ficha" role="dialog" aria-modal="true" aria-labelledby="pf-name">
  <div class="fhead"><span class="av">{{initials(sel.name)}}</span><div><h3 id="pf-name">{{sel.name}}</h3><small>{{sel.ageText}}{{sel.sex ? ' · ' + sel.sex : ''}}</small></div>
    <button class="close" type="button" (click)="sel=null" aria-label="Fechar ficha">×</button></div>
  <dl class="facts">
    <dt>Nascimento</dt><dd>{{sel.birth ? brDate(sel.birth) : '—'}}</dd>
    <dt>Escolaridade</dt><dd>{{sel.schooling || '—'}}</dd>
    <dt>Cadastro</dt><dd>{{sel.created ? brDate(sel.created) : '—'}}</dd>
    <dt>Avaliações</dt><dd>{{sel.count}}{{approvedOf(sel) ? ' · ' + approvedOf(sel) + (approvedOf(sel)===1 ? ' aprovada' : ' aprovadas') : ''}}</dd>
  </dl>
  <div *ngIf="sel.last as l" class="lastbox">
    <div class="lb-top"><b>Avaliação atual</b><span [class]="'badge '+STATUS[st(l)].css">{{STATUS[st(l)].label}}</span></div>
    <small>{{l.model_name || 'Sem modelo'}} · início {{brDate(l.start_date || l.created_at)}}{{l.end_date ? ' · prazo ' + brDate(l.end_date) : ''}}</small>
    <span class="pbar"><span class="progress" [class.full]="pct(l)===100"><span [style.width.%]="pct(l)"></span></span><b>{{l.approved_count || 0}} de {{l.section_total || 0}} seções</b></span>
    <button class="btn btn-primary btn-sm" type="button" (click)="open.emit(l.id)"><nl-icon name="chevr"/> {{next(sel)}}</button>
  </div>
  <p class="label-caps">Histórico ({{evalsOf(sel).length}})</p>
  <p *ngIf="!evalsOf(sel).length" class="caption">Nenhuma avaliação ainda.</p>
  <div class="hist">
    <button *ngFor="let e of evalsOf(sel)" type="button" class="task" (click)="open.emit(e.id)">
      <span class="ti tone-primary"><nl-icon name="clipboard"/></span>
      <span><b>{{brDate(e.start_date || e.created_at)}}</b><small>{{e.model_name || 'Sem modelo'}} · {{e.approved_count || 0}} de {{e.section_total || 0}} seções{{e.delivered_at ? ' · entregue' : ''}}</small></span>
      <span [class]="'badge '+STATUS[st(e)].css">{{STATUS[st(e)].label}}</span>
    </button>
  </div>
  <div class="facts-acts">
    <button class="btn btn-secondary btn-sm" [disabled]="busy" (click)="sel.last ? reevaluate(sel) : create.emit()"><nl-icon name="plus"/> {{sel.last ? 'Nova reavaliação' : 'Criar avaliação'}}</button>
  </div>
  <p *ngIf="sel.last" class="caption">A reavaliação já vem com sexo, escolaridade e modelo da última avaliação. Os arquivos são enviados de novo.</p>
</aside>
`,
  styles: [`:host{display:block}
/* same compact head, indicators and list as Avaliações */
.dh{margin-bottom:12px;gap:12px}
.dh .hicon{width:36px;height:36px;border-radius:10px;--ico-size:20px}
.dh h1{font-size:24px;line-height:30px}
.dh p{margin-top:0;font-size:13px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dh .btn{height:38px;padding:0 16px;font-size:14px}
.dk{gap:12px;margin-bottom:12px}
.dk .kpi{padding:12px;gap:12px;min-height:0;box-shadow:none}
.dk .kpi-icon{width:32px;height:32px;border-radius:8px;--ico-size:20px}
.dk .kpi-label{font-size:12.5px;font-weight:500;color:var(--text-2)}
.dk .kpi-value{font-size:22px;line-height:26px;margin:0}
.dlist .listhead{padding:12px 14px 8px;gap:8px;flex-wrap:wrap}
.dlist .listhead h2{font-size:17px}
.grow{flex:1}
.dlist .filters{padding:0 14px 10px;gap:8px}
.dlist .search-box .input{height:34px;font-size:13.5px}
.dlist .fchip{height:32px;font-size:13px}
.dlist .tbl thead th{height:36px;padding:0 8px}
.dlist .tbl td{height:52px;padding:4px 8px}
.dlist .tbl th:first-child,.dlist .tbl td:first-child{padding-left:14px}
.dlist .tbl th:last-child,.dlist .tbl td:last-child{padding-right:14px}
.dlist .tablewrap{padding:0 2px}
.dlist .who b{white-space:normal}
.dlist tbody tr{cursor:pointer}
tr.sel td{background:var(--primary-soft)}
.due{margin-right:6px}
.c{text-align:center}
.sx{display:inline-grid;place-items:center;--ico-size:20px}
.sx.female{color:#8b3fd9}.sx.male{color:#2f7fe0}
:host-context([data-theme="dark"]) .sx.female{color:#c79bff}
:host-context([data-theme="dark"]) .sx.male{color:#7ab4ff}
@media(max-width:1100px){.dk{grid-template-columns:repeat(2,minmax(0,1fr))}}
/* patient record: side panel */
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.18);z-index:40}
.side{position:fixed;top:72px;right:20px;bottom:20px;width:min(400px,calc(100vw - 40px));z-index:41;padding:18px;overflow:auto;display:flex;flex-direction:column;gap:12px}
.ficha .fhead{display:flex;gap:10px;align-items:center}
.ficha .fhead>div{flex:1;min-width:0}
.ficha .fhead h3{margin:0;font-size:16px;font-weight:650}
.ficha .fhead small{color:var(--caption,var(--text-3));font-size:12.5px}
.ficha .close{font-size:22px;line-height:1;background:none;border:0;cursor:pointer;color:var(--text-2)}
.ficha .av{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:var(--primary-soft);color:var(--primary-text);font-weight:600;flex:none}
.facts{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0;font-size:13px}
.facts dt{color:var(--text-3)}.facts dd{margin:0}
.lastbox{display:flex;flex-direction:column;gap:6px;padding:12px;border:1px solid var(--primary-border,var(--border-card));border-radius:10px;background:var(--primary-soft)}
.lastbox .lb-top{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13.5px}
.lastbox small{font-size:12px;color:var(--text-3)}
.lastbox .pbar{display:flex;align-items:center;gap:10px;font-size:12px}
.lastbox .pbar .progress{flex:1;height:7px;display:block}.lastbox .pbar .progress>span{display:block}
.lastbox .btn{align-self:flex-start;margin-top:2px}
.hist{display:flex;flex-direction:column;gap:2px}
.ficha .task .badge{margin-left:auto}
.facts-acts{display:flex;gap:8px;margin-top:auto;padding-top:4px}
`],
})
export class PatientsComponent implements OnInit {
  private api = inject(Api);
  @Input() evaluations: any[] = [];
  @Output() open = new EventEmitter<string>();
  @Output() create = new EventEmitter<void>();
  /** New evaluation of the same patient, created here; the parent opens it. */
  @Output() created = new EventEmitter<string>();
  sel: Row | null = null; busy = false;
  STATUS = STATUS; brDate = brDate;
  patients: any[] = [];
  query = ''; bandFilter: Band = 'all'; statusFilter: '' | 'rs' | 'rv' | 'ap' | 'none' = '';
  chips: {id: '' | 'rs' | 'rv' | 'ap' | 'none'; label: string}[] = [{id: '', label: 'Todos'}, {id: 'rv', label: 'Em revisão'}, {id: 'rs', label: 'Rascunho'}, {id: 'ap', label: 'Aprovado'}, {id: 'none', label: 'Sem avaliação'}];
  order = ORDERS[0]; orders = ORDERS; page = 1; per = 8;
  bands: {id: Band; label: string}[] = [{id: 'all', label: 'Todas as idades'}, {id: 'infantil', label: 'Até 17 anos'}, {id: 'adulto', label: 'Adulto (18 a 59)'}, {id: 'idoso', label: '60 anos ou mais'}];
  bandLabels = this.bands.map(b => b.label);
  bandLabel() { return this.bands.find(b => b.id === this.bandFilter)!.label; }
  setBand(label: string) { this.bandFilter = this.bands.find(b => b.label === label)?.id || 'all'; this.page = 1; }

  async ngOnInit() { try { this.patients = await this.api.req<any[]>('GET', '/patients'); } catch {} }

  st(e: any) { return listStatus(e); }
  pct(e: any) { const t = +e.section_total || 0; return t ? Math.round((+e.approved_count || 0) / t * 100) : 0; }
  initials(n: string) { return (n || '').split(/\s+/).filter(w => w.length > 2).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '—'; }

  rows(): Row[] {
    const byPatient = new Map<string, any[]>();
    for (const e of this.evaluations) { const l = byPatient.get(e.patient_id) || []; l.push(e); byPatient.set(e.patient_id, l); }
    const seen = new Set<string>(), out: Row[] = [];
    const make = (id: string, name: string, birth: string, created: string) => {
      const evs = (byPatient.get(id) || []).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const last = evs[0] || null, age = birth ? ageYears(birth) : null;
      out.push({id, name, birth, age, ageText: last?.age || (age != null ? age + (age === 1 ? ' ano' : ' anos') : '—'), sex: last?.sex || '', schooling: last?.schooling || '', created, last, count: evs.length});
      seen.add(id);
    };
    for (const p of this.patients) make(p.id, p.name, p.birth_date, p.created_at);
    for (const e of this.evaluations) if (!seen.has(e.patient_id)) make(e.patient_id, e.patient_name, e.birth_date, e.created_at);
    return out;
  }
  private inBand(r: Row, b: Band) { if (b === 'all') return true; if (r.age == null) return false; return b === 'infantil' ? r.age < 18 : b === 'adulto' ? r.age >= 18 && r.age < 60 : r.age >= 60; }
  band(b: Band) { return this.rows().filter(r => this.inBand(r, b)).length; }
  private inMonth(d: any) { if (!d) return false; const x = new Date(d), n = new Date(); return x.getFullYear() === n.getFullYear() && x.getMonth() === n.getMonth(); }
  monthNew() { return this.rows().filter(r => this.inMonth(r.created)).length; }
  inProgress() { return this.rows().filter(r => r.last && listStatus(r.last) !== 'ap').length; }
  approved() { return this.rows().filter(r => r.last && listStatus(r.last) === 'ap').length; }
  countStatus(s: '' | 'rs' | 'rv' | 'ap' | 'none') { return this.rows().filter(r => this.inBand(r, this.bandFilter) && this.hasStatus(r, s)).length; }
  private hasStatus(r: Row, s: '' | 'rs' | 'rv' | 'ap' | 'none') { return !s || (s === 'none' ? !r.last : !!r.last && listStatus(r.last) === s); }
  sexIcon(v: string) { const x = fold(v || ''); return x.startsWith('fem') ? 'female' : x.startsWith('masc') ? 'male' : null; }
  /** Past the deadline and not approved. */
  late(e: any) { return !!e.end_date && listStatus(e) !== 'ap' && e.end_date < todayISO(); }
  approvedOf(r: Row) { return this.evalsOf(r).filter(e => listStatus(e) === 'ap').length; }
  @HostListener('document:keydown.escape') esc() { this.sel = null; }
  next(r: Row) {
    if (!r.last) return 'Criar avaliação';
    const s = listStatus(r.last);
    if (s === 'ap') return 'Baixar o laudo';
    if (s === 'rv') { const left = (+r.last.section_total || 0) - (+r.last.approved_count || 0); return `Revisar ${left} ${left === 1 ? 'seção' : 'seções'}`; }
    return 'Enviar arquivos e gerar';
  }
  filtered() {
    const q = fold(this.query.trim());
    const rows = this.rows().filter(r => (!q || fold(r.name || '').includes(q)) && this.inBand(r, this.bandFilter) &&
      this.hasStatus(r, this.statusFilter));
    const t = (r: Row) => new Date(r.last?.created_at || r.created).getTime() || 0;
    const rank = (r: Row) => !r.last ? 3 : ({rv: 0, rs: 1, ap: 2} as any)[listStatus(r.last)];
    const by: Record<string, (a: Row, b: Row) => number> = {
      'Mais recentes': (a, b) => t(b) - t(a), 'Nome (A–Z)': (a, b) => a.name.localeCompare(b.name, 'pt-BR'),
      'Nome (Z–A)': (a, b) => b.name.localeCompare(a.name, 'pt-BR'), 'Idade': (a, b) => (a.age ?? 999) - (b.age ?? 999), 'Status': (a, b) => rank(a) - rank(b),
    };
    return rows.sort(by[this.order]);
  }
  pageRows() { const all = this.filtered(); const pages = Math.max(1, Math.ceil(all.length / this.per)); if (this.page > pages) this.page = pages; return all.slice((this.page - 1) * this.per, this.page * this.per); }
  select(r: Row) {
    this.sel = this.sel?.id === r.id ? null : r;
  }
  evalsOf(r: Row) { return this.evaluations.filter(e => e.patient_id === r.id).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()); }
  /** Re-evaluation: a new evaluation of the same patient with sex, schooling and model of the last one; dates start today. */
  async reevaluate(r: Row) {
    const last = r.last; if (!last) return; this.busy = true;
    try {
      const e = await this.api.req<any>('POST', '/evaluations', {patient_id: r.id, sex: last.sex || null, schooling: last.schooling || null, model_id: last.model_id || null, start_date: todayISO()});
      this.api.notify('Reavaliação criada. Envie os arquivos novos.'); this.created.emit(e.id);
    } catch {} finally { this.busy = false; }
  }
}
