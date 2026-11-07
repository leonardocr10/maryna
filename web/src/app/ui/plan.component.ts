import {Component, EventEmitter, Input, OnChanges, Output, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Api} from '../api.service';
import {brDate, todayISO} from '../shared';
import {FilterSelectComponent} from './filter-select.component';
import {IconComponent} from './icon.component';

const KINDS: Record<string, string> = {anamnese: 'Anamnese', aplicacao: 'Aplicação de testes', devolutiva: 'Devolutiva', outra: 'Outra'};

/** Consent, assessment plan (instruments to apply) and sessions of one evaluation. */
@Component({
  selector: 'nl-plan',
  standalone: true,
  imports: [CommonModule, FormsModule, FilterSelectComponent, IconComponent],
  template: `
<ng-container *ngIf="data">
<!-- Sessions -->
<section class="card stepcard">
  <div class="card-head"><h2>Sessões</h2><small>{{data.sessions.length ? data.sessions.length + ' agendada(s)' : 'Nenhuma sessão'}}</small></div>
  <div class="card-body">
    <div *ngFor="let s of data.sessions" class="item" [class.done]="s.done">
      <nl-icon [name]="s.done ? 'checkc' : 'calendar'"/>
      <span class="iname"><b>{{brDate(s.date)}}{{s.time ? ' · ' + s.time : ''}} — {{kinds[s.kind]}}</b><small>{{s.note || (s.done ? 'Realizada' : 'Agendada')}}</small></span>
      <span class="grow"></span>
      <button class="link" [disabled]="busy" (click)="toggleDone(s)">{{s.done ? 'Desmarcar' : 'Marcar realizada'}}</button>
      <button class="link link-danger" [disabled]="busy" (click)="removeSession(s)" aria-label="Remover sessão">×</button>
    </div>
    <div class="add">
      <input class="input" type="date" [(ngModel)]="ns.date" aria-label="Data da sessão">
      <input class="input" type="time" [(ngModel)]="ns.time" aria-label="Horário">
      <nl-filter-select size="sm" [options]="kindOptions" [value]="ns.kind" [searchable]="false" ariaLabel="Tipo de sessão" (valueChange)="ns.kind=$event"></nl-filter-select>
      <input class="input" [(ngModel)]="ns.note" placeholder="Observação (opcional)" aria-label="Observação">
      <button class="btn btn-secondary btn-sm" [disabled]="busy || !ns.date" (click)="addSession()"><nl-icon name="plus"/> Agendar</button>
    </div>
  </div>
</section>
</ng-container>`,
  styles: [`
nl-icon{--ico-size:16px}
.stepcard{margin-top:16px}
.cons{display:flex;flex-direction:column;gap:10px}
.chk{display:flex;gap:10px;align-items:flex-start;cursor:pointer;font-size:13.5px}
.chk input{margin-top:3px;width:16px;height:16px}
.chk span{display:flex;flex-direction:column}
.chk small{color:var(--caption);font-size:12px}
.warn-txt{display:flex;gap:6px;align-items:center;color:var(--warn-fg)}
.item{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--divider);font-size:13.5px;flex-wrap:wrap}
.item.applied nl-icon,.item.done nl-icon{color:var(--ok-fg)}
.item.not_applied nl-icon{color:var(--warn-fg)}
.item.planned nl-icon{color:var(--text-3)}
.iname{display:flex;flex-direction:column}
.iname small{color:var(--caption);font-size:12px}
.grow{flex:1}
.item .link+.link{margin-left:10px}
.muted-link{color:var(--text-3)}
.add{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px}
.add .input{max-width:200px}
.add nl-filter-select{min-width:220px}
`],
})
export class PlanComponent implements OnChanges {
  private api = inject(Api);
  @Input() evaluationId = '';
  @Input() canWrite = false;
  @Input() locked = false;
  @Output() changed = new EventEmitter<void>();
  data: any = null; busy = false;
  kinds = KINDS; brDate = brDate;
  kindOptions = Object.entries(KINDS).map(([value, label]) => ({label, value}));
  ns = {date: todayISO(), time: '', kind: 'aplicacao', note: ''};
  private loadedFor = '';

  async ngOnChanges() { if (this.evaluationId && this.evaluationId !== this.loadedFor) { this.loadedFor = this.evaluationId; try { this.data = await this.api.req('GET', `/evaluations/${this.evaluationId}/plan`); } catch {} } }
  private async run(fn: () => Promise<any>) { this.busy = true; try { this.data = await fn(); this.changed.emit(); } catch {} finally { this.busy = false; } }
  addSession() { const s = {...this.ns}; return this.run(async () => { const r = await this.api.req('POST', `/evaluations/${this.evaluationId}/sessions`, s); this.ns = {...this.ns, note: ''}; return r; }); }
  toggleDone(s: any) { return this.run(() => this.api.req('PUT', `/evaluations/${this.evaluationId}/sessions/${s.id}`, {date: s.date, time: s.time, kind: s.kind, note: s.note, done: !s.done})); }
  removeSession(s: any) { return this.run(() => this.api.req('DELETE', `/evaluations/${this.evaluationId}/sessions/${s.id}`)); }
}
