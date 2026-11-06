import {AfterViewChecked, Component, ElementRef, HostListener, ViewChild, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {ConfirmService} from '../confirm.service';
import {IconComponent} from './icon.component';

/** The single confirmation modal of the app (rendered once in AppComponent). */
@Component({
  selector: 'nl-confirm-dialog',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
<div *ngIf="c.current() as d" class="modal-bg" (mousedown)="onBackdrop($event)">
  <div #box class="modal" role="dialog" aria-modal="true" aria-labelledby="cd-title" [attr.aria-describedby]="d.body ? 'cd-body' : null">
    <div class="m-icon" [class]="'m-icon ' + (d.tone || 'primary')"><nl-icon [name]="d.tone==='danger' ? 'trash' : d.tone==='review' ? 'restore' : 'info'"/></div>
    <h2 id="cd-title">{{d.title}}</h2>
    <div class="modal-body">
      <p *ngIf="d.body" id="cd-body">{{d.body}}</p>
      <div *ngIf="d.quote" class="quote"><span>{{d.quote.label}}</span>{{d.quote.text}}</div>
      <ul *ngIf="d.facts?.length" class="facts"><li *ngFor="let f of d.facts">{{f}}</li></ul>
    </div>
    <div class="modal-acts">
      <button type="button" class="btn btn-secondary" (click)="c.close(false)">{{d.cancel || 'Cancelar'}}</button>
      <button #ok type="button" class="btn btn-primary" [class.danger]="d.tone==='danger'" (click)="c.close(true)">{{d.ok || 'Confirmar'}}</button>
    </div>
  </div>
</div>`,
  styles: [`
.m-icon{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;margin-bottom:14px;--ico-size:22px;background:var(--primary-soft);color:var(--primary)}
.m-icon.review{background:var(--review-bg);color:var(--review)}
.m-icon.danger{background:var(--danger-bg);color:var(--danger)}
.modal-body p{margin-bottom:12px;white-space:pre-line}
.quote{padding:10px 12px;border-radius:var(--radius-sm);background:var(--chip);font-size:13px;margin-bottom:12px;color:var(--text);white-space:pre-line}
.quote span{display:block;font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--caption);margin-bottom:4px}
.facts{margin:0;padding:0 0 0 18px;font-size:13px;color:var(--text-3)}
.facts li{margin:2px 0}
.btn.danger{background:var(--danger);color:#fff}
.btn.danger:hover:not(:disabled){filter:brightness(.92);background:var(--danger)}
`],
})
export class ConfirmDialogComponent implements AfterViewChecked {
  c = inject(ConfirmService);
  @ViewChild('box') box?: ElementRef<HTMLElement>;
  @ViewChild('ok') ok?: ElementRef<HTMLButtonElement>;
  private openedFor: unknown = null;
  private returnFocus: HTMLElement | null = null;

  ngAfterViewChecked() {
    const cur = this.c.current();
    if (cur && cur !== this.openedFor) {
      this.openedFor = cur;
      this.returnFocus = document.activeElement as HTMLElement;
      setTimeout(() => this.ok?.nativeElement.focus());
    } else if (!cur && this.openedFor) {
      this.openedFor = null;
      const el = this.returnFocus; this.returnFocus = null;
      if (el?.isConnected) setTimeout(() => el.focus());
    }
  }

  onBackdrop(e: MouseEvent) { if (e.target === e.currentTarget) this.c.close(false); }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if (!this.c.current()) return;
    if (e.key === 'Escape') { e.preventDefault(); this.c.close(false); return; }
    if (e.key === 'Tab' && this.box) {
      const f = Array.from(this.box.nativeElement.querySelectorAll<HTMLElement>('button'));
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
}
