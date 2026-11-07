import {Component, EventEmitter, Input, OnInit, Output, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {Api} from '../api.service';
import {ConfirmService} from '../confirm.service';
import {DiffPart, wordDiff} from '../text-diff';
import {IconComponent} from './icon.component';

/** Earlier versions of one section: pick one to see what changed up to the current text, and restore it. */
@Component({
  selector: 'nl-section-versions',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
<div class="sv">
  <div class="sv-head"><b><nl-icon name="restore"/> Versões anteriores</b><span class="grow"></span><button class="link" (click)="closed.emit()">Fechar</button></div>
  <p *ngIf="!data" class="caption">Carregando…</p>
  <p *ngIf="data && !data.versions.length" class="caption">Esta seção ainda não tem versões anteriores.</p>
  <div *ngIf="data?.versions?.length" class="sv-body">
    <ul class="vlist">
      <li *ngFor="let v of data?.versions"><button type="button" [class.on]="sel===v" (click)="pick(v)">
        <b>Versão {{v.version}}</b><small>{{when(v.created_at)}} · substituída por {{v.actor_name || '—'}}</small></button></li>
    </ul>
    <div class="vview">
      <div class="legend"><span class="del">removido</span><span class="add">acrescentado</span><span class="caption">da versão {{sel?.version}} até o texto atual</span></div>
      <p class="diff"><ng-container *ngFor="let p of diff"><span [class]="p.kind">{{p.text}}</span></ng-container></p>
      <div class="row">
        <button *ngIf="canRestore" class="btn btn-secondary btn-sm" [disabled]="busy" (click)="restore()"><nl-icon name="restore"/> Restaurar a versão {{sel?.version}}</button>
        <span class="caption">Restaurar não apaga nada: o texto atual também vira uma versão.</span>
      </div>
    </div>
  </div>
</div>`,
  styles: [`
nl-icon{--ico-size:15px}
.sv{border:1px solid var(--border-card);border-radius:var(--radius-sm);padding:12px 14px;margin:12px 0;background:var(--card)}
.sv-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.sv-head b{display:flex;gap:6px;align-items:center;font-size:14px}
.grow{flex:1}
.sv-body{display:grid;grid-template-columns:200px minmax(0,1fr);gap:14px}
.vlist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;max-height:360px;overflow:auto}
.vlist button{width:100%;text-align:left;border:1px solid transparent;background:none;border-radius:var(--radius-sm);padding:8px 10px;cursor:pointer;font-family:var(--font);color:var(--text);display:flex;flex-direction:column;gap:2px}
.vlist button:hover{background:var(--chip)}
.vlist button.on{background:var(--primary-soft);border-color:var(--primary-border)}
.vlist small{font-size:11.5px;color:var(--caption)}
.vview{min-width:0;display:flex;flex-direction:column;gap:8px}
.legend{display:flex;gap:10px;align-items:center;font-size:12px}
.diff{white-space:pre-wrap;line-height:1.6;font-size:13.5px;max-height:360px;overflow:auto;border:1px solid var(--divider);border-radius:var(--radius-sm);padding:10px 12px}
.del{background:var(--danger-bg);color:var(--danger);text-decoration:line-through;border-radius:3px}
.add{background:var(--ok-bg);color:var(--ok-fg);border-radius:3px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
@media(max-width:800px){.sv-body{grid-template-columns:minmax(0,1fr)}}
`],
})
export class SectionVersionsComponent implements OnInit {
  private api = inject(Api);
  private confirm = inject(ConfirmService);
  @Input() evaluationId = '';
  @Input() sectionKey = '';
  @Input() canRestore = false;
  @Output() closed = new EventEmitter<void>();
  @Output() restored = new EventEmitter<void>();
  data: {current: any; versions: any[]} | null = null;
  sel: any = null; diff: DiffPart[] = []; busy = false;

  async ngOnInit() {
    try { this.data = await this.api.req('GET', `/evaluations/${this.evaluationId}/sections/${this.sectionKey}/history`); } catch { this.data = {current: null, versions: []}; }
    if (this.data?.versions?.length) this.pick(this.data.versions[0]);
  }
  pick(v: any) { this.sel = v; this.diff = wordDiff(v.content, this.data?.current?.content || ''); }
  when(iso: string) { const d = new Date(iso); return isNaN(+d) ? '' : `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}`; }
  async restore() {
    if (!this.sel || !await this.confirm.ask({title: `Restaurar a versão ${this.sel.version}?`, body: 'Ela volta a ser o texto da seção e a seção volta para revisão. O texto atual fica guardado como versão.', ok: 'Restaurar'})) return;
    this.busy = true;
    try { await this.api.req('POST', `/evaluations/${this.evaluationId}/sections/${this.sectionKey}/restore`, {version: this.sel.version}); this.api.notify('Versão restaurada.'); this.restored.emit(); }
    catch {} finally { this.busy = false; }
  }
}
