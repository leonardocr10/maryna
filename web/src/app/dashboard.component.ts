import {Component, EventEmitter, HostListener, Input, OnInit, Output, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {Api} from './api.service';
import {EvalStatus, STATUS, brDate, brl, fold, listStatus, todayISO} from './shared';
import {IconComponent} from './ui/icon.component';
import {FilterSelectComponent} from './ui/filter-select.component';
import {PagerComponent} from './ui/pager.component';

type Filter = 'all' | EvalStatus | 'late' | 'soon' | 'queue' | 'fix' | 'deliver';
const ORDERS = ['Mais recentes', 'Mais antigas', 'Nome (A–Z)', 'Nome (Z–A)', 'Status', 'Progresso'];

/** "Avaliações" home: compact KPIs, the paginated list in full width, and tarefas / sessões / atividade on demand. */
@Component({
  selector: 'nl-dashboard',
  standalone: true,
  imports: [CommonModule, IconComponent, FilterSelectComponent, PagerComponent],
  template: `
<div class="pagehead dh">
  <span class="hicon"><nl-icon name="clipboard"/></span>
  <div><h1>Avaliações</h1><p>Avaliações neuropsicológicas, progresso do laudo e revisão clínica.</p></div>
  <button class="btn btn-primary" (click)="create.emit()"><nl-icon name="plus"/> Nova avaliação</button>
</div>

<div class="kpis dk">
  <div class="card kpi" [title]="monthNew() + ' criadas neste mês'"><span class="kpi-icon"><nl-icon name="clipboard"/></span><div><div class="kpi-label">Total de avaliações</div><div class="kpi-value">{{evaluations.length}}</div></div></div>
  <div class="card kpi" title="Aguardando revisão clínica"><span class="kpi-icon warn"><nl-icon name="clock"/></span><div><div class="kpi-label">Pendentes de revisão</div><div class="kpi-value">{{count('rv')}}</div></div></div>
  <div class="card kpi" [title]="count('ap') + ' aprovadas no total'"><span class="kpi-icon ok"><nl-icon name="checkc"/></span><div><div class="kpi-label">Aprovadas no mês</div><div class="kpi-value">{{monthApproved()}}</div></div></div>
  <div class="card kpi" [title]="brl(usage?.month?.cost_brl||0) + ' neste mês'"><span class="kpi-icon review"><nl-icon name="coins"/></span><div><div class="kpi-label">Custo total da IA</div><div class="kpi-value">{{brl(usage?.total?.cost_brl||0)}}</div></div></div>
</div>

<section class="card dlist">
  <div class="listhead">
    <h2>Lista de avaliações <span>({{filtered().length}})</span></h2>
    <span class="grow"></span>
    <!-- Tarefas, sessões and atividade open on demand, in a popover -->
    <div class="pops">
      <div class="pop-wrap">
        <button type="button" class="pop-btn" [class.on]="pop==='tasks'" (click)="$event.stopPropagation(); toggle('tasks')" aria-haspopup="dialog" [attr.aria-expanded]="pop==='tasks'"><nl-icon name="bolt"/> Tarefas do dia <b *ngIf="taskCount()" class="pop-n">{{taskCount()}}</b></button>
        <div *ngIf="pop==='tasks'" class="pop" role="dialog" aria-label="Tarefas do dia" (click)="$event.stopPropagation()">
          <p class="pop-h">Tarefas do dia</p>
          <button *ngFor="let t of tasks()" type="button" class="prow" [class.zero]="!t.n" (click)="pick(t.filter)">
            <span [class]="'ti ' + t.tone"><nl-icon [name]="t.icon"/></span><span class="pt"><b>{{t.label}}</b><small>{{t.hint}}</small></span><span class="pc">{{t.n}}</span></button>
        </div>
      </div>
      <div *ngIf="sessions.length" class="pop-wrap">
        <button type="button" class="pop-btn" [class.on]="pop==='sessions'" (click)="$event.stopPropagation(); toggle('sessions')" aria-haspopup="dialog" [attr.aria-expanded]="pop==='sessions'"><nl-icon name="calendar"/> Sessões <b class="pop-n soft">{{sessions.length}}</b></button>
        <div *ngIf="pop==='sessions'" class="pop" role="dialog" aria-label="Sessões dos próximos 7 dias" (click)="$event.stopPropagation()">
          <p class="pop-h">Sessões dos próximos 7 dias</p>
          <button *ngFor="let ss of sessions" type="button" class="prow" (click)="pop=''; open.emit(ss.evaluation_id)">
            <span class="ti tone-primary"><nl-icon name="calendar"/></span><span class="pt"><b>{{ss.patient_name}}</b><small>{{kindName(ss.kind)}}{{ss.done ? ' · realizada' : ''}}</small></span><time>{{brDate(ss.date).slice(0,5)}}{{ss.time ? ' ' + ss.time : ''}}</time></button>
        </div>
      </div>
      <div class="pop-wrap">
        <button type="button" class="pop-btn" [class.on]="pop==='activity'" (click)="$event.stopPropagation(); toggle('activity')" aria-haspopup="dialog" [attr.aria-expanded]="pop==='activity'"><nl-icon name="bars"/> Atividade recente</button>
        <div *ngIf="pop==='activity'" class="pop" role="dialog" aria-label="Atividade recente" (click)="$event.stopPropagation()">
          <p class="pop-h">Atividade recente</p>
          <p *ngIf="!activity().length" class="caption pop-empty">Nada por aqui ainda.</p>
          <button *ngFor="let a of activity()" type="button" class="prow" (click)="pop=''; open.emit(a.id)">
            <span [class]="'ti ' + a.tone"><nl-icon [name]="a.icon"/></span><span class="pt"><b>{{a.title}}</b><small>{{a.name}}</small></span><time>{{ago(a.at)}}</time></button>
        </div>
      </div>
    </div>
    <nl-filter-select size="sm" icon="sort" [searchable]="false" [alignRight]="true" ariaLabel="Ordenar lista" [options]="orders" [value]="order" (valueChange)="order=$event;page=1"></nl-filter-select>
  </div>
  <div class="filters">
    <div class="search-box"><nl-icon name="search"/><input class="input" [value]="query" (input)="setQuery($any($event.target).value)" placeholder="Buscar avaliação ou paciente…" aria-label="Buscar avaliação ou paciente"></div>
    <button *ngFor="let f of chips()" type="button" class="fchip" [class.on]="filter===f.id" [attr.aria-pressed]="filter===f.id" (click)="filter=f.id;page=1">{{f.label}} <b>{{count(f.id)}}</b></button>
  </div>
  <div class="tablewrap">
    <table class="tbl">
      <thead><tr><th><span class="thi">Paciente <nl-icon name="chevud"/></span></th><th>Idade</th><th class="c">Sexo</th><th><span class="thi"><nl-icon name="calendar"/> Início</span></th><th><span class="thi"><nl-icon name="tag"/> Status</span></th><th><span class="thi"><nl-icon name="layers"/> Progresso</span></th><th class="dl"><span class="sr-only">Baixar</span></th></tr></thead>
      <tbody>
        <tr *ngFor="let e of pageRows()" tabindex="0" (click)="open.emit(e.id)" (keydown.enter)="open.emit(e.id)">
          <td><div class="who"><span class="av"><nl-icon name="userfill"/></span><span><b>{{e.patient_name}}</b><small>{{e.schooling || 'Avaliação neuropsicológica'}}</small></span></div></td>
          <td>{{e.age || '—'}}</td>
          <td class="c"><span *ngIf="sexIcon(e.sex) as sx" class="sx" [class]="'sx ' + sx" [title]="e.sex" [attr.aria-label]="e.sex"><nl-icon [name]="sx"/></span><span *ngIf="!sexIcon(e.sex)" class="muted" [title]="e.sex || 'Não informado'">—</span></td>
          <td><span class="thi"><nl-icon name="calendar"/> {{brDate(e.start_date || e.created_at)}}</span></td>
          <td><span *ngIf="e.delivered_at" class="badge ok due" [title]="'Entregue a ' + (e.delivered_to || '—')"><nl-icon name="checkc"/> Entregue</span><span *ngIf="fix(e)" class="badge danger due" title="A psicóloga pediu correções"><nl-icon name="chat"/> Correção pedida</span><span *ngIf="queued(e)" class="badge warn due" [title]="'Enviada por ' + (e.submitted_by_name || '—')"><nl-icon name="upload"/> Enviada</span><span *ngIf="late(e)" class="badge danger due" [title]="'Prazo: ' + brDate(e.end_date)"><nl-icon name="alert"/> Atrasada</span><span *ngIf="soon(e)" class="badge warn due" [title]="'Prazo: ' + brDate(e.end_date)"><nl-icon name="calendar"/> Vence {{brDate(e.end_date).slice(0,5)}}</span><span [class]="'badge '+STATUS[st(e)].css"><nl-icon [name]="st(e)==='ap' ? 'checkfill' : st(e)==='rv' ? 'clock' : 'edit'"/> {{STATUS[st(e)].label}}</span></td>
          <td class="prog"><span class="pm">{{e.approved_count||0}} de {{e.section_total||0}} seções</span><span class="pbar"><span class="progress" [class.full]="pct(e)===100"><span [style.width.%]="pct(e)"></span></span><b>{{pct(e)}}%</b></span></td>
          <td class="dl"><button *ngIf="canDownload(e)" type="button" class="dlbtn" [disabled]="busy===e.id" [title]="'Baixar o Word do laudo de ' + e.patient_name" [attr.aria-label]="'Baixar o Word do laudo de ' + e.patient_name" (click)="download(e, $event)" (keydown.enter)="$event.stopPropagation()"><nl-icon [name]="busy===e.id ? 'clock' : 'download'"/> Word</button></td>
        </tr>
      </tbody>
    </table>
    <p *ngIf="!filtered().length" class="empty-row">{{evaluations.length ? 'Nenhuma avaliação encontrada.' : 'Nenhuma avaliação ainda. Crie a primeira em Nova avaliação.'}}</p>
  </div>
  <nl-pager *ngIf="filtered().length" [total]="filtered().length" [page]="page" [perPage]="per" noun="avaliações" (pageChange)="page=$event" (perPageChange)="per=$event"></nl-pager>
</section>`,
  styles: [`:host{display:block}.ev{cursor:pointer}
/* compact head */
.dh{margin-bottom:12px;gap:12px}
.dh .hicon{width:36px;height:36px;border-radius:10px;--ico-size:20px}
.dh h1{font-size:24px;line-height:30px}
.dh p{margin-top:0;font-size:13px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dh .btn{height:38px;padding:0 16px;font-size:14px}
/* compact indicators (70px) */
.dk{gap:12px;margin-bottom:12px}
.dk .kpi{padding:12px;gap:12px;min-height:0;box-shadow:none}
.dk .kpi-icon{width:32px;height:32px;border-radius:8px;--ico-size:20px}
.dk .kpi-label{font-size:12.5px;font-weight:500;color:var(--text-2)}
.dk .kpi-value{font-size:22px;line-height:26px;margin:0}
/* list: full width, compact */
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
/* Tarefas / Sessões / Atividade: buttons with a popover */
.pops{display:flex;gap:6px;flex-wrap:wrap}
.pop-wrap{position:relative}
.pop-btn{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border:1px solid var(--border-card);border-radius:var(--radius-pill);background:var(--card);color:var(--text);font:500 13px var(--font);cursor:pointer;--ico-size:15px}
.pop-btn nl-icon{color:var(--review)}
.pop-btn:hover,.pop-btn.on{border-color:var(--primary);background:var(--primary-soft)}
.pop-btn:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.pop-n{min-width:20px;height:20px;padding:0 6px;border-radius:10px;display:inline-grid;place-items:center;background:var(--warn-dot,#d99a00);color:#fff;font-size:11.5px}
.pop-n.soft{background:var(--chip);color:var(--text-2)}
.pop{position:absolute;right:0;top:calc(100% + 6px);z-index:40;width:min(360px,calc(100vw - 32px));max-height:min(440px,70vh);overflow:auto;padding:6px;background:var(--card);border:1px solid var(--border-card);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.16)}
.pop-h{margin:6px 8px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--caption,var(--text-3))}
.pop-empty{padding:6px 8px}
.prow{display:flex;align-items:center;gap:10px;width:100%;padding:7px 8px;border:0;border-radius:8px;background:none;text-align:left;cursor:pointer;color:var(--text)}
.prow:hover,.prow:focus-visible{background:var(--chip);outline:0}
.prow .ti{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;flex:none;--ico-size:14px}
.prow .pt{flex:1;min-width:0;display:flex;flex-direction:column}
.prow .pt b{font-size:13px;font-weight:600}
.prow .pt small{font-size:12px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.prow .pc{min-width:22px;text-align:right;font:600 13px var(--font)}
.prow time{font-size:12px;color:var(--text-3);white-space:nowrap}
.prow.zero{opacity:.55}
.prow.zero .pc{color:var(--text-3);font-weight:500}
@media(max-width:1100px){.dk{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:700px){.dk .kpi-label{white-space:normal;line-height:1.25}.dk .kpi-value{font-size:20px}.dh p{display:none}.dlist .listhead h2{flex-basis:100%}.pop{right:auto;left:0}}
.due{margin-right:6px}
.dlist .tbl th.dl,.dlist .tbl td.dl{width:1%;white-space:nowrap;text-align:right}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.dlbtn{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 11px;border:1px solid var(--border-card);border-radius:var(--radius-pill);background:var(--card);color:var(--text);font:500 12.5px var(--font);cursor:pointer;--ico-size:15px}
.dlbtn nl-icon{color:var(--primary)}
.dlbtn:hover{border-color:var(--primary);background:var(--primary-soft)}
.dlbtn:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.dlbtn:disabled{opacity:.6;cursor:wait}
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
  page = 1; per = 10;
  /** Open popover: tarefas, sessões or atividade; a click elsewhere or Esc closes it. */
  pop: '' | 'tasks' | 'sessions' | 'activity' = '';
  toggle(p: 'tasks' | 'sessions' | 'activity') { this.pop = this.pop === p ? '' : p; }
  @HostListener('document:click') closePop() { this.pop = ''; }
  @HostListener('document:keydown.escape') escPop() { this.pop = ''; }
  pick(f: Filter) { this.filter = f; this.page = 1; this.pop = ''; }
  /** The day's tasks: the ones that need someone (zero ones stay listed, muted). */
  tasks(): {filter: Filter; label: string; hint: string; icon: string; tone: string; n: number}[] {
    const w = this.canWrite();
    const list: {filter: Filter; label: string; hint: string; icon: string; tone: string}[] = [
      {filter: 'queue', label: w ? 'Aguardando sua revisão' : 'Enviadas para revisão', hint: 'Arquivos enviados pela estagiária', icon: 'upload', tone: 'tone-warn'},
      {filter: 'fix', label: 'Correções pedidas', hint: w ? 'Esperando a estagiária corrigir' : 'A psicóloga pediu ajustes', icon: 'chat', tone: 'tone-danger'},
      {filter: 'deliver', label: 'Aguardando entrega', hint: 'Laudos aprovados ainda não entregues', icon: 'checkc', tone: 'tone-ok'},
      {filter: 'late', label: 'Atrasadas', hint: 'Data de finalização já passou', icon: 'alert', tone: 'tone-danger'},
      {filter: 'soon', label: 'Vencem em 7 dias', hint: 'Pela data de finalização do laudo', icon: 'calendar', tone: 'tone-warn'},
      {filter: 'rv', label: 'Revisar', hint: 'Seções geradas pela IA', icon: 'clock', tone: 'tone-warn'},
      {filter: 'rs', label: 'Concluir rascunhos', hint: 'Enviar arquivos e gerar seções', icon: 'clipboard', tone: 'tone-primary'},
      {filter: 'ap', label: 'Aprovadas', hint: 'Laudos prontos para baixar', icon: 'checkc', tone: 'tone-ok'}];
    return list.map(t => ({...t, n: this.count(t.filter)})).sort((a, b) => +!a.n - +!b.n);
  }
  /** Badge on "Tarefas do dia": what waits for action (queue, corrections, delivery, deadlines, review). */
  taskCount() { return (['queue', 'fix', 'deliver', 'late', 'soon', 'rv'] as Filter[]).reduce((n, f) => n + this.count(f), 0); }
  filters: {id: Filter; label: string}[] = [{id: 'all', label: 'Todas'}, {id: 'rs', label: 'Rascunho'}, {id: 'rv', label: 'Em revisão'}, {id: 'ap', label: 'Aprovadas'}];

  /** Status chips, plus the deadline ones while there is something late or due soon. */
  chips() { return [...this.filters, ...([{id: 'queue', label: 'Enviadas'}, {id: 'fix', label: 'Correção pedida'}, {id: 'deliver', label: 'Aguardando entrega'}, {id: 'late', label: 'Atrasadas'}, {id: 'soon', label: 'Vencem em 7 dias'}] as {id: Filter; label: string}[]).filter(f => this.filter === f.id || this.count(f.id))]; }
  sessions: any[] = [];
  kindName(k: string) { return ({anamnese: 'Anamnese', aplicacao: 'Aplicação de testes', devolutiva: 'Devolutiva', outra: 'Sessão'} as any)[k] || 'Sessão'; }
  async ngOnInit() { try { this.usage = await this.api.req('GET', '/ai/usage'); } catch {} try { this.sessions = await this.api.req<any[]>('GET', '/sessions'); } catch {} }

  /** Icon for the sex column; null when not informed. */
  sexIcon(v: string) { const x = fold(v || ''); return x.startsWith('fem') ? 'female' : x.startsWith('masc') ? 'male' : null; }
  st(e: any) { return listStatus(e); }
  /** Deadline = "Data da finalização do laudo" of an evaluation not approved yet. */
  late(e: any) { return listStatus(e) !== 'ap' && !!e.end_date && e.end_date < todayISO(); }
  soon(e: any) { if (listStatus(e) === 'ap' || !e.end_date) return false; const d = (Date.parse(e.end_date) - Date.parse(todayISO())) / 864e5; return d >= 0 && d <= 7; }
  /** Review workflow: sent by the assistant and waiting, or sent back with open correction requests. */
  queued(e: any) { return listStatus(e) !== 'ap' && !!e.submitted_at && !+e.open_notes; }
  fix(e: any) { return listStatus(e) !== 'ap' && +e.open_notes > 0; }
  /** Word ready to download: approved evaluation, and only who can export it (psychologist/admin). */
  canDownload(e: any) { return e.status === 'approved' && this.canWrite(); }
  busy = '';
  async download(e: any, ev: Event) {
    ev.stopPropagation();
    if (this.busy) return;
    this.busy = e.id;
    try {
      const data = await this.api.blob(`/evaluations/${e.id}/export`);
      const url = URL.createObjectURL(data), a = document.createElement('a');
      a.href = url; a.download = 'laudo-' + (e.patient_name || 'revisado').replace(/[^\p{L}\p{N}]+/gu, '-') + '.docx'; a.click(); URL.revokeObjectURL(url);
      this.api.notify('Word baixado.');
    } catch {} finally { this.busy = ''; }
  }
  canWrite() { const r = this.api.me()?.role; return r === 'admin' || r === 'psychologist'; }
  private matches(e: any, f: Filter) { return f === 'all' || (f === 'late' ? this.late(e) : f === 'soon' ? this.soon(e) : f === 'queue' ? this.queued(e) : f === 'fix' ? this.fix(e) : f === 'deliver' ? listStatus(e) === 'ap' && !e.delivered_at : listStatus(e) === f); }
  count(f: Filter) { return this.evaluations.filter(e => this.matches(e, f)).length; }
  pct(e: any) { const t = +e.section_total || 0; return t ? Math.round((+e.approved_count || 0) / t * 100) : 0; }
  setQuery(v: string) { this.query = v; this.page = 1; this.queryChange.emit(v); }
  private inMonth(d: any) { if (!d) return false; const x = new Date(d), n = new Date(); return x.getFullYear() === n.getFullYear() && x.getMonth() === n.getMonth(); }
  monthNew() { return this.evaluations.filter(e => this.inMonth(e.created_at)).length; }
  monthApproved() { return this.evaluations.filter(e => listStatus(e) === 'ap' && this.inMonth(e.approved_at)).length; }

  filtered() {
    const q = fold(this.query.trim());
    const rank: Record<string, number> = {rv: 0, rs: 1, ap: 2};
    const rows = this.evaluations.filter(e => (!q || fold(e.patient_name || '').includes(q)) && this.matches(e, this.filter));
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
      if (e.submitted_at) ev.push({id: e.id, title: 'Enviada para revisão' + (e.submitted_by_name ? ' por ' + e.submitted_by_name : ''), name: e.patient_name, at: e.submitted_at, icon: 'upload', tone: 'tone-warn'});
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
