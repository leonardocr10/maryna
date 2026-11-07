import {Component, Input, OnInit, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {Api} from './api.service';
import {brl, int, listStatus, STATUS} from './shared';
import {duration} from './work-timer.service';
import {IconComponent} from './ui/icon.component';
import {FilterSelectComponent} from './ui/filter-select.component';

interface Month {key: string; label: string; long: string; created: number; approved: number; cost: number}
interface Series {title: string; note: string; value: (m: Month) => number; format: (v: number) => string}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const monthKey = (d: any) => { const x = new Date(d); return isNaN(+x) ? '' : `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; };

/** "Relatórios": evaluations, approvals, working time and AI spending over the months (data the system already has). */
@Component({
  selector: 'nl-reports',
  standalone: true,
  imports: [CommonModule, IconComponent, FilterSelectComponent],
  template: `
<div class="pagehead">
  <span class="hicon"><nl-icon name="chart"/></span>
  <div><h1>Relatórios</h1><p>Avaliações, laudos aprovados, tempo de trabalho e gastos com IA ao longo dos meses.</p></div>
  <span class="grow"></span>
  <div class="period"><nl-filter-select size="sm" [searchable]="false" [alignRight]="true" ariaLabel="Período" [options]="periods" [value]="period" (valueChange)="setPeriod($event)"></nl-filter-select></div>
</div>

<div class="kpis">
  <div class="card card-raised kpi"><span class="kpi-icon"><nl-icon name="clipboard"/></span><div><div class="kpi-label">Avaliações criadas</div><div class="kpi-value">{{sum('created')}}</div><div class="kpi-sub">no período</div></div></div>
  <div class="card card-raised kpi"><span class="kpi-icon ok"><nl-icon name="checkc"/></span><div><div class="kpi-label">Laudos aprovados</div><div class="kpi-value">{{sum('approved')}}</div><div class="kpi-sub">no período</div></div></div>
  <div class="card card-raised kpi"><span class="kpi-icon warn"><nl-icon name="clock"/></span><div><div class="kpi-label">Tempo médio de trabalho</div><div class="kpi-value">{{time?.finished ? duration(time.avg_work_seconds) : '—'}}</div><div class="kpi-sub">{{time?.finished ? 'em ' + time.finished + ' avaliação(ões) concluída(s)' : 'sem avaliações concluídas'}}</div></div></div>
  <div class="card card-raised kpi"><span class="kpi-icon review"><nl-icon name="coins"/></span><div><div class="kpi-label">Gasto estimado com IA</div><div class="kpi-value">{{brl(sum('cost'))}}</div><div class="kpi-sub">{{sum('created') ? '≈ ' + brl(sum('cost') / sum('created')) + ' por avaliação' : 'no período'}}</div></div></div>
</div>

<div class="charts">
  <section *ngFor="let c of series" class="card chart">
    <div class="chead"><h2>{{c.title}}</h2><small>{{c.note}}</small></div>
    <div class="plot" role="img" [attr.aria-label]="c.title + ': ' + describe(c)">
      <div class="grid"><span>{{c.format(max(c))}}</span><span></span></div>
      <div class="bars" (mouseleave)="hover=null">
        <div *ngFor="let m of months" class="col" (mouseenter)="hover={c: c.title, m: m.key}" (focus)="hover={c: c.title, m: m.key}" tabindex="0">
          <div class="bar" [class.zero]="!c.value(m)" [style.height.%]="height(c, m)"></div>
          <div *ngIf="hover?.c===c.title && hover?.m===m.key" class="tip" role="status"><b>{{m.long}}</b>{{c.format(c.value(m))}}</div>
          <span class="mlabel">{{m.label}}</span>
        </div>
      </div>
    </div>
  </section>

  <section class="card chart">
    <div class="chead"><h2>Situação atual</h2><small>todas as avaliações</small></div>
    <ul class="status">
      <li *ngFor="let s of statusRows()"><span [class]="'badge ' + s.css">{{s.label}}</span><b>{{s.n}}</b><span class="sbar"><span [style.width.%]="s.pct"></span></span></li>
    </ul>
    <p class="caption">Em andamento: {{time?.in_progress || 0}} avaliação(ões), {{duration(time?.in_progress_seconds || 0)}} de trabalho até agora.</p>
  </section>
</div>

<section class="card">
  <div class="card-head"><h2>Tabela por mês</h2><button class="link" (click)="tableOpen=!tableOpen">{{tableOpen ? 'Ocultar' : 'Mostrar'}}</button></div>
  <div *ngIf="tableOpen" class="tablewrap">
    <table class="tbl">
      <thead><tr><th>Mês</th><th class="num">Criadas</th><th class="num">Aprovadas</th><th class="num">Gasto com IA</th></tr></thead>
      <tbody><tr *ngFor="let m of months.slice().reverse()"><td>{{m.long}}</td><td class="num">{{m.created}}</td><td class="num">{{m.approved}}</td><td class="num">{{brl(m.cost)}}</td></tr></tbody>
    </table>
  </div>
  <p class="caption note">Valores de IA estimados pela tabela de preços e câmbio configurados; o valor cobrado de fato está no painel da OpenAI. O tempo de trabalho conta só com a avaliação aberta na tela.</p>
</section>`,
  styles: [`
:host{display:block}
nl-icon{--ico-size:16px}
.grow{flex:1}
.period{width:190px}
.charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-bottom:16px}
.chart{padding:16px 18px}
.chead{display:flex;align-items:baseline;gap:10px;margin-bottom:12px}
.chead h2{font-size:15px;font-weight:600}
.chead small{color:var(--caption);font-size:12px}
.plot{position:relative;height:180px;padding-top:18px}
.grid{position:absolute;inset:0 0 22px 0;display:flex;flex-direction:column;justify-content:space-between;pointer-events:none}
.grid span{border-top:1px solid var(--divider);font-size:11px;color:var(--caption);line-height:1;padding-top:3px}
.grid span:last-child{border-top-color:var(--border-card)}
.bars{position:absolute;inset:18px 0 0 0;display:flex;gap:2px}
.col{position:relative;flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;padding-bottom:22px;cursor:default;outline:none}
.col:focus-visible .bar,.col:hover .bar{filter:brightness(1.15)}
.bar{width:min(28px,70%);background:var(--primary);border-radius:4px 4px 0 0;min-height:2px}
.bar.zero{background:var(--track)}
.mlabel{position:absolute;bottom:2px;font-size:11px;color:var(--caption)}
.tip{position:absolute;bottom:calc(100% - 10px);left:50%;transform:translateX(-50%);background:var(--card);border:1px solid var(--border-card);box-shadow:0 6px 18px rgba(0,0,0,.12);border-radius:8px;padding:6px 10px;font-size:12px;white-space:nowrap;z-index:2;display:flex;flex-direction:column;color:var(--text)}
.tip b{font-weight:600;color:var(--text-2)}
.status{list-style:none;margin:0 0 12px;padding:0;display:flex;flex-direction:column;gap:12px}
.status li{display:grid;grid-template-columns:120px 40px 1fr;align-items:center;gap:10px;font-size:13px}
.sbar{height:8px;background:var(--track);border-radius:4px;overflow:hidden}
.sbar span{display:block;height:100%;background:var(--primary);border-radius:4px}
.num{text-align:right}
.note{margin:12px 16px}
.tablewrap{overflow:auto}
@media(max-width:1000px){.charts{grid-template-columns:minmax(0,1fr)}}
`],
})
export class ReportsComponent implements OnInit {
  private api = inject(Api);
  @Input() set evaluations(v: any[]) { this.evals = v || []; this.build(); }
  brl = brl; int = int; duration = duration;
  evals: any[] = [];
  periods = [{label: 'Últimos 6 meses', value: '6'}, {label: 'Últimos 12 meses', value: '12'}];
  period = '6';
  months: Month[] = [];
  time: any = null;
  private byDay: any[] = [];
  hover: {c: string; m: string} | null = null;
  tableOpen = false;
  series: Series[] = [
    {title: 'Avaliações criadas', note: 'por mês', value: m => m.created, format: v => int(v)},
    {title: 'Laudos aprovados', note: 'por mês', value: m => m.approved, format: v => int(v)},
    {title: 'Gasto estimado com IA', note: 'por mês, em reais', value: m => m.cost, format: v => brl(v)},
  ];

  async ngOnInit() {
    try { this.time = await this.api.req('GET', '/stats/time'); } catch {}
    try { this.byDay = (await this.api.req<any>('GET', '/ai/usage/details?days=365')).byDay || []; } catch {}
    this.build();
  }
  setPeriod(v: string) { this.period = v; this.build(); }
  /** Last N calendar months, oldest first, with the counts of each one. */
  build() {
    const n = Number(this.period), now = new Date(), out: Month[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = monthKey(d), label = MONTHS[d.getMonth()];
      out.push({key, label, long: `${label}/${d.getFullYear()}`, created: 0, approved: 0, cost: 0});
    }
    const at = new Map(out.map(m => [m.key, m]));
    for (const e of this.evals) {
      const c = at.get(monthKey(e.created_at)); if (c) c.created++;
      const a = listStatus(e) === 'ap' ? at.get(monthKey(e.approved_at)) : null; if (a) a.approved++;
    }
    for (const r of this.byDay) { const m = at.get(String(r.day || '').slice(0, 7)); if (m) m.cost += Number(r.cost_brl) || 0; }
    this.months = out;
  }
  sum(k: 'created' | 'approved' | 'cost') { return this.months.reduce((t, m) => t + m[k], 0); }
  max(c: Series) { return Math.max(...this.months.map(c.value), 0); }
  height(c: Series, m: Month) { const mx = this.max(c); return mx ? Math.max(2, c.value(m) / mx * 100) : 0; }
  describe(c: Series) { return this.months.map(m => `${m.long} ${c.format(c.value(m))}`).join(', '); }
  statusRows() {
    const total = this.evals.length || 1;
    return (['rs', 'rv', 'ap'] as const).map(k => { const n = this.evals.filter(e => listStatus(e) === k).length; return {...STATUS[k], n, pct: n / total * 100}; });
  }
}
