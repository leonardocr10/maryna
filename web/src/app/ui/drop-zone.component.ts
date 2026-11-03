import {Component, EventEmitter, Input, Output} from '@angular/core';
import {CommonModule} from '@angular/common';

/** .docx upload zone: click or drag. Shows the file name once sent. */
@Component({
  selector: 'nl-drop-zone',
  standalone: true,
  imports: [CommonModule],
  template: `
<div class="dz" [class.done]="filename" [class.over]="over" [class.busy]="busy" [class.inline]="inline" [class.disabled]="disabled"
     (click)="!disabled&&!busy&&picker.click()" (dragover)="$event.preventDefault();over=true" (dragleave)="over=false" (drop)="onDrop($event)">
  <input #picker type="file" accept=".docx" hidden (click)="$event.stopPropagation()" (change)="onPick($event)">
  <div class="icon">{{busy?'…':filename?'✓':'+'}}</div>
  <div class="txt">
    <strong>{{title}}</strong>
    <span *ngIf="filename" class="name mono">{{filename}}</span>
    <span class="hint">{{busy?'Enviando…':filename?'Arraste outro para trocar':'Arraste o .docx aqui ou clique'}}</span>
  </div>
</div>`,
  styles: [`
.dz{border:1.5px dashed var(--border-dashed);border-radius:10px;background:#fff;padding:24px 18px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;cursor:pointer;transition:background .15s,border-color .15s;min-height:170px;justify-content:center}
.dz:hover,.dz.over{border-color:var(--primary);background:var(--primary-soft)}
.dz.done{border:1.5px solid var(--primary-border-2);background:#f3faf7}
.dz.busy{cursor:progress}.dz.disabled{opacity:.6;cursor:not-allowed}
.icon{width:40px;height:40px;border-radius:50%;background:#eef3f1;color:var(--text-3);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:500}
.done .icon{background:var(--primary);color:#fff;font-size:16px}
.txt{display:flex;flex-direction:column;gap:4px;min-width:0;max-width:100%}
strong{font-size:14px;font-weight:600}
.name{font-size:12.5px;color:var(--primary-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hint{font-size:12.5px;color:var(--caption)}
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
  @Output() file = new EventEmitter<File>();
  over = false;
  onDrop(e: DragEvent) { e.preventDefault(); this.over = false; const f = e.dataTransfer?.files?.[0]; if (f && !this.disabled) this.emit(f); }
  onPick(e: Event) { const input = e.target as HTMLInputElement; const f = input.files?.[0]; input.value = ''; if (f) this.emit(f); }
  private emit(f: File) { this.file.emit(f); }
}
