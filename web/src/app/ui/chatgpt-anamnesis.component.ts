import {Component, EventEmitter, Input, OnDestroy, OnInit, Output, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Api} from '../api.service';
import {ConfirmService} from '../confirm.service';
import {IconComponent} from './icon.component';

type Method = 'api' | 'mcp' | 'paste';
interface Task {id: string; code: string; mode: 'mcp' | 'paste'; status: string; status_label: string; expires_at: string; applied: boolean; needs_confirmation: boolean; received_text: string | null; existing_approved: boolean; error: string | null; command?: string; text?: string | null; hidden?: number}
const OPEN = ['pending', 'processing'];
const CHATGPT = 'https://chatgpt.com/';

async function writeClipboard(text: string): Promise<boolean> {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch {}
  const box = document.createElement('textarea');
  box.value = text; box.setAttribute('readonly', ''); box.style.position = 'fixed'; box.style.opacity = '0'; box.style.top = '0';
  document.body.appendChild(box); box.select();
  try { return document.execCommand('copy'); } catch { return false; } finally { box.remove(); }
}
const newOpId = () => 'op-' + (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36));

/**
 * "Gerar anamnese pelo ChatGPT": the current API generation, the ChatGPT plugin (MCP) or assisted copy and paste.
 * Nothing here reads the ChatGPT page: the plugin talks to the server, and copy and paste is done by the person.
 */
@Component({
  selector: 'nl-chatgpt-anamnesis',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
<div class="cg" role="region" aria-label="Geração da anamnese">
  <div class="cg-head"><nl-icon name="spark"/><b>Geração da anamnese</b>
    <span *ngIf="task" [class]="'badge ' + badge()">{{task.status_label}}</span>
    <button class="x" (click)="closed.emit()" aria-label="Fechar">×</button></div>

  <fieldset class="methods" [disabled]="busy">
    <legend>Método de geração</legend>
    <label><input type="radio" name="cg-method" value="api" [(ngModel)]="method"> <span><b>OpenAI API</b><small>Geração atual, pelo servidor (custo por uso).</small></span></label>
    <label [class.off]="!cfg?.mcp_enabled"><input type="radio" name="cg-method" value="mcp" [(ngModel)]="method" [disabled]="!cfg?.mcp_enabled"> <span><b>ChatGPT — plugin (MCP)</b><small>{{cfg?.mcp_enabled ? 'O ChatGPT busca as anotações e devolve o rascunho para cá, com sua autorização.' : 'Desligado neste computador (veja Configurações necessárias no README).'}}</small></span></label>
    <label><input type="radio" name="cg-method" value="paste" [(ngModel)]="method"> <span><b>ChatGPT — cópia e colagem assistida</b><small>Você cola o texto preparado no ChatGPT e cola a resposta aqui.</small></span></label>
  </fieldset>

  <!-- A draft arrived while the evaluation already had an anamnesis: never replaced without her confirmation -->
  <div *ngIf="task?.needs_confirmation" class="alert warn small"><nl-icon name="info"/><div>
    <p><b>Rascunho recebido do ChatGPT.</b> A avaliação já tem uma anamnese{{task?.existing_approved ? ' aprovada' : ''}}; ela só é substituída se você confirmar. O texto atual fica em Versões.</p>
    <details><summary>Ver o rascunho recebido</summary><div class="cg-preview"><p *ngFor="let p of blocks(task?.received_text)" [class.t]="p.startsWith('## ')">{{p.replace('## ', '')}}</p></div></details>
    <div class="row"><button class="btn btn-primary btn-sm" [disabled]="busy || readOnly" (click)="apply()"><nl-icon name="check"/> Substituir pela versão do ChatGPT</button>
      <button class="btn btn-secondary btn-sm" [disabled]="busy" (click)="discard()">Descartar rascunho</button></div>
  </div></div>
  <div *ngIf="task?.applied && task?.status!=='reviewed' && !task?.needs_confirmation" class="alert tip small" role="status"><nl-icon name="checkc"/><div><p>Rascunho do ChatGPT salvo na Anamnese. Revise, edite se precisar e aprove a seção.</p></div></div>
  <div *ngIf="task?.status==='error'" class="alert danger small"><nl-icon name="alert"/><div><p>{{task?.error || 'A tarefa terminou com erro.'}} Prepare uma nova.</p></div></div>

  <!-- Current API generation (unchanged) -->
  <div *ngIf="method==='api'" class="pane">
    <p class="hint">Gera a anamnese pela API da OpenAI, como hoje{{hasText ? ', substituindo o texto atual (que fica em Versões)' : ''}}.</p>
    <div class="row"><button class="btn btn-primary btn-sm" [disabled]="readOnly" (click)="useApi.emit()"><nl-icon name="spark"/> {{hasText ? 'Regenerar pela API' : 'Gerar pela API'}}</button></div>
  </div>

  <!-- ChatGPT plugin (MCP) -->
  <div *ngIf="method==='mcp'" class="pane">
    <ng-container *ngIf="mcpTask(); else prepareMcp">
      <div class="code-row"><span class="caption">Código da tarefa</span><code class="code">{{task?.code}}</code><small>vale até {{until(task?.expires_at)}}</small></div>
      <ol class="steps">
        <li>Abra o ChatGPT e, no campo de mensagem, digite <kbd>&#64;</kbd> e escolha <b>NeuroLaudos IA</b>.{{cfg?.connected ? '' : ' Na primeira vez, o ChatGPT pede para conectar: entre com a sua conta do NeuroLaudos e autorize.'}}</li>
        <li>Cole o comando abaixo e envie.</li>
        <li>Quando o ChatGPT pedir para salvar no NeuroLaudos IA, confira e confirme. O rascunho aparece aqui sozinho.</li>
      </ol>
      <textarea class="input mono" readonly rows="4" [value]="task?.command || ''" aria-label="Comando para o ChatGPT" (focus)="$any($event.target).select()"></textarea>
      <div class="row">
        <button class="btn btn-secondary btn-sm" (click)="copy(task?.command || '', 'Comando copiado.')"><nl-icon name="copy"/> Copiar comando</button>
        <button class="btn btn-secondary btn-sm" (click)="openChatGpt()"><nl-icon name="external"/> Abrir ChatGPT</button>
        <span class="grow"></span>
        <button class="link" [disabled]="busy" (click)="prepare('mcp')">Gerar novo código</button>
        <button *ngIf="cfg?.connected" class="link" (click)="disconnect()">Desconectar ChatGPT</button>
      </div>
      <small class="hint">O ChatGPT recebe as anotações com nomes, datas e contatos trocados por marcadores; os nomes voltam ao salvar. Nenhuma chamada paga à API é feita neste método; vale o limite do seu plano do ChatGPT.</small>
    </ng-container>
    <ng-template #prepareMcp>
      <p class="hint">Cria uma tarefa com código, vinculada a esta avaliação e à sua conta, válida por {{cfg?.task_hours || 24}} h. O arquivo de anamnese não é alterado.</p>
      <div class="row"><button class="btn btn-primary btn-sm" [disabled]="busy || readOnly" (click)="prepare('mcp')"><nl-icon name="spark"/> {{busy ? 'Preparando…' : 'Preparar anamnese'}}</button></div>
    </ng-template>
  </div>

  <!-- Assisted copy and paste -->
  <div *ngIf="method==='paste'" class="pane">
    <ng-container *ngIf="pasteTask(); else preparePaste">
      <ng-container *ngIf="pasteText">
        <ol class="steps"><li>Clique em <b>Copiar texto e instrução</b> e em <b>Abrir ChatGPT</b>.</li><li>No ChatGPT, cole com <kbd>Ctrl</kbd> + <kbd>V</kbd> e envie.</li><li>Copie a resposta pelo botão de cópia do próprio ChatGPT, volte aqui e cole abaixo.</li></ol>
        <textarea class="input mono" readonly rows="4" [value]="pasteText" aria-label="Texto e instrução para o ChatGPT" (focus)="$any($event.target).select()"></textarea>
        <div class="row">
          <button class="btn btn-secondary btn-sm" (click)="copy(pasteText, 'Texto e instrução copiados. No ChatGPT, cole com Ctrl+V.')"><nl-icon name="copy"/> Copiar texto e instrução</button>
          <button class="btn btn-secondary btn-sm" (click)="openChatGpt()"><nl-icon name="external"/> Abrir ChatGPT</button>
          <small class="hint">{{hidden}} {{hidden===1 ? 'dado pessoal trocado' : 'dados pessoais trocados'}} por marcadores.</small>
        </div>
      </ng-container>
      <p *ngIf="!pasteText" class="hint">O texto preparado só fica na tela em que foi criado. Para copiar de novo, clique em <b>Preparar texto para ChatGPT</b>.</p>
      <label class="lbl" for="cg-answer">Colar resposta do ChatGPT</label>
      <textarea id="cg-answer" class="input" rows="8" [(ngModel)]="answer" (ngModelChange)="opId=''" placeholder="Cole aqui a anamnese que o ChatGPT escreveu (títulos e parágrafos são mantidos)."></textarea>
      <div class="row">
        <small class="hint">{{words(answer)}} palavras</small><span class="grow"></span>
        <button class="link" [disabled]="busy" (click)="prepare('paste')">Preparar texto para ChatGPT</button>
        <button class="btn btn-primary btn-sm" [disabled]="busy || readOnly || !answer.trim()" (click)="savePaste()"><nl-icon name="check"/> {{busy ? 'Salvando…' : 'Salvar anamnese'}}</button>
      </div>
    </ng-container>
    <ng-template #preparePaste>
      <p class="hint">Junta o texto do arquivo de anamnese à instrução padrão, sem chamar a IA. O arquivo original não é alterado.</p>
      <div class="row"><button class="btn btn-primary btn-sm" [disabled]="busy || readOnly" (click)="prepare('paste')"><nl-icon name="doc"/> {{busy ? 'Preparando…' : 'Preparar texto para ChatGPT'}}</button></div>
    </ng-template>
  </div>
</div>`,
  styles: [`
nl-icon{--ico-size:16px}
.cg{margin:12px 0;padding:14px;border:1px solid var(--review-bg);background:color-mix(in srgb,var(--review-bg) 55%,var(--card));border-radius:var(--radius-sm);display:flex;flex-direction:column;gap:12px}
.cg-head{display:flex;align-items:center;gap:8px;color:var(--text);font-size:14px}
.cg-head nl-icon{color:var(--review)}
.cg-head .x{margin-left:auto;width:28px;height:28px;border:0;background:none;border-radius:6px;font-size:18px;color:var(--text-3);cursor:pointer}
.cg-head .x:hover{background:var(--chip)}
.methods{border:0;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.methods legend{font-size:13px;font-weight:600;color:var(--text);margin-bottom:6px;padding:0}
.methods label{display:flex;gap:8px;align-items:flex-start;padding:10px;border:1px solid var(--border-card);border-radius:var(--radius-sm);background:var(--card);cursor:pointer}
.methods label.off{opacity:.6;cursor:not-allowed}
.methods label span{display:flex;flex-direction:column;gap:2px;font-size:13px;color:var(--text)}
.methods small{font-size:12px;color:var(--text-3);line-height:1.4}
.pane{display:flex;flex-direction:column;gap:10px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.grow{flex:1}
.hint{font-size:12.5px;color:var(--text-3);margin:0}
.steps{margin:0;padding-left:20px;font-size:13px;color:var(--text-2);line-height:1.6}
kbd{font:500 11.5px var(--mono);background:var(--card);border:1px solid var(--border-card);border-radius:4px;padding:0 5px}
textarea.mono{font-size:12px;line-height:1.5;background:var(--card);color:var(--text-2);resize:vertical}
textarea{height:auto;padding:10px 12px}
.code-row{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.code{font:600 18px var(--mono);letter-spacing:.06em;color:var(--text);background:var(--card);border:1px solid var(--border-card);border-radius:6px;padding:2px 10px}
.code-row small,.caption{font-size:12px;color:var(--text-3)}
.lbl{font-size:13px;font-weight:600;color:var(--text)}
.cg-preview{max-height:240px;overflow:auto;margin:8px 0;padding:8px 10px;background:var(--card);border-radius:6px}
.cg-preview p{margin:0 0 8px;font-size:13px;line-height:1.55}.cg-preview p.t{font-weight:600}
@media (max-width:760px){.methods{grid-template-columns:1fr}}
`],
})
export class ChatgptAnamnesisComponent implements OnInit, OnDestroy {
  private api = inject(Api);
  private confirm = inject(ConfirmService);
  @Input() evaluationId = '';
  @Input() hasText = false;
  @Input() readOnly = false;
  @Output() useApi = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  cfg: {mcp_enabled: boolean; connected: boolean; task_hours: number} | null = null;
  method: Method = 'paste';
  task: Task | null = null;
  pasteText = ''; hidden = 0; answer = ''; opId = ''; busy = false;
  private poll: any;

  async ngOnInit() {
    try { this.cfg = await this.api.req('GET', '/chatgpt/config'); } catch {}
    await this.refresh();
    this.method = this.task?.mode || (this.cfg?.mcp_enabled ? 'mcp' : 'paste');
    // Waits for the plugin's answer while the task is open (own server only; the ChatGPT page is never read).
    this.poll = setInterval(() => { if (this.task?.mode === 'mcp' && OPEN.includes(this.task.status) && !document.hidden) this.refresh(); }, 5000);
  }
  ngOnDestroy() { clearInterval(this.poll); }

  async refresh() {
    try {
      const before = this.task;
      this.task = await this.api.req<Task | null>('GET', `/evaluations/${this.evaluationId}/chatgpt-tasks/current`);
      if (before && OPEN.includes(before.status) && this.task && this.task.id === before.id && this.task.status === 'draft_received') {
        this.api.notify(this.task.needs_confirmation ? 'Rascunho do ChatGPT recebido: confirme se quer substituir a anamnese.' : 'Rascunho do ChatGPT salvo na Anamnese.');
        if (this.task.applied) this.saved.emit();
      }
    } catch {}
  }
  mcpTask() { return this.task?.mode === 'mcp' && OPEN.includes(this.task.status) ? this.task : null; }
  pasteTask() { return this.task?.mode === 'paste' && OPEN.includes(this.task.status) ? this.task : null; }
  badge() { const s = this.task?.status || ''; return s === 'draft_received' || s === 'reviewed' ? 'ok' : s === 'error' ? 'danger' : 'warn'; }

  async prepare(mode: 'mcp' | 'paste') {
    if (this.busy) return;
    this.busy = true;
    try {
      const r = await this.api.req<Task>('POST', `/evaluations/${this.evaluationId}/chatgpt-tasks`, {mode});
      this.task = r; this.method = mode;
      if (mode === 'paste') { this.pasteText = r.text || ''; this.hidden = r.hidden || 0; this.answer = ''; this.opId = ''; }
      const text = mode === 'mcp' ? r.command || '' : this.pasteText;
      const ok = await writeClipboard(text);
      this.api.notify(ok ? (mode === 'mcp' ? 'Tarefa criada e comando copiado. Abra o ChatGPT e escolha NeuroLaudos IA.' : 'Texto e instrução copiados. Abra o ChatGPT e cole com Ctrl+V.') : 'Tarefa criada. Use os botões de copiar.');
    } catch {} finally { this.busy = false; }
  }
  async copy(text: string, ok: string) { this.api.notify(await writeClipboard(text) ? ok : 'Não foi possível copiar. Selecione o texto e use Ctrl+C.'); }
  openChatGpt() { if (!window.open(CHATGPT, 'chatgpt')) this.api.notify('O navegador bloqueou a nova aba. Permita pop-ups para este site.'); }

  async savePaste() {
    if (this.busy || !this.task) return;
    this.busy = true;
    // The same operation id is reused while the text is unchanged, so a double click or a retry saves once.
    this.opId ||= newOpId();
    try {
      const r = await this.api.req<Task & {shape?: {titles: number; paragraphs: number}}>('POST', `/chatgpt-tasks/${this.task.id}/result`, {text: this.answer, op_id: this.opId});
      this.task = r;
      if (r.applied) { this.answer = ''; this.pasteText = ''; this.api.notify(`Anamnese salva como rascunho${r.shape ? ` (${r.shape.titles} tópicos, ${r.shape.paragraphs} parágrafos)` : ''}. Revise e aprove.`); this.saved.emit(); }
      else this.api.notify('Rascunho recebido. Confirme se quer substituir a anamnese atual.');
    } catch {} finally { this.busy = false; }
  }
  async apply() {
    if (!this.task || this.busy) return;
    if (!await this.confirm.ask({title: 'Substituir a anamnese pelo rascunho do ChatGPT?', body: 'O texto atual da Anamnese será trocado pelo rascunho recebido.', facts: ['O texto atual fica em Versões e pode ser restaurado', this.task.existing_approved ? 'A Anamnese volta a precisar de aprovação' : 'O rascunho entra para revisão e aprovação'], ok: 'Substituir'})) return;
    this.busy = true;
    try { this.task = await this.api.req<Task>('POST', `/chatgpt-tasks/${this.task.id}/apply`, {}); this.api.notify('Anamnese substituída pelo rascunho do ChatGPT. Revise e aprove.'); this.saved.emit(); }
    catch {} finally { this.busy = false; }
  }
  async discard() {
    if (!this.task || this.busy) return;
    this.busy = true;
    try { await this.api.req('POST', `/chatgpt-tasks/${this.task.id}/discard`, {}); this.task = null; this.api.notify('Rascunho descartado. A anamnese atual ficou como estava.'); }
    catch {} finally { this.busy = false; }
  }
  async disconnect() {
    if (!await this.confirm.ask({title: 'Desconectar o ChatGPT?', body: 'O plugin perde o acesso à sua conta até você autorizar de novo no ChatGPT.', ok: 'Desconectar'})) return;
    try { await this.api.req('DELETE', '/chatgpt/connection'); if (this.cfg) this.cfg.connected = false; this.api.notify('ChatGPT desconectado.'); } catch {}
  }
  blocks(t?: string | null) { return String(t || '').split(/\n{2,}/).filter(Boolean); }
  words(t: string) { return (t.match(/[\p{L}\p{N}]+/gu) || []).length; }
  until(iso?: string) { return iso ? new Date(iso).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : ''; }
}
