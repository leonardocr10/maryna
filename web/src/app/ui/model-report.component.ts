import {Component, Input} from '@angular/core';
import {CommonModule} from '@angular/common';
import {IconComponent} from './icon.component';

export const MODEL_STATUS: Record<string, {label: string; css: string}> = {
  complete: {label: 'Completo', css: 'ok'}, attention: {label: 'Conferir', css: 'warn'}, incomplete: {label: 'Incompleto', css: 'danger'},
};
const STATE: Record<string, {icon: string; css: string; label: string}> = {
  ok: {icon: 'checkc', css: 'ok', label: 'Pronta'}, auto: {icon: 'info', css: 'warn', label: 'Campo criado ao baixar'},
  optional: {icon: 'info', css: 'idle', label: 'Opcional'}, fixed: {icon: 'doc', css: 'idle', label: 'Texto do arquivo'}, missing: {icon: 'alert', css: 'danger', label: 'Falta'},
};

/** Check list of a report model: which sections the AI can fill, identification fields and warnings. */
@Component({
  selector: 'nl-model-report',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
<div *ngIf="report" class="mr" [class.compact]="compact">
  <div class="mr-score">
    <div class="mr-top"><b>{{report.ready}} de {{report.total}}</b> seções prontas <span [class]="'badge ' + st().css">{{st().label}}</span></div>
    <div class="progress" [class.full]="report.status==='complete'"><span [style.width.%]="pct()"></span></div>
  </div>

  <div *ngFor="let w of report.warnings" class="mr-warn" [class.danger]="w.level==='danger'" role="note"><nl-icon [name]="w.level==='danger' ? 'alert' : 'info'"/><span>{{w.text}}</span></div>

  <details class="mr-group" [open]="!compact || report.status!=='complete'">
    <summary><nl-icon name="layers"/> Seções <span class="cnt">{{report.ready}}/{{report.total}}</span><nl-icon name="chevd" class="chev"/></summary>
    <ul>
      <li *ngFor="let s of report.sections" [class]="'st-' + s.state" [title]="s.note">
        <span class="si" [class]="'si ' + state(s.state).css"><nl-icon [name]="state(s.state).icon"/></span>
        <span class="sn"><b>{{s.name}}</b><small *ngIf="!compact || s.state!=='ok'">{{s.note}}</small></span>
        <span *ngIf="s.old_text" class="badge warn">Texto antigo</span>
      </li>
    </ul>
  </details>

  <details class="mr-group" [open]="!compact">
    <summary><nl-icon name="user"/> Identificação <span class="cnt">{{report.identification.length}}</span><nl-icon name="chevd" class="chev"/></summary>
    <p *ngIf="!report.identification.length" class="caption pad">Nenhum campo encontrado.</p>
    <div class="chips">
      <span *ngFor="let f of report.identification" class="chip" [class.filled]="f.filled">{{f.label}}<em *ngIf="f.filled"> · preenchido</em></span>
    </div>
    <p class="caption pad">Preenchidos sozinhos com os dados da avaliação ao baixar o Word.</p>
  </details>

  <p class="caption mr-foot"><nl-icon name="table"/> {{report.tables}} {{report.tables===1 ? 'tabela' : 'tabelas'}} no documento. Tabelas, escores e textos fora dos campos de interpretação nunca são alterados.</p>
</div>`,
  styles: [`
:host{display:block}
.mr{display:flex;flex-direction:column;gap:12px}
.mr-top{display:flex;align-items:center;gap:6px;font-size:14px;color:var(--text-2);margin-bottom:8px}
.mr-top b{color:var(--text);font-size:15px}
.mr-top .badge{margin-left:auto}
.mr-warn{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:var(--radius-sm);background:var(--warn-bg);color:var(--warn-fg);font-size:13px;line-height:1.45;--ico-size:16px}
.mr-warn.danger{background:var(--danger-bg);color:var(--danger)}
.mr-warn nl-icon{margin-top:1px}
.mr-group{border:1px solid var(--border-card);border-radius:var(--radius-sm);background:var(--card)}
.mr-group summary{list-style:none;display:flex;align-items:center;gap:10px;padding:11px 12px;cursor:pointer;font-weight:600;font-size:14px;color:var(--text);--ico-size:18px}
.mr-group summary::-webkit-details-marker{display:none}
.mr-group summary>nl-icon:first-child{color:var(--primary)}
.mr-group summary:focus-visible{outline:2px solid var(--primary);outline-offset:-2px;border-radius:var(--radius-sm)}
.cnt{font-weight:500;color:var(--text-3);font-size:13px}
.chev{margin-left:auto;color:var(--text-3);transition:transform .15s}
.mr-group[open] .chev{transform:rotate(180deg)}
ul{list-style:none;margin:0;padding:0 8px 8px;display:flex;flex-direction:column;gap:2px}
li{display:flex;gap:10px;align-items:flex-start;padding:7px 6px;border-radius:6px}
li.st-missing{background:var(--danger-bg)}
.si{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;flex:none;--ico-size:15px}
.si.ok{color:var(--ok-fg);background:var(--ok-bg)}.si.warn{color:var(--warn-fg);background:var(--warn-bg)}
.si.idle{color:var(--idle-fg);background:var(--idle-bg)}.si.danger{color:var(--danger);background:var(--card)}
.sn{flex:1;min-width:0}
.sn b{display:block;font-size:13.5px;font-weight:600;color:var(--text)}
.sn small{display:block;font-size:12px;color:var(--text-3);line-height:1.4;margin-top:1px}
li .badge{flex:none}
.chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px}
.chip{font:500 12.5px var(--mono);padding:4px 10px;border-radius:var(--radius-pill);background:var(--primary-soft);color:var(--primary-text);border:1px solid var(--primary-border)}
.chip.filled{background:var(--danger-bg);color:var(--danger);border-color:var(--danger-border)}
.chip em{font-style:normal;font-family:var(--font)}
.pad{padding:8px 12px 12px}
.mr-foot{display:flex;gap:8px;align-items:flex-start;--ico-size:15px;line-height:1.45}
.compact .mr-group summary{padding:10px 12px}
`],
})
export class ModelReportComponent {
  @Input() report: any = null;
  @Input() compact = false;
  st() { return MODEL_STATUS[this.report?.status] || MODEL_STATUS['incomplete']; }
  pct() { return this.report?.total ? Math.round(this.report.ready / this.report.total * 100) : 0; }
  state(s: string) { return STATE[s] || STATE['missing']; }
}
