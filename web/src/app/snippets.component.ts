import {Component, OnInit, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Api} from './api.service';
import {ConfirmService} from './confirm.service';
import {SECTIONS} from './shared';
import {FilterSelectComponent} from './ui/filter-select.component';
import {IconComponent} from './ui/icon.component';

interface Snippet {id: string; title: string; text: string; section_key: string | null; author?: string}

/** Configurações > Textos-padrão: the clinic's recurring paragraphs, inserted by hand while editing a section. */
@Component({
  selector: 'nl-snippets',
  standalone: true,
  imports: [CommonModule, FormsModule, FilterSelectComponent, IconComponent],
  template: `
<section class="card">
  <div class="card-head"><h2>Textos-padrão</h2><button *ngIf="!form" class="btn btn-primary btn-sm" (click)="startNew()"><nl-icon name="plus"/> Novo texto</button></div>
  <div class="card-body">
    <p class="muted small">Parágrafos que você usa sempre (recomendações, encaminhamentos, orientações). Ao editar uma seção, escolha em "Inserir texto-padrão" e ele entra onde está o cursor. Não guarde aqui dados de paciente.</p>

    <form *ngIf="form" class="sform" (submit)="$event.preventDefault();save()">
      <div class="grid">
        <div class="field"><label for="sn-title">Título</label><input id="sn-title" class="input" name="title" [(ngModel)]="form.title" placeholder="Ex.: Encaminhamento para fonoaudiologia"></div>
        <div class="field"><label>Mostrar em</label><nl-filter-select [options]="sectionOptions" [value]="form.section_key || ''" (valueChange)="form.section_key=$event || null" ariaLabel="Seção do texto-padrão"></nl-filter-select></div>
      </div>
      <div class="field"><label for="sn-text">Texto</label><textarea id="sn-text" class="input" name="text" rows="6" [(ngModel)]="form.text"></textarea></div>
      <div class="row">
        <button class="btn btn-primary" type="submit" [disabled]="busy || form.title.trim().length<2 || form.text.trim().length<2">{{form.id ? 'Salvar' : 'Criar texto'}}</button>
        <button class="btn btn-secondary" type="button" (click)="form=null">Cancelar</button>
      </div>
    </form>

    <p *ngIf="!list" class="caption">Carregando…</p>
    <p *ngIf="list && !list.length && !form" class="caption">Nenhum texto-padrão ainda.</p>
    <div *ngFor="let s of list" class="snip">
      <div class="shead"><b>{{s.title}}</b><span class="badge idle">{{sectionName(s.section_key)}}</span><span class="grow"></span>
        <button class="link" (click)="edit(s)">Editar</button><button class="link link-danger" (click)="remove(s)">Excluir</button></div>
      <p>{{s.text}}</p>
    </div>
  </div>
</section>`,
  styles: [`
nl-icon{--ico-size:16px}
.small{font-size:13px;margin-bottom:14px}
.sform{border:1px solid var(--primary-border);background:var(--primary-soft);border-radius:var(--radius-sm);padding:14px;margin-bottom:16px;display:flex;flex-direction:column;gap:12px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.row{display:flex;gap:10px}
textarea{resize:vertical}
.snip{border-top:1px solid var(--divider);padding:12px 0}
.shead{display:flex;align-items:center;gap:10px;margin-bottom:4px}
.shead .link+.link{margin-left:12px}
.grow{flex:1}
.snip p{white-space:pre-wrap;font-size:13.5px;line-height:1.55;color:var(--text-2)}
@media(max-width:800px){.grid{grid-template-columns:minmax(0,1fr)}}
`],
})
export class SnippetsComponent implements OnInit {
  private api = inject(Api);
  private confirm = inject(ConfirmService);
  list: Snippet[] | null = null;
  form: {id?: string; title: string; text: string; section_key: string | null} | null = null;
  busy = false;
  sectionOptions = [{label: 'Qualquer seção', value: ''}, ...SECTIONS.map(s => ({label: s.name, value: s.id}))];

  ngOnInit() { this.load(); }
  async load() { try { this.list = await this.api.req('GET', '/snippets'); } catch {} }
  sectionName(k: string | null) { return k ? SECTIONS.find(s => s.id === k)?.name || k : 'Qualquer seção'; }
  startNew() { this.form = {title: '', text: '', section_key: 'recomendacoes'}; }
  edit(s: Snippet) { this.form = {id: s.id, title: s.title, text: s.text, section_key: s.section_key}; }
  async save() {
    const f = this.form; if (!f) return; this.busy = true;
    const body = {title: f.title, text: f.text, section_key: f.section_key || null};
    try { await this.api.req(f.id ? 'PUT' : 'POST', f.id ? `/snippets/${f.id}` : '/snippets', body); this.form = null; this.api.notify('Texto-padrão salvo.'); await this.load(); }
    catch {} finally { this.busy = false; }
  }
  async remove(s: Snippet) {
    if (!await this.confirm.ask({tone: 'danger', title: `Excluir "${s.title}"?`, body: 'Os laudos que já usaram este texto não mudam.', ok: 'Excluir'})) return;
    try { await this.api.req('DELETE', `/snippets/${s.id}`); await this.load(); } catch {}
  }
}
