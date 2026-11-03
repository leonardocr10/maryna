import {Component, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Api} from './api.service';
import {FilterSelectComponent} from './ui/filter-select.component';
import {MODEL_OPTIONS, brl, int, withCurrent} from './shared';

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
  </nav>

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
        <div><button class="btn btn-primary" [disabled]="saving" (click)="saveAi()">Salvar</button></div>
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
.money{font-size:24px;font-weight:700;color:var(--primary-text);margin:10px 0 2px}
.pills{display:flex;gap:8px;flex-wrap:wrap}
.pill{font-size:12.5px;padding:4px 10px;border-radius:20px;background:var(--idle-bg);color:var(--idle-fg)}
.pill.ok{background:var(--ok-bg);color:var(--ok-fg)}
.model{max-width:320px}
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
  tab: 'conta' | 'ia' = 'conta';
  pwCurrent = ''; pwNext = ''; saving = false;
  model = 'gpt-4.1'; enabled = false; configured = false; privacyGate = false; usage: any = null;

  constructor() { this.load(); }
  strength() { return Math.min(100, this.pwNext.length * 10); }
  models() { return withCurrent(MODEL_OPTIONS, this.model); }
  async load() {
    try {
      const s = await this.api.req('GET', '/ai/settings');
      this.model = s.model; this.enabled = s.enabled; this.configured = s.configured; this.privacyGate = s.privacy_gate;
      this.usage = await this.api.req('GET', '/ai/usage');
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
