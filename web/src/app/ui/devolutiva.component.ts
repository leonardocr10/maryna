import {Component, Input, OnChanges, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Api} from '../api.service';
import {ConfirmService} from '../confirm.service';
import {words} from '../shared';
import {DictateComponent} from './dictate.component';
import {FilterSelectComponent} from './filter-select.component';
import {IconComponent} from './icon.component';

type Audience = 'familia' | 'paciente';
const AUDIENCES = [{label: 'Família / responsáveis', value: 'familia'}, {label: 'A própria pessoa (adulta)', value: 'paciente'}];

/** Devolutiva: a plain-language letter written from the approved report. AI draft -> psychologist edits and approves ->
 *  separate Word file. It never goes into the report document. */
@Component({
  selector: 'nl-devolutiva',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, FilterSelectComponent, DictateComponent],
  template: `
<section class="card dv">
  <div class="dv-head">
    <span class="ei"><nl-icon name="users"/></span>
    <div><h2>Devolutiva para {{audience==='paciente' ? 'a pessoa avaliada' : 'a família'}}</h2>
      <small>Texto em linguagem simples, feito a partir do laudo aprovado. Documento separado do laudo.</small></div>
    <span class="grow"></span>
    <span *ngIf="d" [class]="'badge ' + (d.status==='approved' ? 'ok' : 'warn')">{{d.status==='approved' ? 'Aprovada' : 'Rascunho'}}</span>
  </div>

  <p *ngIf="!loaded" class="caption">Carregando…</p>

  <!-- Nothing yet: choose the reader, optional guidance, generate or write by hand -->
  <div *ngIf="loaded && !d && !editing" class="start">
    <div class="field aud"><label>Para quem</label><nl-filter-select [options]="audiences" [value]="audience" [searchable]="false" ariaLabel="Destinatário da devolutiva" (valueChange)="audience=$any($event)"></nl-filter-select></div>
    <div class="field"><label>Orientações para a IA <small>(opcional)</small></label>
      <nl-dictate [evaluationId]="evaluationId"><textarea class="input" rows="3" [(ngModel)]="notes" placeholder="Ex.: dar ênfase às orientações para a escola; tom mais breve."></textarea></nl-dictate></div>
    <div class="row">
      <button class="btn btn-primary btn-sm" [disabled]="busy || !aiReady" (click)="generate()" [title]="aiReady ? '' : 'Geração pela API desligada em Configurações'"><nl-icon name="spark"/> {{busy ? 'Gerando…' : 'Gerar com IA'}}</button>
      <button class="btn btn-secondary btn-sm" (click)="startEdit('')"><nl-icon name="edit"/> Escrever eu mesma</button>
    </div>
    <p class="caption">A IA recebe só os textos aprovados do laudo (demanda, interpretações, conclusão e recomendações), com nomes trocados por marcadores. Não recebe tabelas nem a anamnese, não usa números nem classificações e não acrescenta diagnóstico.</p>
  </div>

  <!-- Draft or approved text -->
  <ng-container *ngIf="d && !editing">
    <div *ngIf="warnings().length && d.status!=='approved'" class="alert warn"><nl-icon name="alert"/><div><strong>Revise antes de aprovar</strong><ul><li *ngFor="let w of warnings()">{{w}}</li></ul></div></div>
    <div class="text"><p *ngFor="let p of paragraphs(d.content)" [class.ptitle]="p.title">{{p.text}}</p></div>
    <p class="caption">{{wordCount(d.content)}} palavras · versão {{d.version}}{{d.status==='approved' ? ' · aprovada por ' + (d.approved_by_name || '—') : ''}}</p>
    <div class="row">
      <ng-container *ngIf="d.status!=='approved'">
        <button class="btn btn-primary btn-sm" [disabled]="busy" (click)="approve()"><nl-icon name="check"/> Aprovar devolutiva</button>
        <button class="btn btn-secondary btn-sm" (click)="startEdit(d.content)"><nl-icon name="edit"/> Editar</button>
        <button class="btn btn-secondary btn-sm" [disabled]="busy || !aiReady" (click)="regenerate()"><nl-icon name="restore"/> {{busy ? 'Gerando…' : 'Gerar de novo'}}</button>
      </ng-container>
      <ng-container *ngIf="d.status==='approved'">
        <button class="btn btn-primary btn-sm" [disabled]="busy" (click)="download()"><nl-icon name="download"/> Baixar Word</button>
        <button class="btn btn-secondary btn-sm" [disabled]="busy" (click)="reopen()"><nl-icon name="edit"/> Reabrir para editar</button>
      </ng-container>
      <button class="btn btn-secondary btn-sm" (click)="copy()"><nl-icon name="copy"/> Copiar</button>
    </div>
  </ng-container>

  <!-- Editing -->
  <div *ngIf="editing" class="edit">
    <div class="field aud"><label>Para quem</label><nl-filter-select [options]="audiences" [value]="audience" [searchable]="false" ariaLabel="Destinatário da devolutiva" (valueChange)="audience=$any($event)"></nl-filter-select></div>
    <nl-dictate [evaluationId]="evaluationId"><textarea class="input draft" rows="16" [(ngModel)]="text" aria-label="Texto da devolutiva"></textarea></nl-dictate>
    <p class="caption">Use uma linha começando com "## " para cada título. Separe parágrafos com uma linha em branco.</p>
    <div class="row">
      <button class="btn btn-primary btn-sm" [disabled]="busy || text.trim().length<20" (click)="save()"><nl-icon name="check"/> Salvar</button>
      <button class="btn btn-secondary btn-sm" (click)="editing=false">Cancelar</button>
    </div>
  </div>
</section>`,
  styles: [`
nl-icon{--ico-size:16px}
.dv{padding:18px 20px;margin-top:16px;display:flex;flex-direction:column;gap:14px}
.dv-head{display:flex;align-items:center;gap:12px}
.dv-head h2{font-size:16px;font-weight:600}
.dv-head small{color:var(--caption);font-size:12.5px}
.ei{width:38px;height:38px;border-radius:var(--radius-sm);display:grid;place-items:center;background:var(--primary-soft);color:var(--primary);flex:none}
.grow{flex:1}
.start,.edit{display:flex;flex-direction:column;gap:12px}
.aud{max-width:300px}
.row{display:flex;gap:8px;flex-wrap:wrap}
textarea{width:100%;resize:vertical}
.draft{font-family:var(--font);font-size:14px;line-height:1.6}
.text{border:1px solid var(--divider);border-radius:var(--radius-sm);padding:14px 16px;display:flex;flex-direction:column;gap:10px;line-height:1.65;font-size:14px}
.text .ptitle{font-weight:600;margin-top:6px}
.alert ul{margin:4px 0 0;padding-left:18px}
`],
})
export class DevolutivaComponent implements OnChanges {
  private api = inject(Api);
  private confirm = inject(ConfirmService);
  @Input() evaluationId = '';
  @Input() aiReady = false;
  @Input() patientName = '';
  audiences = AUDIENCES;
  d: any = null; loaded = false; busy = false;
  audience: Audience = 'familia'; notes = '';
  editing = false; text = '';
  private loadedFor = '';

  async ngOnChanges() { if (this.evaluationId && this.evaluationId !== this.loadedFor) { this.loadedFor = this.evaluationId; await this.load(); } }
  async load() {
    try { const r = await this.api.req<any>('GET', `/evaluations/${this.evaluationId}/devolutiva`); this.d = r.devolutiva; this.audience = (r.devolutiva?.audience || r.default_audience || 'familia'); } catch {}
    this.loaded = true;
  }
  warnings(): string[] { try { return JSON.parse(this.d?.warnings_json || '[]'); } catch { return []; } }
  wordCount = words;
  paragraphs(t: string) {
    return (t || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).flatMap(p => {
      if (!/^#{1,6}\s/.test(p)) return [{title: false, text: p.replace(/\*\*(.+?)\*\*/g, '$1')}];
      const [first, ...rest] = p.replace(/^#{1,6}\s*/, '').split('\n');
      return [{title: true, text: first.trim()}, ...(rest.join(' ').trim() ? [{title: false, text: rest.join(' ').trim()}] : [])];
    });
  }
  private async run(fn: () => Promise<any>, ok?: string) {
    this.busy = true;
    try { const r = await fn(); if (r?.devolutiva !== undefined) this.d = r.devolutiva; if (ok) this.api.notify(ok); return true; } catch { return false; } finally { this.busy = false; }
  }
  generate() { return this.run(() => this.api.req('POST', `/evaluations/${this.evaluationId}/devolutiva/generate`, {audience: this.audience, notes: this.notes}), 'Rascunho da devolutiva pronto. Revise antes de aprovar.'); }
  async regenerate() {
    if (!await this.confirm.ask({title: 'Gerar a devolutiva de novo?', body: 'O texto atual vai para o histórico e um novo rascunho é escrito a partir do laudo aprovado.', ok: 'Gerar de novo'})) return;
    await this.generate();
  }
  startEdit(t: string) { this.text = t; this.editing = true; }
  async save() { if (await this.run(() => this.api.req('PUT', `/evaluations/${this.evaluationId}/devolutiva`, {content: this.text, audience: this.audience}), 'Devolutiva salva.')) this.editing = false; }
  async approve() {
    if (!await this.confirm.ask({title: 'Aprovar a devolutiva?', body: 'Confirme que você leu o texto inteiro e que ele está fiel ao laudo. Depois de aprovada, ela pode ser baixada em Word.', ok: 'Aprovar'})) return;
    await this.run(() => this.api.req('PUT', `/evaluations/${this.evaluationId}/devolutiva`, {content: this.d.content, approve: true}), 'Devolutiva aprovada.');
  }
  reopen() { return this.run(() => this.api.req('POST', `/evaluations/${this.evaluationId}/devolutiva/reopen`), 'Devolutiva reaberta para edição.'); }
  async download() {
    this.busy = true;
    try {
      const data = await this.api.blob(`/evaluations/${this.evaluationId}/devolutiva/export`);
      const url = URL.createObjectURL(data), a = document.createElement('a');
      a.href = url; a.download = 'devolutiva-' + (this.patientName || 'avaliacao').replace(/[^\p{L}\p{N}]+/gu, '-') + '.docx'; a.click(); URL.revokeObjectURL(url);
      this.api.notify('Word da devolutiva baixado.');
    } catch {} finally { this.busy = false; }
  }
  async copy() { try { await navigator.clipboard.writeText(this.d?.content || ''); this.api.notify('Texto copiado.'); } catch { this.api.notify('Não foi possível copiar.'); } }
}
