import {Component, OnInit, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Api} from './api.service';
import {fold} from './shared';
import {IconComponent} from './ui/icon.component';

/** "Biblioteca de testes": the instruments the system recognises in the base tables and the guide the AI receives for each.
 *  The psychologist can write the clinic's own guide; the default stays in api/src/prompts.mjs. */
@Component({
  selector: 'nl-library',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
<div class="pagehead"><span class="hicon"><nl-icon name="lib"/></span>
  <div><h1>Biblioteca de testes</h1><p>Instrumentos que o sistema reconhece nas tabelas do arquivo base e o guia de interpretação que a IA recebe para cada um.</p></div></div>

<section class="card">
  <div class="filters"><div class="search-box"><nl-icon name="search"/><input class="input" [(ngModel)]="q" placeholder="Buscar instrumento…" aria-label="Buscar instrumento"></div>
    <span class="caption">{{list.length}} instrumentos · {{customCount()}} com guia próprio da clínica</span></div>
  <div *ngFor="let i of filtered()" class="inst">
    <button type="button" class="ihead" (click)="toggle(i)" [attr.aria-expanded]="open===i.id">
      <b>{{i.name}}</b>
      <span *ngIf="i.multi" class="badge idle">multidimensional</span>
      <span *ngIf="i.custom_guide" class="badge ok">guia da clínica</span>
      <span class="grow"></span>
      <small>{{i.planned_in ? 'planejado em ' + i.planned_in + ' avaliação(ões)' : ''}}</small>
      <nl-icon name="chevd" [class.up]="open===i.id"/>
    </button>
    <div *ngIf="open===i.id" class="ibody">
      <ng-container *ngIf="editing!==i.id">
        <p class="guide">{{i.custom_guide || i.default_guide}}</p>
        <div class="row" *ngIf="canWrite()">
          <button class="btn btn-secondary btn-sm" (click)="edit(i)"><nl-icon name="edit"/> {{i.custom_guide ? 'Editar guia da clínica' : 'Escrever guia da clínica'}}</button>
          <button *ngIf="i.custom_guide" class="link" [disabled]="busy" (click)="save(i, '')">Voltar ao guia padrão</button>
        </div>
      </ng-container>
      <ng-container *ngIf="editing===i.id">
        <textarea class="input" rows="8" [(ngModel)]="draft" aria-label="Guia de interpretação"></textarea>
        <p class="caption">Este texto vai para a IA sempre que o instrumento aparecer na seção. Não coloque dados de paciente.</p>
        <div class="row"><button class="btn btn-primary btn-sm" [disabled]="busy || draft.trim().length<30" (click)="save(i, draft)">Salvar</button><button class="btn btn-secondary btn-sm" (click)="editing=''">Cancelar</button></div>
      </ng-container>
    </div>
  </div>
  <p class="caption note">Para um instrumento novo ser reconhecido nas tabelas, ele precisa ser incluído em <span class="mono">api/src/prompts.mjs</span> (INSTRUMENTS).</p>
</section>`,
  styles: [`
:host{display:block}
nl-icon{--ico-size:16px}
.filters{display:flex;gap:12px;align-items:center;padding:14px 16px;flex-wrap:wrap}
.inst{border-top:1px solid var(--divider)}
.ihead{width:100%;display:flex;align-items:center;gap:10px;padding:12px 16px;background:none;border:0;cursor:pointer;font-family:var(--font);color:var(--text);text-align:left}
.ihead:hover{background:var(--chip)}
.ihead small{color:var(--caption);font-size:12px}
.ihead nl-icon.up{transform:rotate(180deg)}
.grow{flex:1}
.ibody{padding:0 16px 14px;display:flex;flex-direction:column;gap:10px}
.guide{font-size:13.5px;line-height:1.6;color:var(--text-2);white-space:pre-wrap}
.row{display:flex;gap:10px;align-items:center}
textarea{width:100%;resize:vertical}
.note{padding:12px 16px}
`],
})
export class LibraryComponent implements OnInit {
  private api = inject(Api);
  list: any[] = []; q = ''; open = ''; editing = ''; draft = ''; busy = false;
  async ngOnInit() { await this.load(); }
  async load() { try { this.list = await this.api.req<any[]>('GET', '/instruments'); } catch {} }
  canWrite() { const r = this.api.me()?.role; return r === 'admin' || r === 'psychologist'; }
  customCount() { return this.list.filter(i => i.custom_guide).length; }
  filtered() { const q = fold(this.q.trim()); return this.list.filter(i => !q || fold(i.name).includes(q)); }
  toggle(i: any) { this.open = this.open === i.id ? '' : i.id; this.editing = ''; }
  edit(i: any) { this.editing = i.id; this.draft = i.custom_guide || i.default_guide; }
  async save(i: any, guide: string) {
    this.busy = true;
    try { await this.api.req('PUT', `/instruments/${i.id}`, {guide}); this.editing = ''; await this.load(); this.api.notify(guide ? 'Guia da clínica salvo.' : 'Voltou ao guia padrão.'); }
    catch {} finally { this.busy = false; }
  }
}
