import {Component, ElementRef, OnInit, ViewChild, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {renderAsync} from 'docx-preview';
import {Api} from './api.service';
import {ConfirmService} from './confirm.service';
import {CONCLUSION_GUIDANCE, SECTIONS, brDate, fold} from './shared';
import {IconComponent} from './ui/icon.component';
import {DictateComponent} from './ui/dictate.component';
import {DropZoneComponent} from './ui/drop-zone.component';
import {FilterSelectComponent, SelectOption} from './ui/filter-select.component';
import {ModelReportComponent, MODEL_STATUS} from './ui/model-report.component';

type Tab = 'modelos' | 'validar' | 'historico';
type Audience = 'infantil' | 'adulto' | 'idoso' | 'geral';
const AUDIENCE: Record<Audience, string> = {infantil: 'Infantil', adulto: 'Adulto', idoso: 'Idoso', geral: 'Geral'};
const AUDIENCE_OPTIONS: SelectOption[] = (Object.keys(AUDIENCE) as Audience[]).map(value => ({value, label: AUDIENCE[value]}));
const blankForm = () => ({name: '', description: '', audience: 'geral' as Audience, tags: '', active: true});

/** Modelos de laudo: library of blank base documents, each checked against the sections the AI fills. */
@Component({
  selector: 'nl-models',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, DropZoneComponent, FilterSelectComponent, ModelReportComponent, DictateComponent],
  template: `
<div class="pagehead">
  <span class="hicon"><nl-icon name="doc"/></span>
  <div><h1>Modelos de laudo</h1><p>Arquivos base em branco que a estagiária preenche. O sistema confere se cada modelo tem os campos que a IA precisa.</p></div>
  <button *ngIf="canWrite()" class="btn btn-primary" (click)="openNew()"><nl-icon name="plus"/> Novo modelo</button>
</div>

<nav class="card mtabs" role="tablist" aria-label="Áreas dos modelos">
  <button type="button" role="tab" [attr.aria-selected]="tab==='modelos'" [class.on]="tab==='modelos'" (click)="tab='modelos'"><nl-icon name="doc"/> Modelos de laudo</button>
  <button type="button" role="tab" [attr.aria-selected]="tab==='validar'" [class.on]="tab==='validar'" (click)="tab='validar'"><nl-icon name="shield"/> Validar documento</button>
  <button type="button" role="tab" [attr.aria-selected]="tab==='historico'" [class.on]="tab==='historico'" (click)="tab='historico'"><nl-icon name="restore"/> Histórico de versões</button>
</nav>

<!-- ============ Modelos ============ -->
<div *ngIf="tab==='modelos'" class="mgrid" [class.empty]="!models.length">
  <section class="card mlist">
    <div class="search-box"><nl-icon name="search"/><input class="input" [(ngModel)]="query" placeholder="Buscar modelo…" aria-label="Buscar modelo"></div>
    <div class="chips">
      <button *ngFor="let f of filters" type="button" class="fchip" [class.on]="filter===f.id" [attr.aria-pressed]="filter===f.id" (click)="filter=f.id">{{f.label}} <b>{{count(f.id)}}</b></button>
    </div>
    <p *ngIf="loading" class="caption pad">Carregando…</p>
    <p *ngIf="!loading && !models.length" class="caption pad">Nenhum modelo ainda. Clique em <b>Novo modelo</b> e envie o Word em branco.</p>
    <p *ngIf="!loading && models.length && !visible().length" class="caption pad">Nenhum modelo encontrado.</p>
    <button *ngFor="let m of visible()" type="button" class="mitem" [class.on]="m.id===selectedId" [attr.aria-current]="m.id===selectedId ? 'true' : null" (click)="select(m.id)">
      <span class="mi"><nl-icon name="doc"/></span>
      <span class="mtxt">
        <b>{{m.name}}</b>
        <small>{{m.description || 'Sem descrição'}}</small>
        <span class="mtags">
          <span class="tag">{{aud(m.audience)}}</span>
          <span *ngFor="let t of m.tags" class="tag alt">{{t}}</span>
          <span *ngIf="m.version" [class]="'tag st-' + mst(m).css">{{mst(m).label}}</span>
          <span *ngIf="m.instructions" class="tag ai">{{m.instructions}} {{m.instructions===1 ? 'instrução' : 'instruções'}}</span>
          <span *ngIf="!m.active" class="tag off">Inativo</span>
        </span>
      </span>
    </button>
  </section>

  <section *ngIf="detail" class="card mdetail">
    <div class="mhead">
      <span class="mhi"><nl-icon name="doc"/></span>
      <div class="mht"><h2>{{detail.name}} <span class="badge" [class.ok]="detail.active" [class.idle]="!detail.active">{{detail.active ? 'Ativo' : 'Inativo'}}</span></h2><p>{{detail.description || 'Sem descrição'}}</p></div>
      <div class="macts">
        <button *ngIf="canWrite()" class="btn btn-secondary btn-sm" (click)="duplicate()"><nl-icon name="copy"/> Duplicar</button>
        <button class="btn btn-secondary btn-sm" (click)="download(detail.version?.version)"><nl-icon name="download"/> Baixar</button>
      </div>
    </div>
    <div class="itabs" role="tablist" aria-label="Detalhes do modelo">
      <button type="button" role="tab" [attr.aria-selected]="inner==='preview'" [class.on]="inner==='preview'" (click)="setInner('preview')"><nl-icon name="eye"/> Pré-visualização</button>
      <button type="button" role="tab" [attr.aria-selected]="inner==='instr'" [class.on]="inner==='instr'" (click)="setInner('instr')"><nl-icon name="spark"/> Instruções da IA<span *ngIf="customInstr()" class="cnt">{{customInstr()}}</span></button>
      <button *ngIf="canWrite()" type="button" role="tab" [attr.aria-selected]="inner==='config'" [class.on]="inner==='config'" (click)="setInner('config')"><nl-icon name="gear"/> Configurações</button>
    </div>

    <div [hidden]="inner!=='preview'" class="pv">
      <p *ngIf="previewing" class="caption center">Montando a pré-visualização…</p>
      <div #previewBox class="pv-doc"></div>
    </div>

    <div *ngIf="inner==='instr'" class="instr">
      <p class="caption">Instruções que a IA segue em cada seção das avaliações feitas com este modelo. Elas substituem a instrução padrão do sistema, e cada avaliação ainda pode ajustar a sua. A IA continua usando só os dados da própria seção.</p>
      <p *ngIf="!instr.length" class="caption">Carregando…</p>
      <div *ngFor="let s of instr; let i=index" class="irow" [class.open]="instrOpen===s.key">
        <button type="button" class="ihead" (click)="instrOpen = instrOpen===s.key ? '' : s.key" [attr.aria-expanded]="instrOpen===s.key">
          <span class="mono n">{{(i+1).toString().padStart(2,'0')}}</span><span class="iname">{{sectionName(s.key)}}</span>
          <span class="itag" [class.on]="s.model">{{s.model ? 'Do modelo' : 'Padrão do sistema'}}</span><nl-icon name="chevd" class="chev"/>
        </button>
        <div *ngIf="instrOpen===s.key" class="ibody">
          <nl-dictate><textarea class="input mono" rows="8" [(ngModel)]="instrDraft[s.key]" [attr.aria-label]="'Instrução de ' + sectionName(s.key)"></textarea></nl-dictate>
          <div class="irow-foot">
            <span class="caption">{{s.limit ? 'Extensão de referência: ' + s.limit + ' palavras' : ''}}</span>
            <span class="spacer"></span>
            <button *ngIf="s.model && canWrite()" class="link" (click)="resetInstr(s)">Voltar ao padrão do sistema</button>
            <button *ngIf="canWrite()" class="btn btn-primary btn-sm" [disabled]="instrSaving===s.key || (instrDraft[s.key]||'').trim()===(s.model||s.default)" (click)="saveInstr(s)"><nl-icon name="check"/> Salvar no modelo</button>
          </div>
        </div>
      </div>
    </div>

    <div *ngIf="inner==='config'" class="cfg">
      <div class="fgrid">
        <label class="fld wide"><span>Nome do modelo</span><input class="input" [(ngModel)]="edit.name" maxlength="120"></label>
        <label class="fld wide"><span>Descrição</span><input class="input" [(ngModel)]="edit.description" maxlength="300" placeholder="Ex.: Modelo completo para avaliação de adultos."></label>
        <div class="fld"><span>Faixa etária</span><nl-filter-select [options]="audienceOptions" [value]="edit.audience" [searchable]="false" ariaLabel="Faixa etária" (valueChange)="edit.audience=$any($event)"></nl-filter-select></div>
        <label class="fld"><span>Etiquetas</span><input class="input" [(ngModel)]="edit.tags" placeholder="Ex.: TDAH, TEA"></label>
        <label class="check wide"><input type="checkbox" [(ngModel)]="edit.active"> Modelo ativo (aparece como opção para uso)</label>
      </div>
      <p class="caption">A faixa etária decide quais seções são obrigatórias: Percepção só é exigida em modelos Infantil ou Geral.</p>
      <div class="cfg-actions"><button class="btn btn-primary btn-sm" [disabled]="saving" (click)="save()"><nl-icon name="check"/> Salvar configurações</button></div>
      <div class="cfg-new">
        <h3>Enviar nova versão do Word</h3>
        <p class="caption">A versão atual fica no histórico e pode ser restaurada.</p>
        <label class="fld wide"><span>O que mudou (opcional)</span><input class="input" [(ngModel)]="versionNote" maxlength="300" placeholder="Ex.: incluído o campo de Interpretação da memória"></label>
        <nl-drop-zone [inline]="true" title="Novo arquivo do modelo (.docx em branco)" [busy]="uploading" (file)="newVersion($event)"></nl-drop-zone>
      </div>
      <div class="danger-zone"><button class="link-danger" (click)="remove()"><nl-icon name="trash"/> Excluir modelo</button></div>
    </div>

    <div class="mfoot">
      <span class="caption"><nl-icon name="clock"/> Versão {{detail.version?.version || '—'}} · {{brDate(detail.version?.created_at)}} · {{detail.version?.filename}}{{usesOf() ? ' · usado em ' + usesOf() + (usesOf()===1 ? ' avaliação' : ' avaliações') : ''}}</span>
      <span class="spacer"></span>
      <button class="btn btn-secondary btn-sm" (click)="tab='historico'"><nl-icon name="restore"/> Histórico de versões</button>
      <button *ngIf="canWrite()" class="btn btn-primary btn-sm" (click)="setInner('config')"><nl-icon name="upload"/> Enviar nova versão</button>
    </div>
  </section>

  <aside *ngIf="detail" class="card mside">
    <div class="side-h"><h3>Conferência do modelo</h3><nl-icon name="info" title="O que a IA precisa encontrar no Word"/></div>
    <nl-model-report [report]="detail.version?.report" [compact]="true"></nl-model-report>
    <div class="tip"><b><nl-icon name="spark"/> Dica</b><p>A IA escreve só nos campos "Interpretação" vazios de cada seção. Deixe tabelas e títulos no modelo; a estagiária preenche os resultados.</p></div>
  </aside>
</div>

<!-- ============ Validar documento ============ -->
<div *ngIf="tab==='validar'" class="vgrid">
  <section class="card vcard">
    <h2>Validar um documento</h2>
    <p class="muted">Confira um arquivo base antes de criar a avaliação: o sistema mostra quais seções a IA consegue preencher e o que falta.</p>
    <div class="fld"><span>Faixa etária do paciente</span><nl-filter-select [options]="audienceOptions" [value]="vAudience" [searchable]="false" ariaLabel="Faixa etária" (valueChange)="vAudience=$any($event); vFile && validate(vFile)"></nl-filter-select></div>
    <nl-drop-zone title="Arquivo para validar (.docx)" [filename]="vFile?.name || ''" [busy]="validating" (file)="validate($event)"></nl-drop-zone>
    <p class="note"><nl-icon name="lock"/> O arquivo é lido e descartado na hora. Nada fica salvo, e nenhum dado do paciente aparece no resultado.</p>
    <button *ngIf="vReport?.blank && canWrite()" class="btn btn-secondary" (click)="saveValidated()"><nl-icon name="plus"/> Salvar como modelo</button>
  </section>
  <section class="card vcard">
    <h2>Resultado</h2>
    <p *ngIf="!vReport" class="muted">Envie um arquivo para ver a conferência.</p>
    <nl-model-report *ngIf="vReport" [report]="vReport"></nl-model-report>
  </section>
</div>

<!-- ============ Histórico ============ -->
<section *ngIf="tab==='historico'" class="card hcard">
  <div class="listhead"><h2>Histórico de versões</h2>
    <nl-filter-select *ngIf="models.length" size="sm" [alignRight]="true" ariaLabel="Modelo" [options]="modelOptions()" [value]="selectedId" (valueChange)="select($event)"></nl-filter-select></div>
  <p *ngIf="!detail" class="muted pad">Nenhum modelo selecionado.</p>
  <div *ngIf="detail" class="tablewrap">
    <table class="tbl">
      <thead><tr><th>Versão</th><th>Arquivo</th><th>Enviada em</th><th>Por</th><th>Conferência</th><th>O que mudou</th><th></th></tr></thead>
      <tbody>
        <tr *ngFor="let v of detail.versions; let first=first" class="norow">
          <td><b>v{{v.version}}</b> <span *ngIf="first" class="badge ok">Atual</span></td>
          <td class="mono small">{{v.filename}}</td>
          <td>{{brDate(v.created_at)}}</td>
          <td>{{v.author || '—'}}</td>
          <td><span [class]="'badge ' + vst(v.status).css">{{v.ready}}/{{v.total}} · {{vst(v.status).label}}</span></td>
          <td class="wrap">{{v.note || '—'}}</td>
          <td class="acts"><button class="btn btn-secondary btn-sm" (click)="download(v.version)"><nl-icon name="download"/> Baixar</button>
            <button *ngIf="!first && canWrite()" class="btn btn-secondary btn-sm" (click)="restore(v.version)"><nl-icon name="restore"/> Restaurar</button></td>
        </tr>
      </tbody>
    </table>
  </div>
</section>

<!-- ============ Novo modelo ============ -->
<div *ngIf="creating" class="modal-bg" (click)="creating=false">
  <div class="modal nmodal" role="dialog" aria-modal="true" aria-labelledby="nm-title" (click)="$event.stopPropagation()" (keydown.escape)="creating=false">
    <h2 id="nm-title">Novo modelo de laudo</h2>
    <p class="muted">Envie o Word <b>em branco</b>, sem dados de paciente. O sistema confere as seções antes de salvar.</p>
    <div class="fgrid">
      <label class="fld wide"><span>Nome do modelo</span><input class="input" [(ngModel)]="form.name" maxlength="120" placeholder="Ex.: Laudo neuropsicológico – Adulto"></label>
      <label class="fld wide"><span>Descrição</span><input class="input" [(ngModel)]="form.description" maxlength="300"></label>
      <div class="fld"><span>Faixa etária</span><nl-filter-select [options]="audienceOptions" [value]="form.audience" [searchable]="false" ariaLabel="Faixa etária" (valueChange)="form.audience=$any($event); nFile && check(nFile)"></nl-filter-select></div>
      <label class="fld"><span>Etiquetas</span><input class="input" [(ngModel)]="form.tags" placeholder="Ex.: TDAH, TEA"></label>
    </div>
    <nl-drop-zone [inline]="true" title="Word do modelo (.docx)" [filename]="nFile?.name || ''" [busy]="validating" (file)="check($event)"></nl-drop-zone>
    <nl-model-report *ngIf="nReport" [report]="nReport" [compact]="true"></nl-model-report>
    <div class="mbtns">
      <button class="btn btn-secondary" (click)="creating=false">Cancelar</button>
      <button class="btn btn-primary" [disabled]="saving || !nFile || form.name.trim().length<3 || (nReport && !nReport.blank)" (click)="create()"><nl-icon name="check"/> Salvar modelo</button>
    </div>
  </div>
</div>`,
  styles: [`
:host{display:block}
.mtabs,.itabs,.macts,.mfoot,.cfg,.vcard,.hcard,.mbtns{--ico-size:16px}
.mtabs{display:flex;gap:4px;padding:0 12px;margin-bottom:16px;overflow-x:auto}
.mtabs button{display:inline-flex;align-items:center;gap:8px;padding:16px 14px;border:0;background:none;border-bottom:2.5px solid transparent;font:500 14.5px var(--font);color:var(--text-2);cursor:pointer;white-space:nowrap}
.mtabs button.on{color:var(--primary-text);border-bottom-color:var(--primary);font-weight:600}
.mtabs button:focus-visible{outline:2px solid var(--primary);outline-offset:-4px;border-radius:6px}
.mgrid{display:grid;grid-template-columns:clamp(260px,22vw,330px) minmax(0,1fr) clamp(260px,21vw,320px);gap:16px;align-items:start}
.mgrid.empty{grid-template-columns:minmax(0,1fr)}
.mlist{padding:14px;display:flex;flex-direction:column;gap:8px}
.mlist .search-box{width:100%}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 6px}
.chips .fchip{height:30px;padding:0 11px;font-size:13px}
.mitem{display:flex;gap:12px;align-items:flex-start;text-align:left;width:100%;padding:12px;border:1px solid var(--border-card);border-radius:var(--radius-sm);background:var(--card);cursor:pointer;font-family:var(--font);color:var(--text)}
.mitem:hover{background:var(--chip)}
.mitem.on{background:var(--primary-soft);border-color:var(--primary-border);box-shadow:inset 3px 0 0 var(--primary)}
.mitem:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.mi,.mhi{width:38px;height:38px;border-radius:var(--radius-sm);display:grid;place-items:center;flex:none;background:var(--primary-soft);color:var(--primary);--ico-size:20px}
.mitem.on .mi{background:var(--card)}
.mtxt{flex:1;min-width:0}
.mtxt b{display:block;font-size:14px;font-weight:700}
.mtxt small{display:block;font-size:12.5px;color:var(--text-2);margin:2px 0 8px;line-height:1.4}
.mtags{display:flex;flex-wrap:wrap;gap:5px}
.tag{font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:var(--radius-pill);background:var(--chip);color:var(--text-2)}
.tag.alt{background:var(--review-bg);color:var(--review)}
.tag.st-ok{background:var(--ok-bg);color:var(--ok-fg)}.tag.st-warn{background:var(--warn-bg);color:var(--warn-fg)}.tag.st-danger{background:var(--danger-bg);color:var(--danger)}
.tag.off{background:var(--idle-bg);color:var(--idle-fg)}
.mdetail{min-width:0;display:flex;flex-direction:column}
.mhead{display:flex;gap:14px;align-items:center;padding:18px 20px 12px}
.mhi{width:48px;height:48px;--ico-size:24px}
.mht{flex:1;min-width:0}
.mht h2{font-size:20px;font-weight:700;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.mht p{font-size:13.5px;color:var(--text-2);margin-top:2px}
.macts{display:flex;gap:8px;flex-wrap:wrap}
.itabs{display:flex;gap:4px;padding:0 16px;border-bottom:1px solid var(--divider)}
.itabs button{display:inline-flex;align-items:center;gap:8px;padding:11px 12px;border:0;background:none;border-bottom:2.5px solid transparent;font:500 14px var(--font);color:var(--text-2);cursor:pointer}
.itabs button.on{color:var(--primary-text);border-bottom-color:var(--primary);font-weight:600}
.itabs button:focus-visible{outline:2px solid var(--primary);outline-offset:-4px;border-radius:6px}
.pv{padding:14px;background:var(--bg);max-height:calc(100vh - 330px);min-height:360px;overflow:auto;border-bottom:1px solid var(--divider)}
.pv-doc{min-height:200px}
.pv-doc ::ng-deep .docx-wrapper{background:transparent;padding:10px 0}
.pv-doc ::ng-deep .docx-wrapper>section.docx{box-shadow:var(--shadow-card);margin-bottom:16px}
.center{text-align:center;padding:30px 0}
.instr{padding:16px 20px;display:flex;flex-direction:column;gap:8px;border-bottom:1px solid var(--divider)}
.irow{border:1px solid var(--border-card);border-radius:var(--radius-sm);background:var(--card)}
.irow.open{border-color:var(--primary-border)}
.ihead{width:100%;display:flex;align-items:center;gap:12px;padding:11px 14px;background:none;border:0;cursor:pointer;font:500 14px var(--font);color:var(--text);text-align:left}
.ihead:focus-visible{outline:2px solid var(--primary);outline-offset:-2px;border-radius:var(--radius-sm)}
.ihead .n{font-size:12px;color:var(--text-3);width:20px}
.iname{flex:1}
.itag{font-size:12px;font-weight:600;color:var(--text-3)}
.itag.on{color:var(--review)}
.ihead .chev{color:var(--text-3);transition:transform .15s}
.irow.open .chev{transform:rotate(180deg)}
.ibody{padding:0 14px 14px;display:flex;flex-direction:column;gap:8px}
.ibody textarea{font-size:12.5px;line-height:1.5;height:auto;padding:10px 12px;resize:vertical}
.irow-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.itabs .cnt{margin-left:2px;font-size:11.5px;font-weight:600;background:var(--review-bg);color:var(--review);border-radius:var(--radius-pill);padding:1px 7px}
.tag.ai{background:var(--review-bg);color:var(--review)}
.cfg{padding:18px 20px;display:flex;flex-direction:column;gap:14px;border-bottom:1px solid var(--divider)}
.fgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px 14px}
.fld{display:flex;flex-direction:column;gap:6px;min-width:0}
.fld>span{font-size:13px;font-weight:600;color:var(--text)}
.wide{grid-column:1/-1}
.check{display:flex;gap:8px;align-items:center;font-size:13.5px;color:var(--text)}
.cfg-actions{display:flex;justify-content:flex-end}
.cfg-new{border-top:1px solid var(--divider);padding-top:14px;display:flex;flex-direction:column;gap:10px}
.cfg-new h3{font-size:15px;font-weight:600}
.danger-zone{border-top:1px solid var(--divider);padding-top:12px}
.link-danger{display:inline-flex;align-items:center;gap:6px}
.mfoot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 20px}
.mfoot .caption{display:inline-flex;align-items:center;gap:6px;min-width:0}
.spacer{flex:1}
.mside{padding:16px;display:flex;flex-direction:column;gap:14px;position:sticky;top:0}
.side-h{display:flex;align-items:center;justify-content:space-between}
.side-h h3{font-size:17px;font-weight:700}
.side-h nl-icon{color:var(--text-3);--ico-size:18px}
.tip{background:var(--review-bg);border-radius:var(--radius-sm);padding:12px 14px;color:var(--text-2);font-size:12.5px;line-height:1.5}
.tip b{display:flex;align-items:center;gap:8px;color:var(--review);font-size:15px;margin-bottom:4px;--ico-size:18px}
.vgrid{display:grid;grid-template-columns:minmax(0,420px) minmax(0,1fr);gap:16px;align-items:start}
.vcard{padding:20px;display:flex;flex-direction:column;gap:14px}
.vcard h2{font-size:18px;font-weight:700}
.note{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:var(--text-2);line-height:1.45}
.note nl-icon{color:var(--primary);margin-top:1px}
.hcard .listhead nl-filter-select{width:280px}
.tbl td.wrap{white-space:normal;min-width:180px}
.tbl td.small{font-size:12.5px}
.tbl tr.norow{cursor:default}
.tbl tr.norow:hover td{background:none}
.tbl td.acts{text-align:right;white-space:nowrap}
.tbl td.acts .btn+.btn{margin-left:6px}
.pad{padding:0 20px 20px}
.nmodal{width:min(620px,calc(100vw - 32px));max-height:calc(100vh - 48px);overflow:auto;display:flex;flex-direction:column;gap:14px}
.nmodal h2{font-size:20px;font-weight:700}
.mbtns{display:flex;justify-content:flex-end;gap:8px}
@media(max-width:1280px){.mgrid{grid-template-columns:clamp(240px,28vw,320px) minmax(0,1fr)}.mside{grid-column:1/-1;position:static}}
@media(max-width:860px){.mgrid,.vgrid{grid-template-columns:minmax(0,1fr)}.fgrid{grid-template-columns:1fr}}
`],
})
export class ModelsComponent implements OnInit {
  private api = inject(Api);
  /** Creating and changing models is for the psychologist (and admin); the assistant reads, downloads and validates. */
  canWrite() { const r = this.api.me()?.role; return r === 'admin' || r === 'psychologist'; }
  private confirm = inject(ConfirmService);
  @ViewChild('previewBox') previewBox?: ElementRef<HTMLDivElement>;
  brDate = brDate; MODEL_STATUS = MODEL_STATUS; audienceOptions = AUDIENCE_OPTIONS;
  tab: Tab = 'modelos';
  inner: 'preview' | 'instr' | 'config' = 'preview';
  instr: any[] = []; instrOpen = ''; instrDraft: Record<string, string> = {}; instrSaving = '';
  models: any[] = []; loading = true;
  selectedId = ''; detail: any = null;
  query = ''; filter: 'all' | Audience = 'all';
  filters: {id: 'all' | Audience; label: string}[] = [{id: 'all', label: 'Todos'}, ...(Object.keys(AUDIENCE) as Audience[]).map(id => ({id, label: AUDIENCE[id]}))];
  edit = blankForm(); versionNote = '';
  saving = false; uploading = false; previewing = false; validating = false;
  // validation tab
  vAudience: Audience = 'geral'; vFile: File | null = null; vReport: any = null;
  // new model
  creating = false; form = blankForm(); nFile: File | null = null; nReport: any = null;

  async ngOnInit() { await this.load(); }

  aud(a: string) { return AUDIENCE[a as Audience] || a; }
  usesOf() { return this.models.find(m => m.id === this.detail?.id)?.uses || 0; }
  vst(s: string) { return MODEL_STATUS[s] || {label: '—', css: 'idle'}; }
  mst(m: any) { return MODEL_STATUS[m.version?.report?.status] || MODEL_STATUS['incomplete']; }
  count(f: 'all' | Audience) { return f === 'all' ? this.models.length : this.models.filter(m => m.audience === f).length; }
  visible() {
    const q = fold(this.query.trim());
    return this.models.filter(m => (this.filter === 'all' || m.audience === this.filter) &&
      (!q || fold(m.name + ' ' + m.description + ' ' + (m.tags || []).join(' ')).includes(q)));
  }
  modelOptions(): SelectOption[] { return this.models.map(m => ({value: m.id, label: m.name})); }

  async load(keep = this.selectedId) {
    this.loading = true;
    try { this.models = await this.api.req('GET', '/models'); } catch { this.models = []; }
    this.loading = false;
    const id = this.models.some(m => m.id === keep) ? keep : this.models[0]?.id || '';
    if (id) await this.select(id, true); else { this.selectedId = ''; this.detail = null; }
  }
  async select(id: string, force = false) {
    if (!force && id === this.selectedId && this.detail) return;
    this.selectedId = id;
    try { this.detail = await this.api.req('GET', '/models/' + id); } catch { return; }
    this.instr = []; this.instrFor = ''; this.instrOpen = ''; if (this.inner === 'instr') this.loadInstr();
    this.edit = {name: this.detail.name, description: this.detail.description, audience: this.detail.audience, tags: (this.detail.tags || []).join(', '), active: this.detail.active};
    this.versionNote = '';
    if (this.inner === 'preview') setTimeout(() => this.renderPreview());
  }
  setInner(v: 'preview' | 'instr' | 'config') { this.inner = v; if (v === 'preview') setTimeout(() => this.renderPreview()); if (v === 'instr') this.loadInstr(); }
  sectionName(k: string) { return SECTIONS.find(s => s.id === k)?.name || k; }
  customInstr() { return this.detail?.id === this.instrFor ? this.instr.filter(s => s.model).length : (this.models.find(m => m.id === this.detail?.id)?.instructions || 0); }
  private instrFor = '';
  async loadInstr() {
    if (!this.detail) return;
    const id = this.detail.id;
    try {
      const r: any = await this.api.req('GET', `/models/${id}/instructions`);
      if (this.detail?.id !== id) return;
      // For the conclusion, the instruction is the psychologist's guidance (the system task stays fixed).
      this.instr = r.sections.map((s: any) => s.key === 'conclusao' ? {...s, default: CONCLUSION_GUIDANCE} : s); this.instrFor = id;
      this.instrDraft = Object.fromEntries(r.sections.map((s: any) => [s.key, s.model || s.default]));
    } catch {}
  }
  async saveInstr(s: any, value = (this.instrDraft[s.key] || '').trim()) {
    this.instrSaving = s.key;
    try {
      const r: any = await this.api.req('PUT', `/models/${this.detail.id}/instructions/${s.key}`, {prompt: value && value !== s.default ? value : null});
      s.model = r.model; this.instrDraft[s.key] = r.model || s.default;
      const m = this.models.find(x => x.id === this.detail.id); if (m) m.instructions = this.instr.filter(x => x.model).length;
      this.api.notify(r.model ? 'Instrução salva no modelo. Vale para as avaliações deste modelo.' : 'Voltou à instrução padrão do sistema.');
    } catch {} finally { this.instrSaving = ''; }
  }
  resetInstr(s: any) { this.instrDraft[s.key] = s.default; this.saveInstr(s, s.default); }

  async renderPreview() {
    const box = this.previewBox?.nativeElement;
    if (!box || !this.detail?.version) return;
    this.previewing = true; box.innerHTML = '';
    const id = this.detail.id;
    try {
      const data = await this.api.getBlob(`/models/${id}/versions/current/file`);
      if (this.detail?.id !== id) return;
      await renderAsync(data, box, undefined, {className: 'docx', inWrapper: true, ignoreLastRenderedPageBreak: true});
    } catch {} finally { this.previewing = false; }
  }

  async download(version?: number) {
    if (!this.detail || !version) return;
    try {
      const data = await this.api.getBlob(`/models/${this.detail.id}/versions/${version}/file`);
      const a = document.createElement('a'); a.href = URL.createObjectURL(data);
      a.download = `${fold(this.detail.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'modelo'}-v${version}.docx`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch {}
  }

  private body(f: ReturnType<typeof blankForm>) {
    return {name: f.name, description: f.description, audience: f.audience, active: f.active, tags: f.tags.split(',').map(t => t.trim()).filter(Boolean)};
  }
  async save() {
    if (this.edit.name.trim().length < 3) { this.api.notify('Dê um nome ao modelo (pelo menos 3 letras).'); return; }
    this.saving = true;
    try { await this.api.req('PUT', '/models/' + this.detail.id, this.body(this.edit)); this.api.notify('Configurações salvas.'); await this.load(this.detail.id); } catch {}
    finally { this.saving = false; }
  }
  async newVersion(file: File) {
    this.uploading = true;
    const fd = new FormData(); fd.append('file', file); fd.append('note', this.versionNote);
    try {
      const r: any = await this.api.req('POST', `/models/${this.detail.id}/versions`, fd);
      this.api.notify(`Versão ${r.version} enviada. ${r.report.ready} de ${r.report.total} seções prontas.`);
      this.inner = 'preview'; await this.load(this.detail.id);
    } catch {} finally { this.uploading = false; }
  }
  async restore(version: number) {
    const ok = await this.confirm.ask({tone: 'review', title: `Restaurar a versão ${version}?`,
      body: `O arquivo da versão ${version} volta a ser o atual de "${this.detail.name}".`,
      facts: ['Vira uma versão nova; nada é apagado', 'A conferência é refeita com a faixa etária atual'], ok: 'Restaurar'});
    if (!ok) return;
    try { await this.api.req('POST', `/models/${this.detail.id}/versions/${version}/restore`); this.api.notify(`Versão ${version} restaurada.`); await this.load(this.detail.id); } catch {}
  }
  async duplicate() {
    try { const m: any = await this.api.req('POST', `/models/${this.detail.id}/duplicate`); this.api.notify('Cópia criada como inativa. Ajuste o nome em Configurações.'); this.inner = 'config'; await this.load(m.id); } catch {}
  }
  async remove() {
    const ok = await this.confirm.ask({tone: 'danger', title: 'Excluir este modelo?',
      body: `"${this.detail.name}" e todas as ${this.detail.versions?.length || 0} versões serão apagados. Avaliações já criadas não mudam.`, ok: 'Excluir modelo'});
    if (!ok) return;
    try { await this.api.req('DELETE', '/models/' + this.detail.id); this.api.notify('Modelo excluído.'); this.inner = 'preview'; await this.load(''); } catch {}
  }

  private async report(file: File, audience: Audience) {
    const fd = new FormData(); fd.append('file', file); fd.append('audience', audience);
    return (await this.api.req<any>('POST', '/models/validate', fd)).report;
  }
  async validate(file: File) {
    this.vFile = file; this.validating = true; this.vReport = null;
    try { this.vReport = await this.report(file, this.vAudience); } catch { this.vFile = null; } finally { this.validating = false; }
  }
  saveValidated() {
    this.openNew();
    this.form.audience = this.vAudience; this.nFile = this.vFile; this.nReport = this.vReport;
    this.form.name = (this.vFile?.name || '').replace(/\.docx$/i, '');
  }

  openNew() { this.form = blankForm(); this.nFile = null; this.nReport = null; this.creating = true; setTimeout(() => (document.querySelector('.nmodal input') as HTMLInputElement | null)?.focus()); }
  async check(file: File) {
    this.nFile = file; this.validating = true; this.nReport = null;
    if (!this.form.name.trim()) this.form.name = file.name.replace(/\.docx$/i, '');
    try { this.nReport = await this.report(file, this.form.audience); } catch { this.nFile = null; } finally { this.validating = false; }
  }
  async create() {
    if (!this.nFile) return;
    this.saving = true;
    const fd = new FormData(); fd.append('file', this.nFile);
    const b = this.body(this.form);
    fd.append('name', b.name); fd.append('description', b.description); fd.append('audience', b.audience); fd.append('tags', JSON.stringify(b.tags)); fd.append('active', String(b.active));
    try {
      const m: any = await this.api.req('POST', '/models', fd);
      this.creating = false; this.tab = 'modelos'; this.inner = 'preview';
      this.api.notify('Modelo salvo.'); await this.load(m.id);
    } catch {} finally { this.saving = false; }
  }
}
