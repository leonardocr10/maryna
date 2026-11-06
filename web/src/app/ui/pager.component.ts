import {Component, EventEmitter, Input, Output} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FilterSelectComponent} from './filter-select.component';
import {IconComponent} from './icon.component';

/** List footer: "Mostrando 1–8 de 48 …", page size and page buttons (with … when there are many pages). */
@Component({
  selector: 'nl-pager',
  standalone: true,
  imports: [CommonModule, FilterSelectComponent, IconComponent],
  template: `
<div class="pager">
  <span class="info">Mostrando <b>{{from()}}–{{to()}}</b> de {{total}} {{noun}}</span>
  <span class="size">Itens por página
    <nl-filter-select size="sm" [searchable]="false" [dropUp]="true" ariaLabel="Itens por página"
      [options]="['8','10','20','50']" [value]="''+perPage" (valueChange)="setPer($event)"></nl-filter-select></span>
  <nav class="pages" aria-label="Paginação">
    <button type="button" [disabled]="page<=1" (click)="go(page-1)" aria-label="Página anterior"><nl-icon name="chevl"/></button>
    <ng-container *ngFor="let p of list()">
      <span *ngIf="p===0" class="gap">…</span>
      <button *ngIf="p!==0" type="button" [class.on]="p===page" [attr.aria-current]="p===page ? 'page' : null" (click)="go(p)">{{p}}</button>
    </ng-container>
    <button type="button" [disabled]="page>=pages()" (click)="go(page+1)" aria-label="Próxima página"><nl-icon name="chevr"/></button>
  </nav>
</div>`,
  styles: [`
.pager{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:12px 20px;border-top:1px solid var(--divider);font-size:13px;color:var(--text-3)}
.info b{color:var(--text);font-weight:600}
.size{display:inline-flex;align-items:center;gap:8px;margin-left:auto;white-space:nowrap}
.size nl-filter-select{width:72px}
.pages{display:inline-flex;align-items:center;gap:4px}
.pages button{min-width:32px;height:32px;padding:0 8px;border-radius:var(--radius-sm);border:1px solid var(--border-card);background:var(--card);color:var(--text-2);font:500 13px var(--font);cursor:pointer;display:inline-grid;place-items:center}
.pages button:hover:not(:disabled){background:var(--chip)}
.pages button.on{background:var(--primary);border-color:var(--primary);color:var(--on-primary);font-weight:600}
.pages button:disabled{opacity:.4;cursor:not-allowed}
.pages button:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.gap{min-width:20px;text-align:center}
`],
})
export class PagerComponent {
  @Input() total = 0;
  @Input() page = 1;
  @Input() perPage = 8;
  @Input() noun = 'itens';
  @Output() pageChange = new EventEmitter<number>();
  @Output() perPageChange = new EventEmitter<number>();

  pages() { return Math.max(1, Math.ceil(this.total / this.perPage)); }
  from() { return this.total ? (this.page - 1) * this.perPage + 1 : 0; }
  to() { return Math.min(this.total, this.page * this.perPage); }
  /** Page numbers; 0 marks a gap. */
  list() {
    const n = this.pages(), p = this.page;
    if (n <= 7) return Array.from({length: n}, (_, i) => i + 1);
    let lo = Math.max(2, p - 1), hi = Math.min(n - 1, p + 1);
    if (p <= 3) { lo = 2; hi = 4; }
    if (p >= n - 2) { lo = n - 3; hi = n - 1; }
    const out = [1];
    if (lo > 2) out.push(0);
    for (let i = lo; i <= hi; i++) out.push(i);
    if (hi < n - 1) out.push(0);
    out.push(n);
    return out;
  }
  go(p: number) { p = Math.min(Math.max(1, p), this.pages()); if (p !== this.page) { this.page = p; this.pageChange.emit(p); } }
  setPer(v: string) { this.perPage = +v; this.perPageChange.emit(+v); this.page = 1; this.pageChange.emit(1); }
}
