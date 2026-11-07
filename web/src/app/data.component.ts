import {Component, EventEmitter, OnInit, Output, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Api} from './api.service';
import {brDate} from './shared';
import {IconComponent} from './ui/icon.component';

/** Configurações > Dados e backup: daily encrypted backups, a password copy to keep elsewhere, and the retention list. */
@Component({
  selector: 'nl-data',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
<section class="card">
  <div class="card-head"><h2>Backup</h2><button class="btn btn-primary btn-sm" [disabled]="busy" (click)="backupNow()"><nl-icon name="download"/> {{busy ? 'Fazendo backup…' : 'Fazer backup agora'}}</button></div>
  <div class="card-body">
    <div *ngIf="info" [class]="'alert ' + (stale() ? 'warn' : 'tip')"><nl-icon [name]="stale() ? 'alert' : 'checkc'"/>
      <div><strong>{{info.backups.length ? 'Último backup: ' + when(info.backups[0].created_at) : 'Nenhum backup ainda'}}</strong>
        <p>{{info.auto ? 'Automático uma vez por dia, enquanto o sistema está aberto. Ficam os ' + info.keep + ' mais recentes.' : 'Backup automático desligado (BACKUP_AUTO=false).'}} Pasta: <span class="mono">{{info.dir}}</span></p></div></div>
    <p class="muted small">Estes backups são criptografados com a chave deste computador: servem se o banco for apagado ou danificado aqui. Para se proteger de perder o computador, baixe também uma cópia com senha e guarde em outro lugar (HD externo, pendrive guardado).</p>
    <div *ngIf="info?.backups?.length" class="tablewrap">
      <table class="tbl"><thead><tr><th>Arquivo</th><th>Data</th><th class="num">Tamanho</th></tr></thead>
        <tbody><tr *ngFor="let b of info.backups"><td class="mono">{{b.name}}</td><td>{{when(b.created_at)}}</td><td class="num">{{size(b.size)}}</td></tr></tbody></table>
    </div>
  </div>
</section>

<section class="card">
  <div class="card-head"><h2>Cópia com senha</h2></div>
  <div class="card-body form">
    <p class="muted small">Gera e baixa um backup completo (banco, documentos e a chave dos documentos) protegido por uma senha sua. Abre em qualquer computador com o NeuroLaudos. Sem a senha, ninguém abre — nem você: anote em lugar seguro.</p>
    <div class="row">
      <input class="input" type="password" [(ngModel)]="pw" placeholder="Senha (mín. 12 caracteres)" autocomplete="new-password" aria-label="Senha do backup">
      <input class="input" type="password" [(ngModel)]="pw2" placeholder="Repita a senha" autocomplete="new-password" aria-label="Repita a senha do backup">
      <button class="btn btn-secondary" [disabled]="busy || pw.length<12 || pw!==pw2" (click)="exportCopy()"><nl-icon name="lock"/> Baixar cópia</button>
    </div>
    <span *ngIf="pw2 && pw!==pw2" class="caption field-hint-warn">As senhas não são iguais.</span>
    <p class="caption">Para restaurar: feche o sistema e rode no terminal, na pasta do projeto: <span class="mono">npm run backup:restaurar -- caminho\\do\\arquivo.nlbk</span>. Os dados atuais são guardados à parte, nunca apagados.</p>
  </div>
</section>

<section class="card">
  <div class="card-head"><h2>Prazo de guarda</h2></div>
  <div class="card-body">
    <p class="muted small">Laudos aprovados são guardados por {{ret?.years || 5}} anos após a aprovação (RETENTION_YEARS no api/.env; confira o prazo mínimo das normas do CFP). Nada é apagado sozinho: aqui aparecem os que já podem ser descartados, para você decidir.</p>
    <p *ngIf="ret && !ret.expired.length && !ret.soon.length" class="caption">Nenhum laudo com prazo vencido ou vencendo nos próximos 90 dias.</p>
    <div *ngFor="let group of [{t: 'Prazo vencido', l: ret?.expired, css: 'danger'}, {t: 'Vence nos próximos 90 dias', l: ret?.soon, css: 'warn'}]">
      <ng-container *ngIf="group.l?.length">
        <p class="label-caps">{{group.t}} ({{group.l.length}})</p>
        <div *ngFor="let r of group.l" class="ret"><b>{{r.patient_name}}</b><span>aprovado em {{brDate(r.approved_at)}}</span><span [class]="'badge ' + group.css">guardar até {{brDate(r.keep_until)}}</span>
          <span class="grow"></span><button class="link" (click)="open.emit(r.id)">Abrir</button></div>
      </ng-container>
    </div>
  </div>
</section>`,
  styles: [`
:host{display:flex;flex-direction:column;gap:16px}
nl-icon{--ico-size:16px}
.small{font-size:13px;margin:10px 0}
.form{display:flex;flex-direction:column;gap:10px}
.row{display:flex;gap:8px;flex-wrap:wrap}.row .input{max-width:220px}
.tablewrap{overflow:auto}.num{text-align:right}
.alert p{margin-top:4px;word-break:break-all}
.ret{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--divider);font-size:13.5px;flex-wrap:wrap}
.ret span{color:var(--text-3)}.ret .badge{color:inherit}
.grow{flex:1}
`],
})
export class DataComponent implements OnInit {
  private api = inject(Api);
  @Output() open = new EventEmitter<string>();
  brDate = brDate;
  info: any = null; ret: any = null; busy = false; pw = ''; pw2 = '';
  async ngOnInit() { await this.load(); }
  async load() {
    try { this.info = await this.api.req('GET', '/backups'); } catch {}
    try { this.ret = await this.api.req('GET', '/retention'); } catch {}
  }
  stale() { const b = this.info?.backups?.[0]; return !b || Date.now() - Date.parse(b.created_at) > 48 * 3600_000; }
  when(iso: string) { const d = new Date(iso); return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}`; }
  size(n: number) { return n > 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  async backupNow() { this.busy = true; try { this.info = {...this.info, backups: (await this.api.req<any>('POST', '/backups')).backups}; this.api.notify('Backup feito.'); } catch {} finally { this.busy = false; } }
  async exportCopy() {
    this.busy = true;
    try {
      const blob = await this.api.blobPost('/backups/export', {password: this.pw});
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = `neurolaudos-${new Date().toISOString().slice(0, 10)}.nlbk`; a.click(); URL.revokeObjectURL(url);
      this.pw = this.pw2 = ''; this.api.notify('Cópia com senha baixada. Guarde o arquivo e a senha em lugares diferentes.');
    } catch {} finally { this.busy = false; }
  }
}
