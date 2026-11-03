import {Component, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Api} from './api.service';
import {FilterSelectComponent} from './ui/filter-select.component';
import {MODEL_OPTIONS, SECTIONS, brDate, brl, int, withCurrent} from './shared';
import {WorkTimer, duration} from './work-timer.service';

/** Settings with vertical tabs: Minha conta / IA e custos. */
@Component({
  selector: 'nl-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, FilterSelectComponent],
  template: `
<p class="crumb">Configurações</p>
<h1>Configurações</h1>
<div class="layout">
  <nav class="tabs">
    <button [class.on]="tab==='conta'" (click)="tab='conta'"><strong>Minha conta</strong><span>Senha de acesso</span></button>
    <button [class.on]="tab==='ia'" (click)="tab='ia';load()"><strong>IA e custos</strong><span>Modelo, geração e gastos</span></button>
    <button [class.on]="tab==='tempo'" (click)="tab='tempo';timer.loadStats()"><strong>Tempo</strong><span>Média por avaliação</span></button>
  </nav>

  <div class="panel" *ngIf="tab==='tempo'">
    <div class="costs">
      <section class="card card-pad"><p class="label-caps">Tempo médio de trabalho</p><p class="money">{{t()?.finished ? duration(t().avg_work_seconds) : '—'}}</p><p class="caption">por avaliação concluída ({{t()?.finished||0}})</p></section>
      <section class="card card-pad"><p class="label-caps">Do início ao fim</p><p class="money">{{t()?.finished ? duration(t().avg_calendar_seconds) : '—'}}</p><p class="caption">média entre criar e aprovar</p></section>
    </div>
    <section class="card card-pad">
      <p class="label-caps">Detalhes</p>
      <ul class="tlist">
        <li><span>Mais rápida</span><strong>{{t()?.finished ? duration(t().min_work_seconds) : '—'}}</strong></li>
        <li><span>Mais demorada</span><strong>{{t()?.finished ? duration(t().max_work_seconds) : '—'}}</strong></li>
        <li><span>Em andamento</span><strong>{{t()?.in_progress||0}} avaliação(ões) · {{duration(t()?.in_progress_seconds||0)}} até agora</strong></li>
      </ul>
      <p class="caption">O tempo de trabalho conta só enquanto a avaliação está aberta na tela. Pausa quando a aba fica escondida ou após 5 minutos sem mexer, e para quando a avaliação é aprovada. "Do início ao fim" é o tempo de calendário, da criação até a aprovação.</p>
    </section>
  </div>

  <div class="panel" *ngIf="tab==='conta'">
    <section class="card">
      <div class="card-head"><h2>Trocar senha</h2></div>
      <div class="card-body form">
        <div class="field"><label>Senha atual</label><input class="input" type="password" [(ngModel)]="pwCurrent" autocomplete="current-password"></div>
        <div class="field"><label>Nova senha <small>(mín. 10 caracteres)</small></label><input class="input" type="password" [(ngModel)]="pwNext" autocomplete="new-password">
          <div class="strength"><div [style.width.%]="strength()" [class.good]="pwNext.length>=10"></div></div>
          <span class="caption" *ngIf="pwNext.length<10">Faltam {{10-pwNext.length}} caracteres.</span>
          <span class="caption good-txt" *ngIf="pwNext.length>=10">Tamanho ok.</span>
        </div>
        <div><button class="btn btn-primary" [disabled]="!pwCurrent||pwNext.length<10||saving" (click)="changePassword()">Trocar senha</button></div>
      </div>
    </section>
  </div>

  <div class="panel" *ngIf="tab==='ia'">
    <div class="costs">
      <section class="card card-pad"><p class="label-caps">Gasto estimado neste mês</p><p class="money">{{brl(usage?.month?.cost_brl)}}</p><p class="mono caption">{{int(usage?.month?.total_tokens)}} tokens</p></section>
      <section class="card card-pad"><p class="label-caps">Total desde o início</p><p class="money">{{brl(usage?.total?.cost_brl)}}</p><p class="mono caption">{{int(usage?.total?.total_tokens)}} tokens</p></section>
    </div>
    <section class="card">
      <div class="card-head"><h2>IA (OpenAI)</h2></div>
      <div class="card-body form">
        <p class="muted small">A chave OPENAI_API_KEY fica no servidor (api/.env), nunca no navegador.</p>
        <div class="pills">
          <span class="pill" [class.ok]="configured">● Chave configurada</span>
          <span class="pill" [class.ok]="privacyGate">● Envio autorizado no servidor</span>
        </div>
        <div class="field model"><label>Modelo</label><nl-filter-select [options]="models()" [value]="model" (valueChange)="model=$event" placeholder="Escolha o modelo"></nl-filter-select></div>
        <label class="switch-row"><button type="button" class="switch" [class.on]="enabled" (click)="enabled=!enabled" role="switch" [attr.aria-checked]="enabled"><span></span></button>Habilitar geração pela API</label>
        <p class="caption">Câmbio usado: {{brl(usage?.usd_brl||5.5)}}/US$ (USD_BRL no api/.env).</p>
        <div class="row"><button class="btn btn-primary" [disabled]="saving" (click)="saveAi()">Salvar</button>
          <button class="btn btn-secondary" [disabled]="testing" (click)="testConnection()">{{testing?'Testando…':'Testar conexão'}}</button></div>
        <div *ngIf="test" class="test" [class.ok]="test.ok">
          <p class="test-title">{{test.ok ? '✓ Conexão funcionando com ' + test.model : '✕ Há um problema na conexão'}}</p>
          <ul><li *ngFor="let c of test.checks" [class.bad]="!c.ok"><span>{{c.ok?'✓':'✕'}}</span><div><strong>{{c.name}}</strong><small>{{c.detail}}</small></div></li></ul>
          <p class="caption">O teste envia só a frase "Responda apenas: ok", sem dados de paciente. O custo entra no gasto como "Teste de conexão".</p>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <h2>Detalhes dos gastos</h2>
        <div class="period"><nl-filter-select [options]="periods" [value]="period" (valueChange)="period=$event;loadDetails()"></nl-filter-select></div>
      </div>
      <div class="card-body">
        <div class="seg"><button *ngFor="let v of views" [class.on]="view===v.id" (click)="view=v.id">{{v.label}}</button></div>
        <p *ngIf="!details" class="caption">Carregando…</p>
        <ng-container *ngIf="details">
          <p *ngIf="!rows().length" class="caption empty">Nenhum gasto neste período.</p>
          <div *ngIf="rows().length" class="table-wrap">
            <table>
              <thead><tr>
                <th>{{firstColumn()}}</th>
                <th *ngIf="view==='recent'">Seção</th><th *ngIf="view==='recent'">Modelo</th>
                <th *ngIf="view!=='recent'" class="num">Chamadas</th>
                <th class="num">Entrada</th><th class="num">Saída</th><th class="num">Total tokens</th><th class="num">Custo</th>
              </tr></thead>
              <tbody>
                <tr *ngFor="let r of rows()">
                  <td>{{label(r)}}</td>
                  <td *ngIf="view==='recent'">{{sectionName(r.section_key)}}</td><td *ngIf="view==='recent'" class="mono">{{r.model}}</td>
                  <td *ngIf="view!=='recent'" class="num mono">{{r.calls}}</td>
                  <td class="num mono">{{int(r.input_tokens)}}</td><td class="num mono">{{int(r.output_tokens)}}</td>
                  <td class="num mono">{{int(+r.input_tokens + +r.output_tokens)}}</td><td class="num mono strong">{{brl(r.cost_brl)}}</td>
                </tr>
              </tbody>
              <tfoot *ngIf="view!=='recent'"><tr><td>Total do período</td><td class="num mono">{{totals().calls}}</td><td class="num mono">{{int(totals().input_tokens)}}</td><td class="num mono">{{int(totals().output_tokens)}}</td><td class="num mono">{{int(totals().input_tokens+totals().output_tokens)}}</td><td class="num mono strong">{{brl(totals().cost_brl)}}</td></tr></tfoot>
            </table>
          </div>
          <p class="caption note">Entrada = texto enviado (instruções + dados do laudo). Saída = texto escrito pela IA. Valores estimados pela tabela de preços e câmbio de {{brl(details.usd_brl)}}/US$; o valor cobrado de fato está no painel da OpenAI.</p>
        </ng-container>
      </div>
    </section>
  </div>
</div>`,
  styles: [`
.crumb{font-size:12px;color:var(--caption);margin-bottom:6px}
h1{font-size:26px;font-weight:700;margin-bottom:20px}
.layout{display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap}
.tabs{width:220px;flex:none;display:flex;flex-direction:column;gap:6px}
.tabs button{display:flex;flex-direction:column;gap:2px;padding:12px 14px;border-radius:10px;border:1px solid transparent;background:none;text-align:left;cursor:pointer;font-family:var(--font)}
.tabs button strong{font-size:14px;font-weight:600;color:var(--text)}
.tabs button span{font-size:12px;color:var(--caption)}
.tabs button.on{background:#fff;border-color:var(--border-card)}
.panel{flex:1;min-width:min(480px,100%);display:flex;flex-direction:column;gap:16px}
.form{display:flex;flex-direction:column;gap:16px;max-width:520px}
.small{font-size:13px}
.strength{height:6px;background:var(--track);border-radius:6px;overflow:hidden;margin-top:4px}
.strength div{height:100%;background:var(--warn-dot);transition:width .2s}
.strength div.good{background:var(--ok-dot)}
.good-txt{color:var(--ok-fg)}
.costs{display:grid;grid-template-columns:1fr 1fr;gap:16px}

.tlist{list-style:none;padding:0;margin:10px 0 12px;display:flex;flex-direction:column;gap:8px;font-size:13.5px}
.tlist li{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--divider);padding-bottom:8px}
.tlist span{color:var(--text-3)}
.money{font-size:24px;font-weight:700;color:var(--primary-text);margin:10px 0 2px}
.pills{display:flex;gap:8px;flex-wrap:wrap}
.pill{font-size:12.5px;padding:4px 10px;border-radius:20px;background:var(--idle-bg);color:var(--idle-fg)}
.pill.ok{background:var(--ok-bg);color:var(--ok-fg)}
.model{max-width:320px}
.row{display:flex;gap:10px;flex-wrap:wrap}
.test{border:1px solid #f0c9c2;background:#fdf3f1;border-radius:10px;padding:14px 16px}
.test.ok{border-color:var(--primary-border);background:var(--primary-soft)}
.test-title{font-weight:600;margin-bottom:8px}
.test ul{list-style:none;padding:0;margin:0 0 10px;display:flex;flex-direction:column;gap:8px}
.test li{display:flex;gap:10px;font-size:13px}
.test li>span{color:var(--primary);font-weight:700;width:14px}
.test li.bad>span{color:var(--danger)}
.test li div{display:flex;flex-direction:column}
.test li small{color:var(--text-3);font-size:12.5px}
.period{width:170px}
.seg{display:inline-flex;flex-wrap:wrap;background:var(--chip);border-radius:8px;padding:3px;margin-bottom:14px}
.seg button{border:0;background:none;padding:6px 12px;border-radius:6px;font:500 13px var(--font);color:var(--text-2);cursor:pointer}
.seg button.on{background:#fff;color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.08)}
.table-wrap{overflow:auto;border:1px solid var(--border-card);border-radius:10px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{font-size:12px;font-weight:600;color:var(--caption);text-align:left;padding:10px 12px;background:#f8faf9;border-bottom:1px solid var(--border-card);white-space:nowrap}
td{padding:9px 12px;border-bottom:1px solid var(--divider)}
tbody tr:last-child td{border-bottom:0}
tfoot td{font-weight:600;border-top:1px solid var(--border-card);border-bottom:0;background:#f8faf9}
.num{text-align:right;white-space:nowrap}
.strong{font-weight:600;color:var(--primary-text)}
.empty{padding:10px 0}
.note{margin-top:12px}
.switch-row{display:flex;align-items:center;gap:10px;font-size:14px;cursor:pointer}
.switch{width:40px;height:22px;border-radius:22px;border:0;background:var(--border-input);position:relative;cursor:pointer;padding:0;transition:background .15s}
.switch span{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s}
.switch.on{background:var(--primary)}
.switch.on span{left:21px}
@media(max-width:700px){.tabs{width:100%;flex-direction:row}.costs{grid-template-columns:1fr}}
`],
})
export class SettingsComponent {
  private api = inject(Api);
  brl = brl; int = int;
  timer = inject(WorkTimer); duration = duration;
  tab: 'conta' | 'ia' | 'tempo' = 'conta';
  t() { return this.timer.stats(); }
  pwCurrent = ''; pwNext = ''; saving = false;
  model = 'gpt-4.1'; enabled = false; configured = false; privacyGate = false; usage: any = null;
  testing = false; test: any = null;
  details: any = null; period = '30'; view: 'evaluation' | 'day' | 'section' | 'model' | 'recent' = 'evaluation';
  periods = [{label: 'Últimos 7 dias', value: '7'}, {label: 'Últimos 30 dias', value: '30'}, {label: 'Últimos 90 dias', value: '90'}, {label: 'Último ano', value: '365'}];
  views: {id: SettingsComponent['view']; label: string}[] = [{id: 'evaluation', label: 'Por avaliação'}, {id: 'day', label: 'Por dia'}, {id: 'section', label: 'Por seção'}, {id: 'model', label: 'Por modelo'}, {id: 'recent', label: 'Últimas chamadas'}];

  rows(): any[] { const d = this.details; if (!d) return []; return ({evaluation: d.byEvaluation, day: d.byDay, section: d.bySection, model: d.byModel, recent: d.recent} as any)[this.view] || []; }
  totals() { return this.rows().reduce((t, r) => ({calls: t.calls + Number(r.calls || 0), input_tokens: t.input_tokens + Number(r.input_tokens), output_tokens: t.output_tokens + Number(r.output_tokens), cost_brl: t.cost_brl + Number(r.cost_brl)}), {calls: 0, input_tokens: 0, output_tokens: 0, cost_brl: 0}); }
  firstColumn() { return ({evaluation: 'Avaliação', day: 'Dia', section: 'Seção', model: 'Modelo', recent: 'Quando / paciente'} as any)[this.view]; }
  sectionName(k: string) { return k === 'teste_conexao' ? 'Teste de conexão' : SECTIONS.find(s => s.id === k)?.name || k || '—'; }
  label(r: any) {
    if (this.view === 'evaluation') return r.patient_name || (r.evaluation_id ? 'Avaliação excluída' : 'Teste de conexão');
    if (this.view === 'day') return brDate(r.day);
    if (this.view === 'section') return this.sectionName(r.section_key);
    if (this.view === 'model') return r.model;
    const when = new Date(r.created_at); return `${when.toLocaleDateString('pt-BR')} ${when.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})} · ${r.patient_name || (r.section_key === 'teste_conexao' ? 'teste' : 'excluída')}`;
  }
  async loadDetails() { try { this.details = await this.api.req('GET', `/ai/usage/details?days=${this.period}`); } catch {} }
  async testConnection() {
    this.testing = true; this.test = null;
    try { this.test = await this.api.req('POST', '/ai/test', {model: this.model}); await this.load(); } catch {} finally { this.testing = false; }
  }

  constructor() { this.load(); }
  strength() { return Math.min(100, this.pwNext.length * 10); }
  models() { return withCurrent(MODEL_OPTIONS, this.model); }
  async load() {
    try {
      const s = await this.api.req('GET', '/ai/settings');
      this.model = s.model; this.enabled = s.enabled; this.configured = s.configured; this.privacyGate = s.privacy_gate;
      this.usage = await this.api.req('GET', '/ai/usage');
      this.loadDetails();
    } catch {}
  }
  async saveAi() {
    this.saving = true;
    try { await this.api.req('PUT', '/ai/settings', {model: this.model, enabled: this.enabled}); this.api.notify('Configuração salva.'); await this.load(); }
    catch {} finally { this.saving = false; }
  }
  async changePassword() {
    this.saving = true;
    try { await this.api.req('PUT', '/me/password', {current: this.pwCurrent, next: this.pwNext}); this.pwCurrent = ''; this.pwNext = ''; this.api.notify('Senha alterada.'); }
    catch {} finally { this.saving = false; }
  }
}
