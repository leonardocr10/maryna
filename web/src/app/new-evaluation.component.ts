import {Component, EventEmitter, Output, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {Api} from './api.service';
import {DropZoneComponent} from './ui/drop-zone.component';
import {Identity, IdentityFormComponent, emptyIdentity} from './ui/identity-form.component';

/** Full-screen "Nova avaliação": identification + optional files + checklist. */
@Component({
  selector: 'nl-new-evaluation',
  standalone: true,
  imports: [CommonModule, DropZoneComponent, IdentityFormComponent],
  template: `
<p class="crumb">Avaliações / Nova avaliação</p>
<h1>Nova avaliação</h1>
<p class="sub">Só o nome é obrigatório. Campos em branco usam o que estiver no arquivo base.</p>

<div class="layout">
  <div class="form">
    <section class="card">
      <div class="sec-title"><span class="num">1</span><h2>Identificação do paciente</h2></div>
      <nl-identity-form [model]="id" (modelChange)="id=$event" [big]="true" [autofocus]="true"></nl-identity-form>
    </section>

    <section class="card">
      <div class="sec-title"><span class="num">2</span><h2>Arquivos</h2><span class="caption">Opcional agora, dá para enviar depois</span></div>
      <div class="files">
        <nl-drop-zone [inline]="true" title="Arquivo base (estagiária)" [filename]="base?.name||''" (file)="pick('base',$event)"></nl-drop-zone>
        <nl-drop-zone [inline]="true" title="Anamnese (psicóloga)" [filename]="anamnesis?.name||''" (file)="pick('anamnesis',$event)"></nl-drop-zone>
      </div>
    </section>

    <div class="actions">
      <button class="btn btn-secondary" (click)="closed.emit()" [disabled]="busy">Cancelar</button>
      <span class="spacer"></span>
      <button class="btn btn-secondary" [disabled]="!valid()||busy" (click)="create(false)">Salvar como rascunho</button>
      <button class="btn btn-primary" [disabled]="!valid()||busy" (click)="create(bothFiles())">{{busy?'Criando…':bothFiles()?'Criar e gerar com IA →':'Criar avaliação →'}}</button>
    </div>
  </div>

  <aside class="aside">
    <section class="card card-pad">
      <p class="label-caps">Antes de criar</p>
      <ul class="check">
        <li [class.ok]="valid()"><span>{{valid()?'✓':'○'}}</span>Nome do paciente</li>
        <li [class.ok]="base"><span>{{base?'✓':'○'}}</span>Arquivo base</li>
        <li [class.ok]="anamnesis"><span>{{anamnesis?'✓':'○'}}</span>Anamnese</li>
      </ul>
    </section>
    <section class="card card-pad">
      <p class="label-caps">Depois</p>
      <p class="after">Com os dois arquivos, a IA redige as 11 seções. Você revisa e aprova cada uma e baixa o Word. O arquivo base original nunca é alterado.</p>
    </section>
  </aside>
</div>`,
  styles: [`
.crumb{font-size:12px;color:var(--caption);margin-bottom:6px}
h1{font-size:26px;font-weight:700}
.sub{font-size:13.5px;color:var(--text-3);margin:6px 0 20px}
.layout{display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap}
.form{flex:1;min-width:min(560px,100%);display:flex;flex-direction:column;gap:16px}
.form>.card{padding:22px 24px}
.aside{width:300px;flex:none;display:flex;flex-direction:column;gap:16px}
.sec-title{display:flex;align-items:center;gap:10px;margin-bottom:18px;flex-wrap:wrap}
.sec-title h2{font-size:17px;font-weight:600}
.num{width:24px;height:24px;border-radius:50%;background:var(--primary);color:#fff;font:700 12px var(--mono);display:inline-flex;align-items:center;justify-content:center}
.files{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.spacer{flex:1}
.check{list-style:none;padding:0;margin:12px 0 0;display:flex;flex-direction:column;gap:10px;font-size:13.5px;color:var(--text-3)}
.check li{display:flex;gap:10px;align-items:center}
.check li span{width:18px;color:var(--placeholder);font-weight:700}
.check li.ok{color:var(--text)}.check li.ok span{color:var(--primary)}
.after{font-size:13px;color:var(--text-3);margin-top:10px;line-height:1.55}
@media(max-width:900px){.aside{width:100%}}
`],
})
export class NewEvaluationComponent {
  private api = inject(Api);
  // Not named 'cancel': the native file-dialog 'cancel' event bubbles and would trigger it.
  @Output() closed = new EventEmitter<void>();
  @Output() created = new EventEmitter<{id: string; generate: boolean}>();
  id: Identity = emptyIdentity();
  base: File | null = null;
  anamnesis: File | null = null;
  busy = false;

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
      const e = await this.api.req('POST', '/evaluations', {patient_id: p.id, ...v});
      for (const kind of ['base', 'anamnesis'] as const) {
        const f = this[kind];
        if (f) { try { await this.api.upload(e.id, kind, f); } catch { generate = false; } }
      }
      this.api.notify(generate ? 'Avaliação criada. Gerando textos…' : 'Avaliação criada.');
      this.created.emit({id: e.id, generate});
    } catch {} finally { this.busy = false; }
  }
}
