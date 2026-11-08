import {Component, OnInit, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Api} from './api.service';
import {IconComponent} from './ui/icon.component';

interface Appointment {
  id: string;
  patient: string;
  age: string;
  tests: string;
  start: string;
  readiness: string;
  deliveryText: string;
  date: Date | null;
}

interface DayGroup {
  key: string;
  title: string;
  date: Date | null;
  appointments: Appointment[];
}

type AgendaFilter = 'all' | 'upcoming' | 'week' | 'past' | 'undated';

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value + 'T12:00:00');
  return isNaN(date.getTime()) ? null : date;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

@Component({
  selector: 'nl-devolutivas',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
<header class="pagehead">
  <span class="hicon"><nl-icon name="calendar"/></span>
  <div><h1>Devolutivas</h1><p>Agenda salva no sistema, do mês atual em diante.</p></div>
  <span class="grow"></span>
  <label class="btn btn-primary import" for="agenda-csv"><nl-icon name="upload"/> Importar CSV</label>
  <input id="agenda-csv" class="file-input" type="file" accept=".csv,text/csv" (change)="importFile($event)">
</header>

<div class="privacy-note"><nl-icon name="shield"/><span>Importar uma vez cria a tabela; novas planilhas atualizam os registros. Exibe apenas o mês atual em diante.</span></div>

<div *ngIf="error" class="alert danger" role="alert"><nl-icon name="alert"/><span>{{error}}</span></div>
<div *ngIf="warning" class="alert tip" role="status"><nl-icon name="info"/><span>{{warning}}</span></div>

<ng-container *ngIf="appointments.length; else emptyState">
  <section class="summary" aria-label="Resumo da agenda">
    <div><span>Registros</span><b>{{appointments.length}}</b></div>
    <div><span>Próximos 7 dias</span><b>{{weekCount}}</b></div>
    <div><span>Sem data identificada</span><b>{{undatedCount}}</b></div>

  </section>

  <div class="controls">
    <label class="search"><nl-icon name="search"/><input class="input" type="search" [(ngModel)]="query" placeholder="Buscar nome, teste ou registro" aria-label="Buscar na agenda"></label>
    <div class="filters" role="group" aria-label="Filtrar devolutivas">
      <button *ngFor="let option of filterOptions" type="button" [class.active]="filter===option.id" [attr.aria-pressed]="filter===option.id" (click)="filter=option.id">{{option.label}}</button>
    </div>
  </div>

  <p *ngIf="!groups().length" class="no-results">Nenhuma devolutiva corresponde a esse filtro.</p>
  <section *ngFor="let group of groups()" class="day-group">
    <header class="day-head"><h2>{{group.title}}</h2><span>{{group.appointments.length}} {{group.appointments.length===1 ? 'registro' : 'registros'}}</span></header>
    <article *ngFor="let appointment of group.appointments" class="appointment">
      <div class="date-mark"><nl-icon [name]="appointment.date ? 'calendar' : 'clock'"/><span>{{appointment.date ? formatDate(appointment.date) : 'Sem data'}}</span></div>
      <div class="patient"><h3>{{appointment.patient}}</h3><span *ngIf="appointment.age">{{appointment.age}} anos</span></div>
      <div class="details">
        <span *ngIf="appointment.tests"><b>Testes</b> {{appointment.tests}}</span>
        <span *ngIf="appointment.start"><b>Início</b> {{appointment.start}}</span>
        <span *ngIf="appointment.readiness"><b>Prontidão</b> {{appointment.readiness}}</span>
        <span *ngIf="appointment.deliveryText"><b>Registro</b> {{appointment.deliveryText}}</span>
      </div>
    </article>
  </section>
</ng-container>

<ng-template #emptyState>
  <section class="empty-state">
    <nl-icon name="table"/>
    <h2>Importe a planilha de devolutivas</h2>
    <p>Selecione um CSV separado por ponto e vírgula com as colunas de paciente, idade, testes, início, prontidão e devolutiva.</p>
    <label class="btn btn-primary" for="agenda-csv"><nl-icon name="upload"/> Selecionar CSV</label>
  </section>
</ng-template>`,
  styles: [`
:host{display:block;max-width:1180px;margin:0 auto}
nl-icon{--ico-size:17px}
.pagehead{display:flex;align-items:center;gap:12px;padding:18px 4px 14px}
.hicon{width:42px;height:42px;display:grid;place-items:center;border-radius:8px;background:var(--primary-soft);color:var(--primary-text);--ico-size:21px}
.pagehead h1{font-size:22px;font-weight:650;line-height:1.2}.pagehead p{font-size:13px;color:var(--text-3);margin-top:4px}
.grow{flex:1}.import{display:inline-flex;align-items:center;gap:8px;cursor:pointer}.file-input{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
.pagehead:has(.file-input:focus-visible) .import,.empty-state:has(.file-input:focus-visible) .btn{outline:2px solid var(--primary);outline-offset:2px}
.privacy-note{display:flex;align-items:flex-start;gap:9px;padding:11px 13px;margin:2px 0 16px;border:1px solid var(--primary-border);border-radius:6px;background:var(--primary-soft-2);color:var(--primary-text);font-size:12.5px;line-height:1.45}
.privacy-note nl-icon{flex:none;margin-top:1px}
.alert{display:flex;align-items:flex-start;gap:9px;padding:10px 12px;border-radius:6px;margin:10px 0;font-size:13px}.alert nl-icon{flex:none}.danger{background:var(--danger-bg);color:var(--danger)}.tip{background:var(--warn-bg);color:var(--warn-fg)}
.summary{display:flex;align-items:stretch;gap:0;border-bottom:1px solid var(--divider);margin-bottom:14px}
.summary>div{display:flex;flex-direction:column;gap:3px;padding:9px 22px 12px 4px;margin-right:20px;border-right:1px solid var(--divider)}
.summary>div span{font-size:12px;color:var(--text-3)}.summary>div b{font-size:19px;font-weight:650;color:var(--text)}
.clear{margin:auto 0 auto auto;width:36px;height:36px;display:grid;place-items:center;border:1px solid var(--border-card);border-radius:6px;background:var(--card);color:var(--text-2);cursor:pointer}.clear:hover{background:var(--chip)}
.controls{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
.search{position:relative;display:flex;align-items:center;flex:0 1 340px;min-width:190px}.search nl-icon{position:absolute;left:11px;color:var(--text-3)}.search input{padding-left:36px;height:38px}
.filters{display:flex;gap:3px;padding:3px;border:1px solid var(--border-card);border-radius:7px;background:var(--card);overflow:auto;max-width:100%}
.filters button{flex:none;border:0;border-radius:5px;background:transparent;color:var(--text-2);padding:7px 10px;font:500 12.5px var(--font);cursor:pointer;white-space:nowrap}
.filters button:hover{background:var(--chip)}.filters button.active{background:var(--primary);color:var(--on-primary);font-weight:600}
.day-group{margin:0 0 20px}.day-head{display:flex;align-items:baseline;gap:10px;padding:8px 2px;border-bottom:1px solid var(--divider)}.day-head h2{font-size:14px;font-weight:650;text-transform:capitalize}.day-head span{font-size:12px;color:var(--text-3)}
.appointment{display:grid;grid-template-columns:145px minmax(160px,.8fr) minmax(240px,1.8fr);gap:14px;align-items:start;padding:13px 10px;border-bottom:1px solid var(--divider);background:var(--bg)}
.appointment:hover{background:var(--card)}.date-mark{display:flex;align-items:center;gap:7px;color:var(--primary-text);font-size:12.5px;font-weight:600}.date-mark nl-icon{flex:none}
.patient{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 9px;min-width:0}.patient h3{font-size:14px;font-weight:600;overflow-wrap:anywhere}.patient span{font-size:12px;color:var(--text-3)}
.details{display:flex;flex-direction:column;gap:4px;color:var(--text-2);font-size:12.5px;line-height:1.4;overflow-wrap:anywhere}.details b{color:var(--text-3);font-weight:600;margin-right:4px}
.empty-state{min-height:320px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px 18px;color:var(--text-2)}.empty-state>nl-icon{--ico-size:32px;color:var(--primary);margin-bottom:14px}.empty-state h2{font-size:18px;font-weight:650;color:var(--text)}.empty-state p{max-width:450px;margin:8px 0 18px;font-size:13px;line-height:1.5;color:var(--text-3)}
.no-results{padding:24px;text-align:center;color:var(--text-3);font-size:13px}
@media(max-width:760px){.pagehead{flex-wrap:wrap}.pagehead .grow{display:none}.pagehead .import{margin-left:auto}.summary>div{padding-right:12px;margin-right:12px}.controls{align-items:stretch;flex-direction:column}.search{flex:auto;width:100%}.filters{width:100%}.appointment{grid-template-columns:minmax(0,1fr) auto;gap:8px 12px}.date-mark{grid-column:1/-1}.details{grid-column:1/-1}.patient{grid-column:1/-1}.filters button{padding-inline:8px}}
@media(max-width:420px){.summary>div{padding-right:8px;margin-right:8px}.summary>div span{font-size:11px}.summary>div b{font-size:17px}}
`],
})
export class DevolutivasComponent implements OnInit {
  private api = inject(Api);
  appointments: Appointment[] = [];
  query = '';
  filter: AgendaFilter = 'upcoming';
  error = '';
  warning = '';
  filterOptions: {id: AgendaFilter; label: string}[] = [
    {id: 'all', label: 'Todas'}, {id: 'upcoming', label: 'Próximas'}, {id: 'week', label: '7 dias'},
    {id: 'undated', label: 'Sem data'},
  ];

  constructor() {}

  ngOnInit() { this.load(); }

  async load() {
    this.error = '';
    try {
      const rows: any[] = await this.api.req('GET', '/agenda-devolutivas');
      this.appointments = rows.map(r => ({
        id: r.id, patient: r.patient, age: r.age, tests: r.tests, start: r.start,
        readiness: r.readiness, deliveryText: r.deliveryText, date: parseDate(r.date),
      }));
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Não foi possível carregar a agenda.';
    }
  }

  get weekCount() {
    const today = startOfDay(new Date()), lastDay = new Date(today);
    lastDay.setDate(lastDay.getDate() + 7);
    return this.appointments.filter(item => item.date && item.date >= today && item.date <= lastDay).length;
  }

  get undatedCount() { return this.appointments.filter(item => !item.date).length; }

  async importFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.error = ''; this.warning = '';
    try {
      const fd = new FormData(); fd.append('file', file);
      const result: any = await this.api.req('POST', '/agenda-devolutivas/import', fd);
      this.warning = `Importados ${result.imported} registros.`;
      if (result.skipped_old) this.warning += ` ${result.skipped_old} anterior(es) ao mês atual foram ignorados.`;
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Não foi possível importar o CSV.';
    }
  }

  filteredRows() {
    const today = startOfDay(new Date()), lastDay = new Date(today);
    lastDay.setDate(lastDay.getDate() + 7);
    const query = this.query.trim().toLocaleLowerCase('pt-BR');
    return this.appointments.filter(item => {
      if (this.filter === 'undated' && item.date) return false;
      if (this.filter === 'upcoming' && (!item.date || item.date < today)) return false;
      if (this.filter === 'week' && (!item.date || item.date < today || item.date > lastDay)) return false;
      const searchable = [item.patient, item.age, item.tests, item.start, item.readiness, item.deliveryText].join(' ').toLocaleLowerCase('pt-BR');
      return !query || searchable.includes(query);
    }).sort((a, b) => (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity) || a.patient.localeCompare(b.patient, 'pt-BR'));
  }

  groups(): DayGroup[] {
    const grouped = new Map<string, DayGroup>();
    for (const appointment of this.filteredRows()) {
      const key = appointment.date ? dateKey(appointment.date) : 'undated';
      let group = grouped.get(key);
      if (!group) {
        group = {
          key, date: appointment.date,
          title: appointment.date ? appointment.date.toLocaleDateString('pt-BR', {weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'}) : 'Sem data definida',
          appointments: [],
        };
        grouped.set(key, group);
      }
      group.appointments.push(appointment);
    }
    return [...grouped.values()].sort((a, b) => (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity));
  }

  formatDate(date: Date) { return date.toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit', year: 'numeric'}); }
}