import {Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';

export type SelectOption = string | {label: string; value?: string; group?: string};
interface Normalized {label: string; value: string; group: string}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Select with a filter box. Enter picks the first result, Esc closes, click outside closes; supports groups. */
@Component({
  selector: 'nl-filter-select',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
<div class="fs" [class.open]="open" [class.disabled]="disabled">
  <button type="button" class="fs-field" [disabled]="disabled" (click)="toggle()" [attr.aria-expanded]="open">
    <span [class.ph]="!selected">{{selected?.label || placeholder}}</span><span class="caret">▼</span>
  </button>
  <div *ngIf="open" class="fs-menu" role="listbox">
    <input #filterBox class="fs-filter" [(ngModel)]="query" placeholder="Filtrar…" (keydown.enter)="$event.preventDefault();pickFirst()" (keydown.escape)="close()">
    <div class="fs-list">
      <ng-container *ngFor="let g of groups(); trackBy: trackGroup">
        <div *ngIf="g.name" class="fs-group">{{g.name}}</div>
        <button type="button" *ngFor="let o of g.items; trackBy: trackOption" class="fs-opt" [class.sel]="o.value===value" (click)="pick(o)">
          <span>{{o.label}}</span><span *ngIf="o.value===value" class="check">✓</span>
        </button>
      </ng-container>
      <div *ngIf="!filtered().length" class="fs-empty">Nenhum resultado</div>
    </div>
  </div>
</div>`,
  styles: [`
:host{display:block;min-width:0}
.fs{position:relative}
.fs-field{width:100%;height:42px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 12px;border:1px solid var(--border-input);border-radius:8px;background:#fff;color:var(--text);font:400 14px var(--font);cursor:pointer;text-align:left}
.fs-field span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fs-field:disabled{background:var(--field-disabled);color:var(--text-3);cursor:not-allowed}
.open .fs-field{border:1.5px solid var(--primary);box-shadow:0 0 0 3px var(--ring);padding:0 11.5px}
.ph{color:var(--placeholder)}
.caret{font-size:10px;color:var(--text-3);flex:none}
.fs-menu{position:absolute;top:calc(100% + 6px);left:0;right:0;min-width:220px;background:#fff;border:1px solid var(--border-input);border-radius:10px;box-shadow:var(--shadow-menu);padding:6px;z-index:40}
.fs-filter{width:100%;height:36px;border:0;border-radius:7px;background:var(--field-disabled);padding:0 10px;font:400 13.5px var(--font);color:var(--text);outline:none;margin-bottom:4px}
.fs-list{max-height:260px;overflow:auto}
.fs-group{font-size:11px;font-weight:600;color:var(--placeholder);text-transform:uppercase;letter-spacing:.05em;padding:10px 10px 4px}
.fs-opt{width:100%;display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border:0;border-radius:6px;background:none;font:400 13.5px var(--font);color:var(--text);cursor:pointer;text-align:left}
.fs-opt:hover{background:var(--chip)}
.fs-opt.sel{background:var(--primary-soft);font-weight:600}
.check{color:var(--primary)}
.fs-empty{padding:12px 10px;font-size:13px;color:var(--placeholder)}
`],
})
export class FilterSelectComponent {
  private host = inject(ElementRef<HTMLElement>);
  @ViewChild('filterBox') filterBox?: ElementRef<HTMLInputElement>;

  @Input() options: SelectOption[] = [];
  @Input() value = '';
  @Input() placeholder = 'Selecione';
  @Input() disabled = false;
  @Output() valueChange = new EventEmitter<string>();

  open = false;
  query = '';

  private norm(): Normalized[] {
    return this.options.map(o => typeof o === 'string' ? {label: o, value: o, group: ''} : {label: o.label, value: o.value ?? o.label, group: o.group || ''});
  }
  get selected() { return this.norm().find(o => o.value === this.value); }
  filtered() { const q = fold(this.query.trim()); return this.norm().filter(o => !q || fold(o.label).includes(q) || fold(o.group).includes(q)); }
  groups() {
    const out: {name: string; items: Normalized[]}[] = [];
    for (const o of this.filtered()) { let g = out.find(x => x.name === o.group); if (!g) out.push(g = {name: o.group, items: []}); g.items.push(o); }
    return out;
  }
  // Stable identities: without these Angular rebuilds the option buttons on every mousedown and the click is lost.
  trackGroup = (_: number, g: {name: string}) => g.name;
  trackOption = (_: number, o: Normalized) => o.value;
  toggle() { this.open ? this.close() : this.show(); }
  show() { if (this.disabled) return; this.open = true; this.query = ''; setTimeout(() => this.filterBox?.nativeElement.focus()); }
  close() { this.open = false; }
  pick(o: Normalized) { this.value = o.value; this.valueChange.emit(o.value); this.close(); }
  pickFirst() { const first = this.filtered()[0]; if (first) this.pick(first); }

  @HostListener('document:mousedown', ['$event'])
  onOutside(e: MouseEvent) { if (this.open && !this.host.nativeElement.contains(e.target as Node)) this.close(); }
}
