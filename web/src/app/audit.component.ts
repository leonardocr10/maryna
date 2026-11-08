import {Component, EventEmitter, OnInit, Output, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Api} from './api.service';
import {SECTIONS} from './shared';
import {FilterSelectComponent} from './ui/filter-select.component';
import {IconComponent} from './ui/icon.component';

/** Plain-language names for the audit actions (the codes stay in the database). */
/** Exact codes first; the patterns below cover the families. */
const EXACT: Record<string, string> = {
  user_mfa_enabled: 'Ativou a verificação em duas etapas', user_mfa_disabled: 'Desligou a verificação em duas etapas', user_mfa_reset: 'Zerou as duas etapas de uma conta',
  user_password_reset: 'Redefiniu a senha de uma conta', user_deactivated: 'Desativou uma conta', user_reactivated: 'Reativou uma conta',
  plan_updated: 'Alterou o plano de avaliação', plan_item_applied: 'Marcou instrumento como aplicado', plan_item_not_applied: 'Marcou instrumento como não aplicado', plan_item_planned: 'Desfez a marcação de um instrumento',
  session_scheduled: 'Agendou sessão', session_removed: 'Removeu sessão', delivery_cleared: 'Desfez o registro de entrega',
  devolutiva_generated: 'Gerou a devolutiva com IA', devolutiva_edited: 'Editou a devolutiva', devolutiva_approved: 'Aprovou a devolutiva', devolutiva_reopened: 'Reabriu a devolutiva', devolutiva_export: 'Baixou o Word da devolutiva', devolutiva_export_pdf: 'Baixou o PDF da devolutiva',
  evaluation_model_set: 'Escolheu o modelo de laudo', ai_settings_updated: 'Alterou as configurações da IA', ai_credit_updated: 'Atualizou o saldo da OpenAI', ai_connection_test: 'Testou a conexão com a IA',
  prompt_updated: 'Alterou um prompt padrão', snippet_created: 'Criou texto-padrão', snippet_updated: 'Editou texto-padrão', snippet_deleted: 'Excluiu texto-padrão',
  instrument_guide_updated: 'Alterou o guia de um instrumento', instrument_guide_reset: 'Voltou ao guia padrão de um instrumento', correction_reopened: 'Reabriu pedido de correção', patient_created: 'Cadastrou paciente',
};
const yesNo = (v: string) => v.startsWith('no') ? 'não' : 'sim';
const ACTIONS: [RegExp, string][] = [
  [/^user_created_(\w+)$/, 'Criou uma conta ($1)'], [/^user_role_(\w+)$/, 'Mudou o papel de uma conta ($1)'],
  [/^evaluation_opened$/, 'Abriu a avaliação'], [/^evaluation_created$/, 'Criou a avaliação'], [/^evaluation_deleted$/, 'Excluiu a avaliação'],
  [/^evaluation_approved$/, 'Aprovou o laudo'], [/^sections_bulk_approved$/, 'Aprovou todas as seções'], [/^evaluation_submitted$/, 'Enviou para revisão'],
  [/^document_uploaded_base$/, 'Enviou o arquivo base'], [/^document_uploaded_anamnesis$/, 'Enviou a anamnese'],
  [/^ai_generated_(.+)$/, 'Gerou com IA: $1'], [/^manual_prompt_(.+)$/, 'Copiou pedido para o ChatGPT: $1'], [/^chatgpt_task_created_mcp$/, 'ChatGPT: preparou tarefa do plugin'], [/^chatgpt_task_created_paste$/, 'ChatGPT: preparou texto para colar'], [/^chatgpt_task_fetched$/, 'ChatGPT: plugin leu a anamnese pendente'], [/^chatgpt_draft_received_(.+)$/, 'ChatGPT: recebeu rascunho da anamnese ($1)'], [/^chatgpt_draft_applied$/, 'ChatGPT: rascunho entrou na Anamnese'], [/^chatgpt_task_discarded$/, 'ChatGPT: descartou rascunho'], [/^chatgpt_authorized$/, 'ChatGPT: autorizou o plugin'], [/^chatgpt_authorization_denied$/, 'ChatGPT: recusou o plugin'], [/^chatgpt_disconnected$/, 'ChatGPT: desconectou o plugin'], [/^section_edited$/, 'Editou uma seção'],
  [/^section_written_manually$/, 'Escreveu uma seção'], [/^section_restored$/, 'Restaurou versão de seção'], [/^docx_export$/, 'Baixou o Word do laudo'],
  [/^docx_preview$/, 'Pré-visualizou o Word'], [/^pdf_export$/, 'Baixou o PDF do laudo'], [/^correction_requested$/, 'Pediu correção'],
  [/^correction_resolved$/, 'Resolveu pedido de correção'], [/^devolutiva_(.+)$/, 'Devolutiva: $1'], [/^report_delivered$/, 'Registrou a entrega'],
  [/^consent_(.+)$/, 'Consentimento: $1'], [/^backup_created$/, 'Fez backup'], [/^backup_exported$/, 'Baixou cópia com senha'],
  [/^user_(.+)$/, 'Contas: $1'], [/^password_changed$/, 'Trocou a própria senha'], [/^password_reset_requested$/, 'Pediu nova senha'],
  [/^dictation_session$/, 'Usou o ditado'], [/^identification_updated$/, 'Alterou a identificação'], [/^privacy_updated$/, 'Alterou dados ocultados'],
  [/^instruction_updated_(.+)$/, 'Alterou instrução: $1'], [/^plan_(.+)$/, 'Plano: $1'], [/^session_(.+)$/, 'Sessão: $1'],
];
const sectionName = (k: string) => SECTIONS.find(s => s.id === k)?.name || k;

/** Configurações > Auditoria (admin): every recorded action, filterable. Content is never recorded, only the action. */
@Component({
  selector: 'nl-audit',
  standalone: true,
  imports: [CommonModule, FormsModule, FilterSelectComponent, IconComponent],
  template: `
<section class="card">
  <div class="card-head"><h2>Auditoria</h2><small>{{total}} registro(s)</small></div>
  <div class="card-body">
    <div class="filters">
      <nl-filter-select size="sm" [options]="userOptions()" [value]="user" ariaLabel="Pessoa" (valueChange)="user=$event;reload()"></nl-filter-select>
      <input class="input" [(ngModel)]="action" placeholder="Ação (ex.: export, approved)" (keyup.enter)="reload()" aria-label="Ação">
      <input class="input" type="date" [(ngModel)]="from" (change)="reload()" aria-label="De">
      <input class="input" type="date" [(ngModel)]="to" (change)="reload()" aria-label="Até">
      <button class="btn btn-secondary btn-sm" (click)="reload()"><nl-icon name="search"/> Filtrar</button>
    </div>
    <div class="tablewrap">
      <table class="tbl">
        <thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Avaliação</th></tr></thead>
        <tbody><tr *ngFor="let r of rows">
          <td class="mono">{{when(r.created_at)}}</td><td>{{r.actor_name || '—'}}</td><td>{{label(r.action)}}</td>
          <td><button *ngIf="r.evaluation_id && r.patient_name" class="link" (click)="open.emit(r.evaluation_id)">{{r.patient_name}}</button><span *ngIf="r.evaluation_id && !r.patient_name" class="muted">excluída</span></td>
        </tr></tbody>
      </table>
      <p *ngIf="!rows.length" class="caption">Nenhum registro.</p>
    </div>
    <div class="more"><button *ngIf="rows.length < total" class="btn btn-secondary btn-sm" [disabled]="busy" (click)="more()">Carregar mais</button></div>
    <p class="caption">O registro guarda só a ação, quem fez e quando — nunca o conteúdo dos laudos.</p>
  </div>
</section>`,
  styles: [`
nl-icon{--ico-size:16px}
.filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.filters .input{max-width:200px}
.filters nl-filter-select{min-width:200px}
.tablewrap{overflow:auto}
.tbl tbody tr{cursor:default}
.more{display:flex;justify-content:center;margin:12px 0}
`],
})
export class AuditComponent implements OnInit {
  private api = inject(Api);
  @Output() open = new EventEmitter<string>();
  rows: any[] = []; users: any[] = []; total = 0; busy = false;
  user = ''; action = ''; from = ''; to = '';
  ngOnInit() { this.reload(); }
  userOptions() { return [{label: 'Todas as pessoas', value: ''}, ...this.users.map(u => ({label: u.name, value: u.id}))]; }
  label(code: string) {
    if (EXACT[code]) return EXACT[code];
    const c = /^consent_((?:no)?care)_((?:no)?ai)$/.exec(code); if (c) return `Registrou consentimento (atendimento: ${yesNo(c[1])}; IA: ${yesNo(c[2])})`;
    for (const [re, text] of ACTIONS) if (re.test(code)) return code.replace(re, text).replace(/: (\w+)$/, (_, k) => ': ' + sectionName(k)); return code; }
  when(iso: string) { const d = new Date(iso); return isNaN(+d) ? iso : `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}`; }
  private query(offset: number) { const q = new URLSearchParams({offset: String(offset), limit: '100'}); if (this.user) q.set('user', this.user); if (this.action.trim()) q.set('action', this.action.trim()); if (this.from) q.set('from', this.from); if (this.to) q.set('to', this.to); return '/audit?' + q; }
  async reload() { this.busy = true; try { const r = await this.api.req<any>('GET', this.query(0)); this.rows = r.rows; this.total = r.total; this.users = r.users; } catch {} finally { this.busy = false; } }
  async more() { this.busy = true; try { const r = await this.api.req<any>('GET', this.query(this.rows.length)); this.rows = [...this.rows, ...r.rows]; this.total = r.total; } catch {} finally { this.busy = false; } }
}
