import {Injectable, signal} from '@angular/core';

export interface ConfirmOptions {
  title: string;
  /** Main sentence: what will happen. */
  body?: string;
  /** Short facts listed under the body (what is kept, cost, history…). */
  facts?: string[];
  /** Quoted text, e.g. the instruction that will be sent. */
  quote?: {label: string; text: string};
  ok?: string;
  cancel?: string;
  tone?: 'primary' | 'review' | 'danger';
}

/** Styled replacement for window.confirm(): `if (!await confirm.ask({...})) return;` */
@Injectable({providedIn: 'root'})
export class ConfirmService {
  readonly current = signal<(ConfirmOptions & {resolve: (ok: boolean) => void}) | null>(null);

  ask(o: ConfirmOptions): Promise<boolean> {
    this.current()?.resolve(false);
    return new Promise<boolean>(resolve => this.current.set({...o, resolve}));
  }

  close(ok: boolean) {
    const c = this.current();
    this.current.set(null);
    c?.resolve(ok);
  }
}
