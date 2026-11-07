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
<!-- Consent -->
<section class="card stepcard">
  <div class="card-head"><h2>Consentimento</h2><small>{{data.consent.consent_by_name ? 'Registrado por ' + data.consent.consent_by_name : 'Registre o termo assinado pelo responsável ou pela pessoa avaliada'}}</small></div>
  <div class="card-body cons">
    <label class="chk"><input type="checkbox" [checked]="!!data.consent.consent_care_at" [disabled]="!canWrite || locked || busy" (change)="setConsent($any($event.target).checked, !!data.consent.consent_ai_at)">
      <span><b>Atendimento e avaliação</b><small>{{data.consent.consent_care_at ? 'Registrado em ' + brDate(data.consent.consent_care_at) : 'Termo de consentimento da avaliação neuropsicológica'}}</small></span></label>
    <label class="chk"><input type="checkbox" [checked]="!!data.consent.consent_ai_at" [disabled]="!canWrite || locked || busy" (change)="setConsent(!!data.consent.consent_care_at, $any($event.target).checked)">
      <span><b>Uso de IA na redação</b><small>{{data.consent.consent_ai_at ? 'Registrado em ' + brDate(data.consent.consent_ai_at) : 'Os textos vão à OpenAI com nomes trocados por marcadores'}}</small></span></label>
    <p *ngIf="data.consent.required && !data.consent.consent_ai_at" class="caption warn-txt"><nl-icon name="alert"/> Sem o consentimento para IA, a geração de textos fica bloqueada nesta avaliação (o texto pode ser escrito à mão).</p>
  </div>
</section>

<!-- Plan -->
<section class="card stepcard">
  <div class="card-head"><h2>Plano de avaliação</h2><small>{{applied()}} de {{data.items.length}} aplicados</small></div>
  <div class="card-body">
    <p *ngIf="!data.items.length" class="caption">Nenhum instrumento planejado ainda.</p>
    <div *ngFor="let i of data.items" class="item" [class]="'item ' + i.status">
      <nl-icon [name]="i.status==='applied' ? 'checkc' : i.status==='not_applied' ? 'alert' : 'clock'"/>
      <span class="iname"><b>{{i.instrument}}</b><small>{{statusText(i)}}</small></span>
      <span class="grow"></span>
      <ng-container *ngIf="!locked">
        <button *ngIf="i.status!=='applied'" class="link" [disabled]="busy" (click)="setStatus(i, 'applied')">Marcar aplicado</button>
        <button *ngIf="i.status==='planned'" class="link muted-link" [disabled]="busy" (click)="setStatus(i, 'not_applied')">Não aplicado</button>
        <button *ngIf="i.status!=='planned'" class="link muted-link" [disabled]="busy" (click)="setStatus(i, 'planned')">Desfazer</button>
        <button *ngIf="canWrite" class="link link-danger" [disabled]="busy" (click)="removeItem(i)" aria-label="Tirar do plano">×</button>
      </ng-container>
    </div>
    <div *ngIf="canWrite && !locked" class="add">
      <nl-filter-select size="sm" [options]="catalogOptions()" value="" placeholder="Adicionar instrumento da lista" ariaLabel="Adicionar instrumento" (valueChange)="add($event)"></nl-filter-select>
      <input class="input" [(ngModel)]="free" placeholder="Outro instrumento" (keyup.enter)="add(free)" aria-label="Outro instrumento">
      <button class="btn btn-secondary btn-sm" [disabled]="busy || free.trim().length<2" (click)="add(free)"><nl-icon name="plus"/> Adicionar</button>
    </div>
  </div>
</section>

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
  data: any = null; busy = false; free = '';
  kinds = KINDS; brDate = brDate;
  kindOptions = Object.entries(KINDS).map(([value, label]) => ({label, value}));
  ns = {date: todayISO(), time: '', kind: 'aplicacao', note: ''};
  private loadedFor = '';

  async ngOnChanges() { if (this.evaluationId && this.evaluationId !== this.loadedFor) { this.loadedFor = this.evaluationId; try { this.data = await this.api.req('GET', `/evaluations/${this.evaluationId}/plan`); } catch {} } }
  applied() { return (this.data?.items || []).filter((i: any) => i.status === 'applied').length; }
  catalogOptions() { const have = new Set((this.data?.items || []).map((i: any) => i.instrument.toLowerCase())); return (this.data?.catalog || []).filter((n: string) => !have.has(n.toLowerCase())); }
  statusText(i: any) {
    if (i.status === 'applied') return 'Aplicado' + (i.applied_by_name ? ' por ' + i.applied_by_name : '') + (i.applied_at ? ' em ' + brDate(i.applied_at) : '');
    return i.status === 'not_applied' ? 'Não aplicado' + (i.note ? ': ' + i.note : '') : 'Planejado';
  }
  private async run(fn: () => Promise<any>) { this.busy = true; try { this.data = await fn(); this.changed.emit(); } catch {} finally { this.busy = false; } }
  add(name: string) { const n = (name || '').trim(); if (n.length < 2) return; this.free = ''; return this.run(() => this.api.req('POST', `/evaluations/${this.evaluationId}/plan`, {instrument: n})); }
  setStatus(i: any, status: string) { return this.run(() => this.api.req('PUT', `/evaluations/${this.evaluationId}/plan/${i.id}`, {status})); }
  removeItem(i: any) { return this.run(() => this.api.req('DELETE', `/evaluations/${this.evaluationId}/plan/${i.id}`)); }
  addSession() { const s = {...this.ns}; return this.run(async () => { const r = await this.api.req('POST', `/evaluations/${this.evaluationId}/sessions`, s); this.ns = {...this.ns, note: ''}; return r; }); }
  toggleDone(s: any) { return this.run(() => this.api.req('PUT', `/evaluations/${this.evaluationId}/sessions/${s.id}`, {date: s.date, time: s.time, kind: s.kind, note: s.note, done: !s.done})); }
  removeSession(s: any) { return this.run(() => this.api.req('DELETE', `/evaluations/${this.evaluationId}/sessions/${s.id}`)); }
  setConsent(care: boolean, ai: boolean) { return this.run(() => this.api.req('PUT', `/evaluations/${this.evaluationId}/consent`, {care, ai})); }
}
