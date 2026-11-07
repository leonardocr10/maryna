import {Component, EventEmitter, Output, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {Api} from './api.service';
import {DropZoneComponent} from './ui/drop-zone.component';
import {Identity, IdentityFormComponent, emptyIdentity} from './ui/identity-form.component';
import {IconComponent} from './ui/icon.component';
import {FilterSelectComponent} from './ui/filter-select.component';

/** Full-screen "Nova avaliação": identification + optional files + checklist. */
@Component({
  selector: 'nl-new-evaluation',
  standalone: true,
  imports: [CommonModule, DropZoneComponent, IdentityFormComponent, IconComponent, FilterSelectComponent],
  template: `
<p class="crumbs"><button type="button" (click)="closed.emit()">Avaliações</button><nl-icon name="chevr"/><b>Nova avaliação</b></p>
<div class="pagehead"><span class="hicon"><nl-icon name="plus"/></span><div><h1>Nova avaliação</h1><p>Só o nome é obrigatório. Campos em branco usam o que estiver no arquivo base.</p></div></div>

<div class="layout">
  <div class="form">
    <section class="card">
      <div class="sec-title"><span class="num">1</span><h2>Identificação do paciente</h2></div>
      <nl-identity-form [model]="id" (modelChange)="id=$event" [big]="true" [autofocus]="true"></nl-identity-form>
    </section>

    <section class="card">
      <div class="sec-title"><span class="num">2</span><h2>Modelo e arquivos</h2><span class="caption">Opcional agora, dá para enviar depois</span></div>
      <div class="model">
        <span class="mlabel">Modelo do laudo</span>
        <nl-filter-select [options]="models" [value]="modelId" ariaLabel="Modelo do laudo" placeholder="Sem modelo" (valueChange)="modelId=$event"></nl-filter-select>
        <small>O arquivo da estagiária é comparado com o modelo, e as instruções da IA do modelo valem nesta avaliação.</small>
      </div>
      <div class="files">
        <nl-drop-zone [inline]="true" title="Arquivo base (estagiária)" [filename]="base?.name||''" (file)="pick('base',$event)"></nl-drop-zone>
        <nl-drop-zone [inline]="true" title="Anamnese (psicóloga)" [filename]="anamnesis?.name||''" (file)="pick('anamnesis',$event)"></nl-drop-zone>
      </div>
    </section>

    <section *ngIf="bothFiles() && canGenerate() && consentRequired" class="card consent">
      <label class="chk"><input type="checkbox" [checked]="consentAi" (change)="consentAi=$any($event.target).checked">
        <span><b>Consentimento para uso de IA registrado</b><small>O responsável ou a pessoa avaliada assinou o termo. Os textos vão à OpenAI com nomes trocados por marcadores.</small></span></label>
      <p *ngIf="!consentAi" class="caption warn-txt"><nl-icon name="alert"/> Sem o consentimento, a avaliação é criada sem gerar textos com IA.</p>
    </section>

    <div class="actions">
      <button class="btn btn-secondary" (click)="closed.emit()" [disabled]="busy">Cancelar</button>
      <span class="spacer"></span>
      <button class="btn btn-secondary" [disabled]="!valid()||busy" (click)="create(false)">Salvar como rascunho</button>
      <button class="btn btn-primary" [disabled]="!valid()||busy" (click)="create(willGenerate())">{{busy?'Criando…':willGenerate()?'Criar e gerar com IA':'Criar avaliação'}} <nl-icon name="chevr"/></button>
    </div>
  </div>

  <aside class="aside">
    <section class="card card-pad">
      <p class="label-caps">Antes de criar</p>
      <ul class="check">
        <li [class.ok]="valid()"><span class="bx"><nl-icon name="check"/></span>Nome do paciente<small>obrigatório</small></li>
        <li [class.ok]="base"><span class="bx"><nl-icon name="check"/></span>Arquivo base</li>
        <li [class.ok]="anamnesis"><span class="bx"><nl-icon name="check"/></span>Anamnese</li>
        <li [class.ok]="modelId"><span class="bx"><nl-icon name="check"/></span>Modelo do laudo<small>opcional</small></li>
      </ul>
    </section>
    <section class="card card-pad">
      <p class="label-caps">Depois</p>
      <p class="after">Com os dois arquivos, a IA redige as seções. Você revisa e aprova cada uma e baixa o Word. O arquivo base original nunca é alterado.</p>
      <ul class="flow">
        <li><span class="fi tone-review"><nl-icon name="spark"/></span>A IA gera um rascunho por seção</li>
        <li><span class="fi tone-warn"><nl-icon name="edit"/></span>Você revisa, edita e aprova</li>
        <li><span class="fi tone-ok"><nl-icon name="download"/></span>Baixa o Word com tudo aprovado</li>
      </ul>
    </section>
    <div class="privacy"><nl-icon name="shield"/><span>Dados de saúde são sensíveis. Nomes e dados pessoais são ocultados antes de qualquer envio à IA, e a geração só acontece quando autorizada nas Configurações.</span></div>
  </aside>
</div>`,
  styles: [`
nl-icon{--ico-size:16px}
.layout{display:grid;grid-template-columns:minmax(0,1fr) clamp(280px,24vw,360px);gap:16px;align-items:start}
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
.form>.consent{padding:16px 24px}
.consent .chk{display:flex;gap:10px;align-items:flex-start;cursor:pointer}
.consent .chk input{margin-top:3px}
.consent .chk span{display:flex;flex-direction:column;gap:2px;font-size:13.5px}
.consent .chk small{font-size:12.5px;color:var(--text-3)}
.consent .caption{margin-top:10px;display:flex;gap:6px;align-items:center;font-size:12.5px}
`],
})
export class NewEvaluationComponent {
  private api = inject(Api);
  /** Only the psychologist (and admin) can start AI generation. */
  canGenerate() { const r = this.api.me()?.role; return r === 'admin' || r === 'psychologist'; }
  // Not named 'cancel': the native file-dialog 'cancel' event bubbles and would trigger it.
  @Output() closed = new EventEmitter<void>();
  @Output() created = new EventEmitter<{id: string; generate: boolean}>();
  id: Identity = emptyIdentity();
  base: File | null = null;
  anamnesis: File | null = null;
  busy = false;
  models: {value: string; label: string}[] = [{value: '', label: 'Sem modelo'}];
  modelId = '';
  /** The server blocks AI generation until the evaluation has the AI-use consent (REQUIRE_AI_CONSENT). */
  consentRequired = false;
  consentAi = false;
  async ngOnInit() {
    try { const list: any[] = await this.api.req('GET', '/models'); this.models = [{value: '', label: 'Sem modelo'}, ...list.filter(m => m.active).map(m => ({value: m.id, label: m.name}))]; } catch {}
    try { const s = await this.api.req('GET', '/ai/settings'); this.consentRequired = s?.consent_required === true; } catch {}
  }
  willGenerate() { return this.bothFiles() && this.canGenerate() && (!this.consentRequired || this.consentAi); }

  valid() { return this.id.name.trim().length >= 2; }
  bothFiles() { return !!(this.base && this.anamnesis); }
  pick(kind: 'base' | 'anamnesis', f: File) {
    if (!f.name.toLowerCase().endsWith('.docx')) { this.api.notify('Envie um arquivo .docx (Word).'); return; }
    this[kind] = f;
  }

  async create(generate: boolean) {
    if (!this.valid() || this.busy) return;
    this.busy = true;
    try {
      const v = this.id;
      const p = await this.api.req('POST', '/patients', {name: v.name.trim(), birth_date: v.birth_date || null});
      const e = await this.api.req('POST', '/evaluations', {patient_id: p.id, ...v, model_id: this.modelId || null});
      // Consent first: without it every generation request is refused (409).
      if (generate && this.consentRequired) { try { await this.api.req('PUT', `/evaluations/${e.id}/consent`, {care: false, ai: true}); } catch { generate = false; } }
      for (const kind of ['base', 'anamnesis'] as const) {
        const f = this[kind];
        if (f) { try { await this.api.upload(e.id, kind, f); } catch { generate = false; } }
      }
      this.api.notify(generate ? 'Avaliação criada. Gerando textos…' : 'Avaliação criada.');
      this.created.emit({id: e.id, generate});
    } catch {} finally { this.busy = false; }
  }
}
