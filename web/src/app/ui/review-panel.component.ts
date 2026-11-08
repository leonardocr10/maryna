import {Component, EventEmitter, HostBinding, Input, OnChanges, Output, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Api} from '../api.service';
import {IconComponent} from './icon.component';

export interface Pending {text: string; level: 'danger' | 'warn' | 'info'; step?: number}

/** Review workflow on the evaluation screen: what is still missing, "Enviar para revisão" and the psychologist's
 *  correction requests (each one marked as resolved by whoever fixes it). */
@Component({
  selector: 'nl-review-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
<button *ngIf="slim && canSubmit()" class="btn btn-primary btn-sm" [disabled]="busy || !!openNotes().length" (click)="submit()"
  [title]="openNotes().length ? 'Resolva os pedidos de correção primeiro' : 'Enviar os arquivos para a psicóloga revisar'"><nl-icon name="upload"/> {{review?.submitted_at ? 'Enviar de novo' : 'Enviar para revisão'}}</button>
<section *ngIf="!slim" class="rp" [class.card]="!compact" [class.compact]="compact" [class.attention]="openNotes().length">
  <div class="rp-head">
    <ng-container *ngIf="!compact || showState || openNotes().length">
      <span [class]="'badge ' + stateBadge().css"><nl-icon [name]="stateBadge().icon"/> {{stateBadge().label}}</span>
      <span class="rp-sub">{{stateText()}}</span>
    </ng-container>
    <span class="grow"></span>
    <button *ngIf="canSubmit()" class="btn btn-primary btn-sm" [disabled]="busy || !!openNotes().length" (click)="submit()"
      [title]="openNotes().length ? 'Resolva os pedidos de correção primeiro' : ''"><nl-icon name="upload"/> {{review?.submitted_at ? 'Enviar de novo' : 'Enviar para revisão'}}</button>
    <button class="link" (click)="expanded=!expanded" [attr.aria-expanded]="expanded">{{expanded ? 'Recolher' : detailsLabel()}}</button>
  </div>

  <p *ngIf="expanded && compact && !(showState || openNotes().length)" class="rp-state"><span [class]="'badge ' + stateBadge().css"><nl-icon [name]="stateBadge().icon"/> {{stateBadge().label}}</span> <span class="rp-sub">{{stateText()}}</span></p>
  <div *ngIf="expanded" class="rp-body">
    <div *ngIf="pendings.length" class="block">
      <p class="label-caps">Conferir antes de seguir</p>
      <ul class="pend">
        <li *ngFor="let p of pendings" [class]="p.level">
          <nl-icon [name]="p.level==='info' ? 'info' : 'alert'"/><span>{{p.text}}</span>
          <button *ngIf="p.step!==undefined" class="link" (click)="goStep.emit(p.step)">Ver</button>
        </li>
      </ul>
    </div>
    <p *ngIf="!pendings.length" class="ok-line"><nl-icon name="checkc"/> Nada pendente na identificação e nos arquivos.</p>

    <div class="block">
      <p class="label-caps">Pedidos de correção</p>
      <p *ngIf="!review?.notes?.length" class="caption">Nenhum pedido.</p>
      <div *ngFor="let n of review?.notes" class="note" [class.done]="n.resolved_at">
        <div class="nmeta"><b>{{n.author_name || 'Conta removida'}}</b> · {{when(n.created_at)}}
          <span *ngIf="n.resolved_at" class="badge ok">Resolvido por {{n.resolved_by_name || '—'}}</span></div>
        <p>{{n.text}}</p>
        <button *ngIf="!locked" class="link" [disabled]="busy" (click)="resolve(n, !n.resolved_at)">{{n.resolved_at ? 'Reabrir' : 'Marcar como resolvido'}}</button>
      </div>
      <div *ngIf="canWrite && !locked" class="ask">
        <textarea class="input" rows="3" [(ngModel)]="text" placeholder="Ex.: Falta a tabela do RAVLT; a idade no cabeçalho está errada."></textarea>
        <button class="btn btn-secondary btn-sm" [disabled]="busy || text.trim().length<3" (click)="ask()"><nl-icon name="chat"/> Pedir correção</button>
        <span class="caption">A avaliação volta para quem preparou os arquivos até ser enviada de novo.</span>
      </div>
    </div>
  </div>
</section>`,
  styles: [`
nl-icon{--ico-size:15px}
.rp{padding:12px 16px;margin-bottom:16px}
.rp.compact{padding:0;margin:0;border:0;background:none;box-shadow:none}
.rp.compact .rp-head{justify-content:flex-end}
.rp-state{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0 0}
.rp.attention{border-color:var(--warn-border, var(--border-card));box-shadow:0 0 0 2px var(--warn-bg) inset}
.rp-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.rp-sub{font-size:13px;color:var(--text-3)}
.grow{flex:1}
.rp-body{margin-top:12px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}
.block{display:flex;flex-direction:column;gap:8px;min-width:0}
.pend{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.pend li{display:flex;align-items:flex-start;gap:8px;font-size:13px;line-height:1.45}
.pend li nl-icon{margin-top:2px;flex:none}
.pend li.danger nl-icon{color:var(--danger)}
.pend li.warn nl-icon{color:var(--warn-fg)}
.pend li.info nl-icon{color:var(--text-3)}
.pend li span{flex:1}
.ok-line{display:flex;gap:8px;align-items:center;font-size:13px;color:var(--ok-fg)}
.note{border:1px solid var(--border-card);border-radius:var(--radius-sm);padding:10px 12px;display:flex;flex-direction:column;gap:4px;font-size:13px}
.note.done{opacity:.7}
.note p{white-space:pre-wrap;line-height:1.5}
.nmeta{font-size:12px;color:var(--text-3);display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.note .link{align-self:flex-start;font-size:12.5px}
.ask{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.ask textarea{width:100%;resize:vertical}
@media(max-width:900px){.rp-body{grid-template-columns:minmax(0,1fr)}}
`],
})
export class ReviewPanelComponent implements OnChanges {
  private api = inject(Api);
  @Input() evaluationId = '';
  @Input() locked = false;
  @Input() canWrite = false;
  @Input() docsReady = false;
  @Input() pendings: Pending[] = [];
  /** Inside the evaluation's pending strip: no card, only the actions and "Detalhes" on the line. */
  @Input() compact = false;
  /** In compact mode, show the review state on the line (when nothing else uses it). */
  @Input() showState = true;
  @HostBinding('class.open') get open() { return this.expanded; }
  /** Only the "Enviar para revisão" button; the state and open requests go out through (state). */
  @Input() slim = false;
  @Output() state = new EventEmitter<{badge: {label: string; css: string; icon: string}; text: string; notes: any[]}>();
  /** Sends the state only when it changed (pendings is a new array on every check, so ngOnChanges runs often). */
  private lastState = '';
  private emitState() {
    const st = {badge: this.stateBadge(), text: this.stateText(), notes: this.openNotes()}, key = JSON.stringify(st);
    if (key === this.lastState) return;
    this.lastState = key; queueMicrotask(() => this.state.emit(st));
  }
  @Output() changed = new EventEmitter<void>();
  @Output() goStep = new EventEmitter<number>();
  review: {submitted_at: string | null; submitted_by_name: string | null; notes: any[]} | null = null;
  text = ''; busy = false; expanded = false;
  private loadedFor = '';

  async ngOnChanges() {
    if (this.evaluationId && this.evaluationId !== this.loadedFor) {
      this.loadedFor = this.evaluationId; this.review = null;
      try { this.review = await this.api.req('GET', `/evaluations/${this.evaluationId}/review`); } catch {}
      // open by default when something waits for this person
      this.expanded = !!this.openNotes().length || (!this.canWrite && !!this.pendings.some(p => p.level === 'danger'));
    }
    this.emitState();
  }
  openNotes() { return (this.review?.notes || []).filter(n => !n.resolved_at); }
  /** The assistant sends the files for review; the psychologist reviews instead. */
  canSubmit() { return !this.locked && this.docsReady && !this.canWrite; }
  stateBadge() {
    if (this.locked) return {label: 'Aprovada', css: 'ok', icon: 'checkfill'};
    if (this.openNotes().length) return {label: `Correção pedida (${this.openNotes().length})`, css: 'danger', icon: 'alert'};
    if (this.review?.submitted_at) return {label: 'Enviada para revisão', css: 'warn', icon: 'clock'};
    return {label: 'Em preparação', css: 'idle', icon: 'edit'};
  }
  stateText() {
    if (this.locked) return 'Laudo aprovado pela psicóloga.';
    if (this.openNotes().length) return this.canWrite ? 'Aguardando a correção de quem preparou os arquivos.' : 'A psicóloga pediu correções. Ajuste e envie de novo.';
    if (this.review?.submitted_at) return `Enviada por ${this.review.submitted_by_name || '—'} em ${this.when(this.review.submitted_at)}.`;
    return this.canWrite ? 'Ainda não enviada pela estagiária.' : 'Confira as pendências e envie para a psicóloga.';
  }
  detailsLabel() { const n = this.pendings.length + (this.review?.notes?.length || 0); return n ? `Detalhes (${n})` : 'Detalhes'; }
  when(iso: string) { const d = new Date(iso); return isNaN(+d) ? '' : `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}`; }

  private async run(fn: () => Promise<any>, ok: string) {
    this.busy = true;
    try { this.review = await fn(); this.api.notify(ok); this.changed.emit(); this.emitState(); } catch {} finally { this.busy = false; }
  }
  submit() { return this.run(() => this.api.req('POST', `/evaluations/${this.evaluationId}/submit`), 'Enviada para revisão.'); }
  ask() { const text = this.text.trim(); return this.run(async () => { const r = await this.api.req('POST', `/evaluations/${this.evaluationId}/notes`, {text}); this.text = ''; return r; }, 'Pedido de correção enviado.'); }
  resolve(n: any, resolved: boolean) { return this.run(() => this.api.req('POST', `/evaluations/${this.evaluationId}/notes/${n.id}/resolve`, {resolved}), resolved ? 'Marcado como resolvido.' : 'Pedido reaberto.'); }
}
