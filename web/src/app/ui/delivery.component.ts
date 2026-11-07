import {Component, EventEmitter, Input, OnChanges, Output, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Api} from '../api.service';
import {brDate, todayISO} from '../shared';
import {FilterSelectComponent} from './filter-select.component';
import {IconComponent} from './icon.component';

const MODES: Record<string, string> = {presencial: 'Em sessão de devolutiva', impresso: 'Impresso, sem sessão', digital: 'Arquivo digital'};

/** Delivery of the approved report: when, to whom and how. The evaluation then shows as "Entregue". */
@Component({
  selector: 'nl-delivery',
  standalone: true,
  imports: [CommonModule, FormsModule, FilterSelectComponent, IconComponent],
  template: `
<section class="card dl">
  <div class="dl-head"><span class="ei"><nl-icon name="checkc"/></span><div><h2>Entrega do laudo</h2>
    <small>{{at ? 'Entregue em ' + brDate(at) + ' a ' + to + ' · ' + modes[mode] : 'Registre quando o laudo for entregue.'}}</small></div>
    <span class="grow"></span><span *ngIf="at" class="badge ok">Entregue</span></div>
  <div *ngIf="!at || editing" class="form">
    <input class="input" type="date" [(ngModel)]="date" aria-label="Data da entrega">
    <input class="input" [(ngModel)]="who" placeholder="Para quem (ex.: mãe e pai)" aria-label="Para quem o laudo foi entregue">
    <nl-filter-select size="sm" [options]="modeOptions" [value]="how" [searchable]="false" ariaLabel="Forma de entrega" (valueChange)="how=$event"></nl-filter-select>
    <button class="btn btn-primary btn-sm" [disabled]="busy || who.trim().length<2" (click)="save()"><nl-icon name="check"/> Registrar entrega</button>
    <button *ngIf="editing" class="btn btn-secondary btn-sm" (click)="editing=false">Cancelar</button>
  </div>
  <div *ngIf="at && !editing" class="row"><button class="link" (click)="startEdit()">Alterar</button><button class="link link-danger" [disabled]="busy" (click)="clear()">Desfazer registro</button></div>
</section>`,
  styles: [`
nl-icon{--ico-size:16px}
.dl{padding:16px 20px;margin-top:16px;display:flex;flex-direction:column;gap:12px}
.dl-head{display:flex;align-items:center;gap:12px}
.dl-head h2{font-size:16px;font-weight:600}
.dl-head small{color:var(--caption);font-size:12.5px}
.ei{width:38px;height:38px;border-radius:var(--radius-sm);display:grid;place-items:center;background:var(--ok-bg);color:var(--ok-fg);flex:none}
.grow{flex:1}
.form{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.form .input{max-width:240px}
.row{display:flex;gap:14px}
`],
})
export class DeliveryComponent implements OnChanges {
  private api = inject(Api);
  @Input() evaluationId = '';
  @Input() current: any = null;
  @Output() changed = new EventEmitter<void>();
  modes = MODES; brDate = brDate;
  modeOptions = Object.entries(MODES).map(([value, label]) => ({label, value}));
  at: string | null = null; to = ''; mode = 'presencial';
  date = todayISO(); who = ''; how = 'presencial'; busy = false; editing = false;
  ngOnChanges() { this.at = this.current?.delivered_at || null; this.to = this.current?.delivered_to || ''; this.mode = this.current?.delivery_mode || 'presencial'; }
  startEdit() { this.date = this.at || todayISO(); this.who = this.to; this.how = this.mode; this.editing = true; }
  async save() {
    this.busy = true;
    try { const r = await this.api.req<any>('PUT', `/evaluations/${this.evaluationId}/delivery`, {date: this.date, delivered_to: this.who, mode: this.how}); this.at = r.delivered_at; this.to = r.delivered_to; this.mode = r.delivery_mode; this.editing = false; this.api.notify('Entrega registrada.'); this.changed.emit(); }
    catch {} finally { this.busy = false; }
  }
  async clear() {
    this.busy = true;
    try { await this.api.req('PUT', `/evaluations/${this.evaluationId}/delivery`, {clear: true}); this.at = null; this.who = ''; this.changed.emit(); } catch {} finally { this.busy = false; }
  }
}
