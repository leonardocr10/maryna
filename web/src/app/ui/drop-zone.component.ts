import {Component, EventEmitter, Input, Output} from '@angular/core';
import {CommonModule} from '@angular/common';
import {IconComponent} from './icon.component';

/** .docx upload zone: click or drag. Shows the file name once sent. */
@Component({
  selector: 'nl-drop-zone',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
<div class="dz" [class.done]="filename" [class.over]="over" [class.busy]="busy" [class.inline]="inline" [class.disabled]="disabled" [class.need]="need && !filename && !disabled && !busy"
     (click)="!disabled&&!busy&&picker.click()" (dragover)="$event.preventDefault();over=true" (dragleave)="over=false" (drop)="onDrop($event)">
  <input #picker type="file" accept=".docx" hidden (click)="$event.stopPropagation()" (change)="onPick($event)">
  <div class="icon"><ng-container *ngIf="busy">…</ng-container><nl-icon *ngIf="!busy" [name]="filename ? 'doc' : 'upload'"/></div>
  <div class="txt">
    <strong>{{title}}<span *ngIf="required" class="req" aria-hidden="true"> *</span><span *ngIf="required" class="sr"> (obrigatório)</span></strong>
    <code *ngIf="filename" class="name">{{filename}}</code>
    <button *ngIf="filename && downloadable" type="button" class="dl" (click)="$event.stopPropagation(); download.emit()" [title]="'Baixar o arquivo original: ' + filename"><nl-icon name="download"/> Baixar original</button>
    <span class="hint">{{busy?'Enviando…':filename?'Arraste outro para trocar':(need&&!disabled?'Obrigatório · arraste o .docx aqui ou clique':'Arraste o .docx aqui ou clique')}}</span>
  </div>
</div>`,
  styles: [`
.dz{border:1.5px dashed var(--border-dashed);border-radius:10px;background: var(--card);padding:24px 18px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;cursor:pointer;transition:background .15s,border-color .15s;min-height:170px;justify-content:center}
.dz:hover,.dz.over{border-color:var(--primary);background:var(--primary-soft)}
.dz.done{border:1px solid var(--primary-border);background:var(--primary-soft);border-radius:var(--radius-lg)}
.dz.busy{cursor:progress}.dz.disabled{opacity:.6;cursor:not-allowed}
.icon{width:42px;height:42px;border-radius:50%;background:var(--chip);color:var(--text-3);display:grid;place-items:center;font-size:18px;--ico-size:20px;margin-bottom:2px}
.done .icon{background:var(--primary);color:var(--on-primary)}
.txt{display:flex;flex-direction:column;gap:4px;min-width:0;max-width:100%}
strong{font-size:14.5px;font-weight:600;color:var(--text)}
.name{font:12.5px var(--mono);color:var(--primary-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hint{font-size:12.5px;color:var(--text-3)}
.dl{align-self:flex-start;display:inline-flex;align-items:center;gap:5px;padding:0;border:0;background:none;color:var(--primary-text,var(--primary));font:600 12.5px var(--font,inherit);cursor:pointer;--ico-size:14px}
.dl:hover{text-decoration:underline}.dl:focus-visible{outline:2px solid var(--primary);outline-offset:2px;border-radius:4px}
.dz:not(.inline) .dl{align-self:center}
.req{color:var(--danger,#c0392b)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.dz.need{border-color:var(--danger,#c0392b);background:color-mix(in srgb,var(--danger,#c0392b) 4%,var(--card))}
.dz.need .hint{color:var(--danger,#c0392b)}
.dz.need .icon{color:var(--danger,#c0392b)}
.dz.inline{flex-direction:row;min-height:0;padding:14px 16px;text-align:left;justify-content:flex-start}
.dz.inline .icon{width:34px;height:34px;flex:none}
`],
})
export class DropZoneComponent {
  @Input() title = '';
  @Input() filename = '';
  @Input() busy = false;
  @Input() inline = false;
  @Input() disabled = false;
  /** Shows "*" next to the title. */
  @Input() required = false;
  /** Required and still missing: red outline and hint. */
  @Input() need = false;
  @Output() file = new EventEmitter<File>();
  /** Shows "Baixar original" once a file was sent. */
  @Input() downloadable = false;
  @Output() download = new EventEmitter<void>();
  over = false;
  onDrop(e: DragEvent) { e.preventDefault(); this.over = false; const f = e.dataTransfer?.files?.[0]; if (f && !this.disabled) this.emit(f); }
  onPick(e: Event) { const input = e.target as HTMLInputElement; const f = input.files?.[0]; input.value = ''; if (f) this.emit(f); }
  private emit(f: File) { this.file.emit(f); }
}
