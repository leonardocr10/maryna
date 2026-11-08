import {Component, EventEmitter, Input, OnInit, Output, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {Api} from '../api.service';
import {IconComponent} from './icon.component';

const SCOPE_TEXT: Record<string, string> = {
  'anamnese.ler': 'Ler as anotações de anamnese das tarefas que você preparar (com nomes e datas trocados por marcadores).',
  'anamnese.salvar': 'Salvar o texto escrito pelo ChatGPT como rascunho dessas tarefas, para você revisar e aprovar aqui.',
};

/**
 * OAuth consent for the ChatGPT plugin: shown after the person signs in to NeuroLaudos (own password and 2-step code).
 * Approving sends the browser back to ChatGPT with a one-time code; nothing of the ChatGPT session is read or kept.
 */
@Component({
  selector: 'nl-chatgpt-consent',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
<div class="backdrop" role="dialog" aria-modal="true" aria-labelledby="cc-title">
  <div class="card cc">
    <div class="cc-head"><span class="ei"><nl-icon name="shield"/></span><h2 id="cc-title">Conectar o ChatGPT ao NeuroLaudos IA</h2></div>
    <p *ngIf="loading" class="muted">Carregando o pedido…</p>
    <ng-container *ngIf="!loading && info">
      <p><b>{{info.client_name}}</b> pede acesso à sua conta ({{api.me()?.email}}) para:</p>
      <ul><li *ngFor="let s of info.scopes">{{scopeText(s)}}</li></ul>
      <p class="muted">Só as tarefas criadas por você, com código, ficam acessíveis; o acesso pode ser desligado em Gerar anamnese pelo ChatGPT &gt; Desconectar. Nada é aprovado no laudo sem a sua revisão.</p>
      <div *ngIf="!info.can_approve" class="alert warn small"><nl-icon name="info"/><div><p>Só psicólogas(os) e administradores podem conectar o ChatGPT.</p></div></div>
      <div class="row"><button class="btn btn-secondary" [disabled]="busy" (click)="decide(false)">Recusar</button>
        <button class="btn btn-primary" [disabled]="busy || !info.can_approve" (click)="decide(true)"><nl-icon name="check"/> Autorizar</button></div>
    </ng-container>
    <ng-container *ngIf="!loading && !info">
      <p>{{error || 'Pedido de autorização não encontrado ou expirado. Volte ao ChatGPT e conecte de novo.'}}</p>
      <div class="row"><button class="btn btn-secondary" (click)="done.emit()">Fechar</button></div>
    </ng-container>
  </div>
</div>`,
  styles: [`
nl-icon{--ico-size:18px}
.backdrop{position:fixed;inset:0;background:rgba(10,14,20,.45);display:grid;place-items:center;z-index:1000;padding:16px}
.cc{max-width:520px;width:100%;padding:22px 24px;display:flex;flex-direction:column;gap:12px}
.cc-head{display:flex;align-items:center;gap:12px}.cc-head h2{font-size:17px;font-weight:600}
.ei{width:38px;height:38px;border-radius:var(--radius-sm);display:grid;place-items:center;background:var(--review-bg);color:var(--review);flex:none}
ul{margin:0;padding-left:20px;line-height:1.6;font-size:14px}
p{margin:0;font-size:14px;line-height:1.55}.muted{color:var(--text-3);font-size:13px}
.row{display:flex;gap:8px;justify-content:flex-end}
`],
})
export class ChatgptConsentComponent implements OnInit {
  api = inject(Api);
  @Input() requestId = '';
  @Output() done = new EventEmitter<void>();
  info: {client_name: string; scopes: string[]; can_approve: boolean} | null = null;
  loading = true; busy = false; error = '';

  async ngOnInit() {
    try { this.info = await this.api.req('GET', '/oauth/requests/' + encodeURIComponent(this.requestId)); }
    catch (e: any) { this.error = e?.error?.error || ''; } finally { this.loading = false; }
  }
  scopeText(s: string) { return SCOPE_TEXT[s] || s; }
  async decide(approve: boolean) {
    this.busy = true;
    try {
      const r = await this.api.req<{redirect: string}>('POST', `/oauth/requests/${encodeURIComponent(this.requestId)}/decision`, {approve});
      this.done.emit();
      // The server built this URL from the redirect registered by ChatGPT (https on an allowed host only).
      window.location.assign(r.redirect);
    } catch { this.busy = false; }
  }
}
