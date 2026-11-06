import {Component, EventEmitter, Input, OnInit, Output, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {Api} from './api.service';
import {STATUS, ageYears, brDate, fold, listStatus} from './shared';
import {IconComponent} from './ui/icon.component';
import {FilterSelectComponent} from './ui/filter-select.component';
import {PagerComponent} from './ui/pager.component';

type Band = 'all' | 'infantil' | 'adulto' | 'idoso';
interface Row {id: string; name: string; birth: string; age: number | null; ageText: string; sex: string; created: string; last: any | null; count: number}
const ORDERS = ['Mais recentes', 'Nome (A–Z)', 'Nome (Z–A)', 'Idade', 'Status'];

/** "Pacientes": built from /patients plus each patient's evaluations (no extra backend). */
@Component({
  selector: 'nl-patients',
  standalone: true,
  imports: [CommonModule, IconComponent, FilterSelectComponent, PagerComponent],
  template: `
<div class="pagehead">
  <span class="hicon"><nl-icon name="users"/></span>
  <div><h1>Pacientes</h1><p>Pacientes cadastrados, a avaliação mais recente de cada um e o próximo passo.</p></div>
  <button class="btn btn-primary" (click)="create.emit()"><nl-icon name="plus"/> Nova avaliação</button>
</div>

<div class="kpis">
  <div class="card card-raised kpi"><span class="kpi-icon"><nl-icon name="users"/></span><div><div class="kpi-label">Total de pacientes</div><div class="kpi-value">{{rows().length}}</div><div class="kpi-sub">{{band('infantil')}} até 17 anos · {{band('adulto')+band('idoso')}} adultos</div></div></div>
  <div class="card card-raised kpi"><span class="kpi-icon warn"><nl-icon name="plus"/></span><div><div class="kpi-label">Novos no mês</div><div class="kpi-value">{{monthNew()}}</div><div class="kpi-sub">Cadastrados neste mês</div></div></div>
  <div class="card card-raised kpi"><span class="kpi-icon ok"><nl-icon name="clock"/></span><div><div class="kpi-label">Com avaliação em andamento</div><div class="kpi-value">{{inProgress()}}</div><div class="kpi-sub">Rascunho ou em revisão</div></div></div>
  <div class="card card-raised kpi"><span class="kpi-icon review"><nl-icon name="check"/></span><div><div class="kpi-label">Com laudo aprovado</div><div class="kpi-value">{{approved()}}</div><div class="kpi-sub">Última avaliação aprovada</div></div></div>
</div>

<div class="cols">
  <section class="card">
    <div class="listhead"><h2>Lista de pacientes <span>({{filtered().length}})</span></h2>
      <nl-filter-select size="sm" [alignRight]="true" ariaLabel="Ordenar lista" [options]="orders" [value]="order" (valueChange)="order=$event;page=1"></nl-filter-select></div>
    <div class="filters">
      <div class="search-box"><nl-icon name="search"/><input class="input" [value]="query" (input)="query=$any($event.target).value;page=1" placeholder="Buscar paciente por nome…" aria-label="Buscar paciente por nome"></div>
      <button *ngFor="let b of bands" type="button" class="fchip" [class.on]="bandFilter===b.id" [attr.aria-pressed]="bandFilter===b.id" (click)="bandFilter=b.id;page=1">{{b.label}} <b>{{band(b.id)}}</b></button>
    </div>
    <div class="tablewrap">
      <table class="tbl">
        <thead><tr><th>Paciente</th><th>Idade</th><th>Sexo</th><th>Última avaliação</th><th>Status</th><th>Próximo passo</th></tr></thead>
        <tbody>
          <tr *ngFor="let r of pageRows()" tabindex="0" (click)="openRow(r)" (keydown.enter)="openRow(r)">
            <td><div class="who"><span class="av">{{initials(r.name)}}</span><span><b>{{r.name}}</b><small>{{r.count}} {{r.count===1?'avaliação':'avaliações'}}</small></span></div></td>
            <td>{{r.ageText}}</td>
            <td>{{r.sex || '—'}}</td>
            <td>{{r.last ? brDate(r.last.start_date || r.last.created_at) : '—'}}</td>
            <td><span *ngIf="r.last" [class]="'badge '+STATUS[st(r.last)].css">{{STATUS[st(r.last)].label}}</span><span *ngIf="!r.last" class="badge idle">Sem avaliação</span></td>
            <td class="prog"><div class="prog-meta"><span>{{next(r)}}</span><span *ngIf="r.last">{{pct(r.last)}}%</span></div><div *ngIf="r.last" class="progress" [class.full]="pct(r.last)===100"><span [style.width.%]="pct(r.last)"></span></div></td>
          </tr>
        </tbody>
      </table>
      <p *ngIf="!filtered().length" class="empty-row">{{rows().length ? 'Nenhum paciente encontrado.' : 'Nenhum paciente ainda.'}}</p>
    </div>
    <nl-pager *ngIf="filtered().length" [total]="filtered().length" [page]="page" [perPage]="per" noun="pacientes" (pageChange)="page=$event" (perPageChange)="per=$event"></nl-pager>
  </section>

  <div class="stack">
    <section class="card side-card">
      <h3><nl-icon name="alert"/> Pendências</h3>
      <p>Pacientes com algo esperando por você.</p>
      <button type="button" class="task" (click)="show('rv')"><span class="ti tone-warn"><nl-icon name="clock"/></span><span><b>Em revisão ({{withStatus('rv')}})</b><small>Seções geradas aguardando aprovação</small></span><nl-icon name="chevr"/></button>
      <button type="button" class="task" (click)="show('rs')"><span class="ti tone-primary"><nl-icon name="upload"/></span><span><b>Rascunhos ({{withStatus('rs')}})</b><small>Enviar arquivos e gerar o laudo</small></span><nl-icon name="chevr"/></button>
      <button type="button" class="task" (click)="show('none')"><span class="ti tone-danger"><nl-icon name="doc"/></span><span><b>Sem avaliação ({{noEval()}})</b><small>Paciente cadastrado sem laudo</small></span><nl-icon name="chevr"/></button>
    </section>
  </div>
</div>`,
  styles: [`:host{display:block}`],
})
export class PatientsComponent implements OnInit {
  private api = inject(Api);
  @Input() evaluations: any[] = [];
  @Output() open = new EventEmitter<string>();
  @Output() create = new EventEmitter<void>();
  STATUS = STATUS; brDate = brDate;
  patients: any[] = [];
  query = ''; bandFilter: Band = 'all'; statusFilter: '' | 'rs' | 'rv' | 'none' = '';
  order = ORDERS[0]; orders = ORDERS; page = 1; per = 8;
  bands: {id: Band; label: string}[] = [{id: 'all', label: 'Todos'}, {id: 'infantil', label: 'Até 17 anos'}, {id: 'adulto', label: 'Adulto'}, {id: 'idoso', label: '60 anos ou mais'}];

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
      out.push({id, name, birth, age, ageText: last?.age || (age != null ? age + (age === 1 ? ' ano' : ' anos') : '—'), sex: last?.sex || '', created, last, count: evs.length});
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
  withStatus(s: 'rs' | 'rv') { return this.rows().filter(r => r.last && listStatus(r.last) === s).length; }
  noEval() { return this.rows().filter(r => !r.last).length; }
  show(s: 'rs' | 'rv' | 'none') { this.statusFilter = this.statusFilter === s ? '' : s; this.page = 1; }
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
      (!this.statusFilter || (this.statusFilter === 'none' ? !r.last : !!r.last && listStatus(r.last) === this.statusFilter)));
    const t = (r: Row) => new Date(r.last?.created_at || r.created).getTime() || 0;
    const rank = (r: Row) => !r.last ? 3 : ({rv: 0, rs: 1, ap: 2} as any)[listStatus(r.last)];
    const by: Record<string, (a: Row, b: Row) => number> = {
      'Mais recentes': (a, b) => t(b) - t(a), 'Nome (A–Z)': (a, b) => a.name.localeCompare(b.name, 'pt-BR'),
      'Nome (Z–A)': (a, b) => b.name.localeCompare(a.name, 'pt-BR'), 'Idade': (a, b) => (a.age ?? 999) - (b.age ?? 999), 'Status': (a, b) => rank(a) - rank(b),
    };
    return rows.sort(by[this.order]);
  }
  pageRows() { const all = this.filtered(); const pages = Math.max(1, Math.ceil(all.length / this.per)); if (this.page > pages) this.page = pages; return all.slice((this.page - 1) * this.per, this.page * this.per); }
  openRow(r: Row) { if (r.last) this.open.emit(r.last.id); else this.create.emit(); }
}
