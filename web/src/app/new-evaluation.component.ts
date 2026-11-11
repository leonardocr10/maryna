import {Component, EventEmitter, Output, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {Api} from './api.service';
import {ConfirmService} from './confirm.service';
import {AI_MODE_CONFIRM} from './shared';
import {DropZoneComponent} from './ui/drop-zone.component';
import {Identity, IdentityFormComponent, emptyIdentity, identityMissing} from './ui/identity-form.component';
import {IconComponent} from './ui/icon.component';
import {FilterSelectComponent} from './ui/filter-select.component';

interface Step {key: 'eval' | 'base' | 'anamnesis' | 'open'; label: string; state: 'wait' | 'now' | 'ok' | 'err'; pct?: number}

/** Full-screen "Nova avaliação": identification + optional files + checklist. */
@Component({
  selector: 'nl-new-evaluation',
  standalone: true,
  imports: [CommonModule, DropZoneComponent, IdentityFormComponent, IconComponent, FilterSelectComponent],
  template: `
<div class="pagehead nh">
  <button type="button" class="back" (click)="closed.emit()" title="Voltar às avaliações" aria-label="Voltar às avaliações"><nl-icon name="chevl"/></button>
  <span class="hicon"><nl-icon name="plus"/></span>
  <div><h1>Nova avaliação</h1><p>Campos com * são obrigatórios. As datas da avaliação em branco usam as do arquivo base.</p></div>
</div>

<div class="layout">
  <div class="form">
    <section class="card">
      <div class="sec-title"><span class="num">1</span><h2>Identificação do paciente</h2></div>
      <nl-identity-form [model]="id" (modelChange)="id=$event" [autofocus]="true" [showRequired]="id.name.trim().length >= 2"></nl-identity-form>
    </section>

    <div class="pair">
    <section class="card">
      <div class="sec-title"><span class="num">2</span><h2>Modelo e arquivos</h2><span class="caption">Arquivos obrigatórios · pode enviar agora ou depois</span></div>
      <div class="model" title="O arquivo da estagiária é comparado com o modelo, e as instruções da IA do modelo valem nesta avaliação.">
        <span class="mlabel">Modelo do laudo{{hasModels() ? ' *' : ''}}</span>
        <nl-filter-select [class.need]="hasModels() && !modelId" [options]="models" [value]="modelId" ariaLabel="Modelo do laudo" placeholder="Escolha o modelo" (valueChange)="modelId=$event"></nl-filter-select>
        <small *ngIf="hasModels() && !modelId" class="need-hint">Obrigatório: escolha o modelo do laudo.</small>
        <small *ngIf="modelsLoaded && !hasModels()" class="caption">Nenhum modelo cadastrado. Cadastre em Modelos de laudo.</small>
      </div>
      <div class="files">
        <nl-drop-zone [inline]="true" [required]="true" title="Arquivo base (estagiária)" [filename]="base?.name||''" (file)="pick('base',$event)"></nl-drop-zone>
        <nl-drop-zone [inline]="true" [required]="true" title="Anamnese (psicóloga)" [filename]="anamnesis?.name||''" (file)="pick('anamnesis',$event)"></nl-drop-zone>
      </div>
    </section>

    <section class="card mode">
      <div class="sec-title"><span class="num">3</span><h2>Como a avaliação será escrita</h2></div>
      <div class="modes" role="radiogroup" aria-label="Modo da avaliação">
        <button type="button" role="radio" class="opt" [class.on]="aiMode==='manual'" [attr.aria-checked]="aiMode==='manual'" (click)="aiMode='manual'"><nl-icon name="edit"/><span><b>Manual</b><small>Nada é enviado à IA. O sistema só lê os arquivos e você escreve cada seção.</small></span></button>
        <button type="button" role="radio" class="opt" [class.on]="aiMode==='ai'" [attr.aria-checked]="aiMode==='ai'" (click)="chooseAi()"><nl-icon name="spark"/><span><b>Com IA</b><small>A IA redige rascunhos das seções a partir dos arquivos; você revisa e aprova.</small></span></button>
      </div>
    </section>
    </div>

    <div class="actions">
      <button class="btn btn-secondary" (click)="closed.emit()" [disabled]="busy">Cancelar</button>
      <span class="spacer"></span>
      <button class="btn btn-secondary" [disabled]="!valid()||busy" [title]="missingText()" (click)="create(false)">Salvar como rascunho</button>
      <button class="btn btn-primary" [disabled]="!valid()||busy" [title]="missingText()" (click)="create(willGenerate())">{{busy?'Criando…':willGenerate()?'Criar e gerar com IA':'Criar avaliação'}} <nl-icon name="chevr"/></button>
    </div>
  </div>

  <aside class="aside">
    <section class="card card-pad">
      <p class="label-caps">Antes de criar</p>
      <ul class="check">
        <li [class.ok]="valid()"><span class="bx"><nl-icon name="check"/></span>Identificação<small>nome, nascimento, sexo e escolaridade</small></li>
        <li [class.ok]="base"><span class="bx"><nl-icon name="check"/></span>Arquivo base</li>
        <li [class.ok]="anamnesis"><span class="bx"><nl-icon name="check"/></span>Anamnese</li>
        <li [class.ok]="modelId"><span class="bx"><nl-icon name="check"/></span>Modelo do laudo<small>{{hasModels() ? 'obrigatório' : 'nenhum cadastrado'}}</small></li>
      </ul>
    </section>
    <section class="card card-pad">
      <p class="label-caps">Depois</p>
      <ul class="flow">
        <li><span class="fi tone-review"><nl-icon name="spark"/></span>A IA gera um rascunho por seção</li>
        <li><span class="fi tone-warn"><nl-icon name="edit"/></span>Você revisa, edita e aprova</li>
        <li><span class="fi tone-ok"><nl-icon name="download"/></span>Baixa o Word com tudo aprovado</li>
      </ul>
      <p class="after">O arquivo base original nunca é alterado.</p>
    </section>
    <div class="privacy"><nl-icon name="shield"/><span>Dados de saúde são sensíveis. Nomes e dados pessoais são ocultados antes de qualquer envio à IA, e a geração só acontece quando autorizada nas Configurações.</span></div>
  </aside>
</div>
<div *ngIf="busy" class="modal-bg">
  <div class="modal mk" role="dialog" aria-modal="true" aria-labelledby="mk-title" aria-describedby="mk-hint">
    <div class="mk-ico" aria-hidden="true"><span class="spin"></span></div>
    <h2 id="mk-title">Criando avaliação</h2>
    <p id="mk-hint" class="muted">Não feche esta página. Arquivos grandes podem levar alguns segundos.</p>
    <ol class="mk-steps" aria-live="polite">
      <li *ngFor="let s of steps" [class]="s.state">
        <span class="mk-dot" aria-hidden="true"><nl-icon *ngIf="s.state==='ok'" name="check"/><span *ngIf="s.state==='now'" class="spin sm"></span></span>
        <span class="grow">{{stepText(s)}}<i *ngIf="s.state==='now' && s.pct != null && s.pct < 100" class="mk-bar"><b [style.width.%]="s.pct"></b></i></span>
      </li>
    </ol>
  </div>
</div>`,
  styles: [`.need-hint{display:block;margin-top:4px;font-size:12px;color:var(--danger,#c0392b)}
:host ::ng-deep nl-filter-select.need button{border-color:var(--danger,#c0392b)}

nl-icon{--ico-size:16px}
.mk{width:min(420px,100%)}
.mk-ico{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;margin-bottom:14px;background:var(--primary-soft)}
.mk .muted{font-size:13px;color:var(--text-3);margin-bottom:16px}
.mk-steps{list-style:none;margin:0;padding:0;display:grid;gap:10px;font-size:14px}
.mk-steps li{display:flex;align-items:flex-start;gap:10px;color:var(--text-3)}
.mk-steps li.now{color:var(--text);font-weight:500}
.mk-steps li.ok{color:var(--text)}
.mk-steps li.err{color:var(--danger)}
.mk-steps .grow{flex:1;min-width:0}
.mk-dot{flex:none;width:20px;height:20px;border-radius:50%;display:grid;place-items:center;border:1.5px solid var(--border-card);--ico-size:12px}
.mk-steps li.ok .mk-dot{background:var(--primary);border-color:var(--primary);color:#fff}
.mk-steps li.now .mk-dot{border-color:transparent}
.mk-steps li.err .mk-dot{border-color:var(--danger)}
.mk-bar{display:block;height:4px;margin-top:6px;border-radius:2px;background:var(--chip);overflow:hidden}
.mk-bar b{display:block;height:100%;background:var(--primary);transition:width .2s}
.spin{width:22px;height:22px;border-radius:50%;border:2.5px solid var(--primary-soft);border-top-color:var(--primary);animation:mkSpin .8s linear infinite}
.spin.sm{width:16px;height:16px;border-width:2px}
@keyframes mkSpin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.spin{animation-duration:2s}}
.layout{display:grid;grid-template-columns:minmax(0,1fr) clamp(280px,calc(24vw / var(--zoom, 1)),360px);gap:16px;align-items:start}
.form{min-width:0;display:flex;flex-direction:column;gap:16px}
.form>.card{padding:22px 24px}
.aside{display:flex;flex-direction:column;gap:16px}
.sec-title{display:flex;align-items:center;gap:10px;margin-bottom:18px;flex-wrap:wrap}
.sec-title h2{font-size:17px;font-weight:600}
.num{width:28px;height:28px;border-radius:50%;background:var(--primary);color:var(--on-primary);font:600 13px var(--font);display:inline-flex;align-items:center;justify-content:center}
.files{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.spacer{flex:1}
.check{list-style:none;padding:0;margin:12px 0 0;display:flex;flex-direction:column;gap:10px;font-size:13.5px;color:var(--text-3)}
.check li{display:flex;gap:10px;align-items:center}
.check li .bx{width:20px;height:20px;border-radius:50%;border:1.5px solid var(--idle-dot);display:grid;place-items:center;flex:none;color:transparent;--ico-size:12px}
.check li small{margin-left:auto;font-size:12px;color:var(--text-3)}
.check li.ok{color:var(--text)}.check li.ok .bx{background:var(--ok-dot);border-color:var(--ok-dot);color:#fff}
.flow{list-style:none;margin:14px 0 0;padding:0;display:flex;flex-direction:column;gap:10px}
.flow li{display:flex;gap:10px;align-items:center;font-size:13px;color:var(--text-2)}
.flow .fi{width:28px;height:28px;border-radius:var(--radius-sm);display:grid;place-items:center;flex:none;--ico-size:15px}
.privacy{display:flex;gap:10px;padding:14px 16px;border-radius:var(--radius-lg);background:var(--primary-soft);border:1px solid var(--primary-border);font-size:12.5px;color:var(--text-2);line-height:1.5}
.privacy nl-icon{color:var(--primary);--ico-size:18px;margin-top:1px}
.after{font-size:13px;color:var(--text-3);margin-top:10px;line-height:1.55}
@media(max-width:1100px){.layout{grid-template-columns:minmax(0,1fr)}}
.model{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
.model .mlabel{font-size:13px;font-weight:600;color:var(--text)}
.model small{font-size:12.5px;color:var(--text-3)}
.form>.mode{padding:22px 24px}
/* compact: the whole form fits on one screen */
.nh{margin-bottom:10px;gap:10px}
.nh .back{width:32px;height:32px;border:1px solid var(--border-card);border-radius:8px;background:var(--card);display:grid;place-items:center;cursor:pointer;color:var(--text-2);flex:none}
.nh .back:hover{border-color:var(--primary);color:var(--text)}
.nh .hicon{width:36px;height:36px;border-radius:10px;--ico-size:20px}
.nh h1{font-size:22px;line-height:28px}
.nh p{margin-top:0;font-size:13px;color:var(--text-3)}
.layout{gap:12px}
.form{gap:10px}
.form>.card,.form>.mode{padding:14px 16px}
.aside{gap:10px}
.aside .card-pad{padding:12px 14px}
.sec-title{margin-bottom:10px;gap:8px}
.sec-title h2{font-size:15px}
.num{width:24px;height:24px;font-size:12px}
:host ::ng-deep nl-identity-form{gap:10px}
:host ::ng-deep nl-identity-form .grid{gap:10px}
:host ::ng-deep nl-identity-form .field label{margin-bottom:4px}
.pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;align-items:stretch}
.pair>.card{padding:14px 16px;min-width:0}
.files{grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}
.model{margin-bottom:10px;gap:4px}
.pair .modes{grid-template-columns:minmax(0,1fr)}
:host ::ng-deep .dz.inline{padding:9px 12px;gap:10px}
:host ::ng-deep .dz.inline .icon{width:30px;height:30px}
.modes{gap:10px}
.opt{padding:9px 12px;gap:10px}
.opt small{font-size:12px}
.check{margin-top:8px;gap:7px;font-size:13px}
.flow{margin-top:8px;gap:7px}
.flow .fi{width:24px;height:24px;--ico-size:13px}
.after{margin-top:8px;font-size:12px}
.privacy{padding:10px 12px;font-size:12px}
@media(max-width:1000px){.pair{grid-template-columns:minmax(0,1fr)}}
@media(max-width:560px){.files{grid-template-columns:minmax(0,1fr)}}
.modes{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.opt{display:flex;gap:12px;align-items:flex-start;text-align:left;padding:14px 16px;border-radius:var(--radius-lg);border:1.5px solid var(--border-card);background:var(--card);color:var(--text);cursor:pointer;font:inherit}
.opt nl-icon{color:var(--text-3);--ico-size:18px;margin-top:2px}
.opt span{display:flex;flex-direction:column;gap:3px}
.opt b{font-size:14px}.opt small{font-size:12.5px;color:var(--text-3);line-height:1.45}
.opt.on{border-color:var(--primary);background:var(--primary-soft)}.opt.on nl-icon{color:var(--primary)}
.opt:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
`],
})
export class NewEvaluationComponent {
  private api = inject(Api);
  private confirm = inject(ConfirmService);
  /** Choosing AI asks first: every generated section consumes API credits. */
  async chooseAi() { if (this.aiMode === 'ai') return; if (await this.confirm.ask(AI_MODE_CONFIRM)) this.aiMode = 'ai'; }
  /** Only the psychologist (and admin) can start AI generation. */
  canGenerate() { const r = this.api.me()?.role; return r === 'admin' || r === 'psychologist'; }
  // Not named 'cancel': the native file-dialog 'cancel' event bubbles and would trigger it.
  @Output() closed = new EventEmitter<void>();
  @Output() created = new EventEmitter<{id: string; generate: boolean}>();
  id: Identity = emptyIdentity();
  base: File | null = null;
  anamnesis: File | null = null;
  busy = false;
  models: {value: string; label: string}[] = []; modelsLoaded = false;
  hasModels() { return this.models.length > 0; }
  modelId = '';
  /** 'ai': drafts by the AI; 'manual': the AI is never called for this evaluation. */
  aiMode: 'ai' | 'manual' = 'manual';
  async ngOnInit() {
    try { const list: any[] = await this.api.req('GET', '/models'); this.models = list.filter(m => m.active).map(m => ({value: m.id, label: m.name})); if (this.models.length === 1) this.modelId = this.models[0].value; } catch {}
    this.modelsLoaded = true;
  }
  willGenerate() { return this.aiMode === 'ai' && this.bothFiles() && this.canGenerate(); }

  valid() { return !identityMissing(this.id).length && (!this.hasModels() || !!this.modelId); }
  missingText() { const m = [...identityMissing(this.id), ...(this.hasModels() && !this.modelId ? ['modelo do laudo'] : [])]; return m.length ? 'Falta preencher: ' + m.join(', ') : ''; }
  bothFiles() { return !!(this.base && this.anamnesis); }
  pick(kind: 'base' | 'anamnesis', f: File) {
    if (!f.name.toLowerCase().endsWith('.docx')) { this.api.notify('Envie um arquivo .docx (Word).'); return; }
    this[kind] = f;
  }

  /** Steps shown in the "Criando avaliação" dialog while the evaluation is created and the files go up. */
  steps: Step[] = [];
  private step(key: Step['key'], patch: Partial<Step>) { const s = this.steps.find(x => x.key === key); if (s) Object.assign(s, patch); }

  async create(generate: boolean) {
    if (!this.valid() || this.busy) return;
    this.busy = true;
    const files = (['base', 'anamnesis'] as const).filter(k => this[k]);
    this.steps = [
      {key: 'eval', label: 'Cadastrando paciente e avaliação', state: 'now'},
      ...files.map(k => ({key: k, label: k === 'base' ? 'Arquivo base' : 'Anamnese', state: 'wait' as const})),
      {key: 'open', label: generate ? 'Abrindo a avaliação e iniciando a IA' : 'Abrindo a avaliação', state: 'wait'},
    ];
    try {
      const v = this.id;
      const p = await this.api.req('POST', '/patients', {name: v.name.trim(), birth_date: v.birth_date || null});
      const e = await this.api.req('POST', '/evaluations', {patient_id: p.id, ...v, model_id: this.modelId || null, ai_mode: this.aiMode});
      this.step('eval', {state: 'ok'});
      // Both files go up at the same time; each one is read on the server as it arrives.
      const sent = await Promise.all(files.map(async kind => {
        this.step(kind, {state: 'now', pct: 0});
        try {
          await this.api.upload(e.id, kind, this[kind]!, pct => this.step(kind, {pct}));
          this.step(kind, {state: 'ok'}); return true;
        } catch { this.step(kind, {state: 'err'}); return false; }
      }));
      if (sent.includes(false)) generate = false;
      this.step('open', {state: 'now'});
      this.api.notify(generate ? 'Avaliação criada. Gerando textos…' : 'Avaliação criada.');
      // The dialog stays until the evaluation screen replaces this one.
      this.created.emit({id: e.id, generate});
    } catch { this.busy = false; }
  }
  stepText(s: Step) {
    if (s.key !== 'base' && s.key !== 'anamnesis') return s.label;
    if (s.state === 'ok') return s.label + ': enviado e lido';
    if (s.state === 'err') return s.label + ': não foi enviado';
    if (s.state === 'wait') return s.label + ': aguardando';
    return s.pct != null && s.pct < 100 ? `${s.label}: enviando ${s.pct}%` : s.label + ': lendo o arquivo';
  }
}
