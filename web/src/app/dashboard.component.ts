import {Component, EventEmitter, Input, OnInit, Output, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {Api} from './api.service';
import {EvalStatus, STATUS, brDate, brl, fold, listStatus} from './shared';
import {IconComponent} from './ui/icon.component';
import {FilterSelectComponent} from './ui/filter-select.component';
import {PagerComponent} from './ui/pager.component';

type Filter = 'all' | EvalStatus;
const ORDERS = ['Mais recentes', 'Mais antigas', 'Nome (A–Z)', 'Nome (Z–A)', 'Status', 'Progresso'];

/** "Avaliações" home: KPIs, paginated table and the side cards (tarefas, atividade recente). */
@Component({
  selector: 'nl-dashboard',
  standalone: true,
  imports: [CommonModule, IconComponent, FilterSelectComponent, PagerComponent],
  template: `
<div class="pagehead">
  <span class="hicon"><nl-icon name="clipboard"/></span>
  <div><h1>Avaliações</h1><p>Gerencie as avaliações neuropsicológicas, acompanhe o progresso do laudo e a revisão clínica.</p></div>
  <button class="btn btn-primary" (click)="create.emit()"><nl-icon name="plus"/> Nova avaliação</button>
</div>

<div class="kpis">
  <div class="card card-raised kpi"><span class="kpi-icon"><nl-icon name="clipboard"/></span><div><div class="kpi-label">Total de avaliações</div><div class="kpi-value">{{evaluations.length}}</div><div class="kpi-sub">{{monthNew()}} criadas neste mês</div></div></div>
  <div class="card card-raised kpi"><span class="kpi-icon warn"><nl-icon name="clock"/></span><div><div class="kpi-label">Pendentes de revisão</div><div class="kpi-value">{{count('rv')}}</div><div class="kpi-sub">Aguardando revisão clínica</div></div></div>
  <div class="card card-raised kpi"><span class="kpi-icon ok"><nl-icon name="checkc"/></span><div><div class="kpi-label">Aprovadas no mês</div><div class="kpi-value">{{monthApproved()}}</div><div class="kpi-sub">{{count('ap')}} aprovadas no total</div></div></div>
  <div class="card card-raised kpi"><span class="kpi-icon review"><nl-icon name="coins"/></span><div><div class="kpi-label">Custo total da IA</div><div class="kpi-value">{{brl(usage?.total?.cost_brl||0)}}</div><div class="kpi-sub">{{brl(usage?.month?.cost_brl||0)}} neste mês</div></div></div>
</div>

<div class="cols">
  <section class="card">
    <div class="listhead"><h2>Lista de avaliações <span>({{filtered().length}})</span></h2>
      <nl-filter-select size="sm" icon="sort" [searchable]="false" [alignRight]="true" ariaLabel="Ordenar lista" [options]="orders" [value]="order" (valueChange)="order=$event;page=1"></nl-filter-select></div>
    <div class="filters">
      <div class="search-box"><nl-icon name="search"/><input class="input" [value]="query" (input)="setQuery($any($event.target).value)" placeholder="Buscar avaliação ou paciente…" aria-label="Buscar avaliação ou paciente"></div>
      <button *ngFor="let f of filters" type="button" class="fchip" [class.on]="filter===f.id" [attr.aria-pressed]="filter===f.id" (click)="filter=f.id;page=1">{{f.label}} <b>{{count(f.id)}}</b></button>
    </div>
    <div class="tablewrap">
      <table class="tbl">
        <thead><tr><th><span class="thi">Paciente <nl-icon name="chevud"/></span></th><th>Idade</th><th class="c">Sexo</th><th><span class="thi"><nl-icon name="calendar"/> Início</span></th><th><span class="thi"><nl-icon name="tag"/> Status</span></th><th><span class="thi"><nl-icon name="layers"/> Progresso</span></th></tr></thead>
        <tbody>
          <tr *ngFor="let e of pageRows()" tabindex="0" (click)="open.emit(e.id)" (keydown.enter)="open.emit(e.id)">
            <td><div class="who"><span class="av"><nl-icon name="userfill"/></span><span><b>{{e.patient_name}}</b><small>{{e.schooling || 'Avaliação neuropsicológica'}}</small></span></div></td>
            <td>{{e.age || '—'}}</td>
            <td class="c"><span *ngIf="sexIcon(e.sex) as sx" class="sx" [class]="'sx ' + sx" [title]="e.sex" [attr.aria-label]="e.sex"><nl-icon [name]="sx"/></span><span *ngIf="!sexIcon(e.sex)" class="muted" [title]="e.sex || 'Não informado'">—</span></td>
            <td><span class="thi"><nl-icon name="calendar"/> {{brDate(e.start_date || e.created_at)}}</span></td>
            <td><span [class]="'badge '+STATUS[st(e)].css"><nl-icon [name]="st(e)==='ap' ? 'checkfill' : st(e)==='rv' ? 'clock' : 'edit'"/> {{STATUS[st(e)].label}}</span></td>
            <td class="prog"><span class="pm">{{e.approved_count||0}} de {{e.section_total||0}} seções</span><span class="pbar"><span class="progress" [class.full]="pct(e)===100"><span [style.width.%]="pct(e)"></span></span><b>{{pct(e)}}%</b></span></td>
          </tr>
        </tbody>
      </table>
      <p *ngIf="!filtered().length" class="empty-row">{{evaluations.length ? 'Nenhuma avaliação encontrada.' : 'Nenhuma avaliação ainda. Crie a primeira em Nova avaliação.'}}</p>
    </div>
    <nl-pager *ngIf="filtered().length" [total]="filtered().length" [page]="page" [perPage]="per" noun="avaliações" (pageChange)="page=$event" (perPageChange)="per=$event"></nl-pager>
  </section>

  <div class="stack">
    <section class="card side-card">
      <h3><nl-icon name="bolt"/> Tarefas do dia</h3>
      <p>Acompanhe as próximas ações do seu fluxo de laudos.</p>
      <button type="button" class="task" (click)="filter='rv';page=1"><span class="ti tone-warn"><nl-icon name="clock"/></span><span><b>Revisar {{count('rv')}} {{count('rv')===1?'avaliação':'avaliações'}}</b><small>Seções geradas pela IA</small></span><nl-icon name="chevr"/></button>
      <button type="button" class="task" (click)="filter='rs';page=1"><span class="ti tone-primary"><nl-icon name="clipboard"/></span><span><b>Concluir rascunhos ({{count('rs')}})</b><small>Enviar arquivos e gerar seções</small></span><nl-icon name="chevr"/></button>
      <button type="button" class="task" (click)="filter='ap';page=1"><span class="ti tone-ok"><nl-icon name="checkc"/></span><span><b>Aprovadas ({{count('ap')}})</b><small>Laudos prontos para baixar</small></span><nl-icon name="chevr"/></button>
    </section>
    <section class="card side-card">
      <h3><nl-icon name="bars"/> Atividade recente</h3>
      <p>Últimas ações registradas.</p>
      <div class="feed">
        <p *ngIf="!activity().length" class="caption">Nada por aqui ainda.</p>
        <div *ngFor="let a of activity()" class="ev" role="button" tabindex="0" (click)="open.emit(a.id)" (keydown.enter)="open.emit(a.id)">
          <span class="ti" [class]="'ti ' + a.tone"><nl-icon [name]="a.icon"/></span>
          <span><b>{{a.title}}</b><small>{{a.name}}</small></span><time>{{ago(a.at)}}</time>
        </div>
      </div>
    </section>
  </div>
</div>`,
  styles: [`:host{display:block}.ev{cursor:pointer}
.c{text-align:center}
.sx{display:inline-grid;place-items:center;--ico-size:20px}
.sx.female{color:#8b3fd9}
.sx.male{color:#2f7fe0}
:host-context([data-theme="dark"]) .sx.female{color:#c79bff}
:host-context([data-theme="dark"]) .sx.male{color:#7ab4ff}`],
})
export class DashboardComponent implements OnInit {
  private api = inject(Api);
  @Input() evaluations: any[] = [];
  @Input() query = '';
  @Output() queryChange = new EventEmitter<string>();
  @Output() open = new EventEmitter<string>();
  @Output() create = new EventEmitter<void>();
  STATUS = STATUS; brDate = brDate; brl = brl;
  usage: any = null;
  filter: Filter = 'all';
  order = ORDERS[0]; orders = ORDERS;
  page = 1; per = 8;
  filters: {id: Filter; label: string}[] = [{id: 'all', label: 'Todas'}, {id: 'rs', label: 'Rascunho'}, {id: 'rv', label: 'Em revisão'}, {id: 'ap', label: 'Aprovadas'}];

  async ngOnInit() { try { this.usage = await this.api.req('GET', '/ai/usage'); } catch {} }

  /** Icon for the sex column; null when not informed. */
  sexIcon(v: string) { const x = fold(v || ''); return x.startsWith('fem') ? 'female' : x.startsWith('masc') ? 'male' : null; }
  st(e: any) { return listStatus(e); }
  count(f: Filter) { return f === 'all' ? this.evaluations.length : this.evaluations.filter(e => listStatus(e) === f).length; }
  pct(e: any) { const t = +e.section_total || 0; return t ? Math.round((+e.approved_count || 0) / t * 100) : 0; }
  setQuery(v: string) { this.query = v; this.page = 1; this.queryChange.emit(v); }
  private inMonth(d: any) { if (!d) return false; const x = new Date(d), n = new Date(); return x.getFullYear() === n.getFullYear() && x.getMonth() === n.getMonth(); }
  monthNew() { return this.evaluations.filter(e => this.inMonth(e.created_at)).length; }
  monthApproved() { return this.evaluations.filter(e => listStatus(e) === 'ap' && this.inMonth(e.approved_at)).length; }

  filtered() {
    const q = fold(this.query.trim());
    const rank: Record<string, number> = {rv: 0, rs: 1, ap: 2};
    const rows = this.evaluations.filter(e => (!q || fold(e.patient_name || '').includes(q)) && (this.filter === 'all' || listStatus(e) === this.filter));
    const t = (e: any) => new Date(e.created_at).getTime() || 0;
    const by: Record<string, (a: any, b: any) => number> = {
      'Mais recentes': (a, b) => t(b) - t(a), 'Mais antigas': (a, b) => t(a) - t(b),
      'Nome (A–Z)': (a, b) => (a.patient_name || '').localeCompare(b.patient_name || '', 'pt-BR'),
      'Nome (Z–A)': (a, b) => (b.patient_name || '').localeCompare(a.patient_name || '', 'pt-BR'),
      'Status': (a, b) => rank[listStatus(a)] - rank[listStatus(b)], 'Progresso': (a, b) => this.pct(b) - this.pct(a),
    };
    return [...rows].sort(by[this.order]);
  }
  pageRows() { const all = this.filtered(); const pages = Math.max(1, Math.ceil(all.length / this.per)); if (this.page > pages) this.page = pages; return all.slice((this.page - 1) * this.per, this.page * this.per); }

  activity() {
    const ev: {id: string; title: string; name: string; at: string; icon: string; tone: string}[] = [];
    for (const e of this.evaluations) {
      if (e.approved_at && listStatus(e) === 'ap') ev.push({id: e.id, title: 'Avaliação aprovada', name: e.patient_name, at: e.approved_at, icon: 'check', tone: 'tone-ok'});
      if (e.created_at) ev.push({id: e.id, title: 'Nova avaliação criada', name: e.patient_name, at: e.created_at, icon: 'plus', tone: 'tone-primary'});
    }
    return ev.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 5);
  }
  ago(d: string) {
    const x = new Date(d), s = (Date.now() - x.getTime()) / 1000;
    if (s < 3600) return 'Há ' + Math.max(1, Math.round(s / 60)) + ' min';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (x >= today) return 'Hoje, ' + x.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'});
    return brDate(d);
  }
}
