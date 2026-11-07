import {Component, OnInit, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Api, ROLE_NAMES, Role} from './api.service';
import {ConfirmService} from './confirm.service';
import {FilterSelectComponent} from './ui/filter-select.component';
import {IconComponent} from './ui/icon.component';
import {brDate} from './shared';

interface Account {id: string; name: string; email: string; role: Role; active: boolean; must_change_password: boolean; created_at: string; last_login_at: string | null; evaluations: number; approvals: number}

/** Temporary password the admin hands over; the person must replace it at the first login. */
function tempPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(r, n => abc[n % abc.length]).join('').replace(/(.{4})(?=.)/g, '$1-');
}

/** Settings > Usuários (admin only): accounts, roles, deactivation and password reset. */
@Component({
  selector: 'nl-users',
  standalone: true,
  imports: [CommonModule, FormsModule, FilterSelectComponent, IconComponent],
  template: `
<section class="card">
  <div class="card-head">
    <h2>Usuários e papéis</h2>
    <button *ngIf="!creating" class="btn btn-primary btn-sm" (click)="startCreate()"><nl-icon name="plus"/> Nova conta</button>
  </div>
  <div class="card-body">
    <ul class="roles">
      <li><b>{{ROLE_NAMES.admin}}</b><span>Tudo, inclusive contas e configuração da IA.</span></li>
      <li><b>{{ROLE_NAMES.psychologist}}</b><span>Gera textos com IA, edita, aprova e baixa o laudo.</span></li>
      <li><b>{{ROLE_NAMES.assistant}}</b><span>Cria avaliações, envia os arquivos e consulta. Não gera, não aprova, não baixa.</span></li>
    </ul>

    <form *ngIf="creating" class="newform" (submit)="$event.preventDefault();create()">
      <h3>Nova conta</h3>
      <div class="grid">
        <div class="field"><label for="nu-name">Nome</label><input id="nu-name" class="input" name="name" [(ngModel)]="form.name" autocomplete="off"></div>
        <div class="field"><label for="nu-email">E-mail</label><input id="nu-email" class="input" type="email" name="email" [(ngModel)]="form.email" autocomplete="off"></div>
        <div class="field"><label>Papel</label><nl-filter-select [options]="roleOptions" [value]="form.role" (valueChange)="form.role=$any($event)" [searchable]="false" ariaLabel="Papel da nova conta"></nl-filter-select></div>
        <div class="field"><label for="nu-pw">Senha temporária</label>
          <div class="pwrow"><input id="nu-pw" class="input mono" name="password" [(ngModel)]="form.password" autocomplete="new-password"><button type="button" class="btn btn-secondary btn-sm" (click)="form.password=newTemp()" title="Gerar outra">Gerar</button></div>
        </div>
      </div>
      <p class="caption">Passe a senha temporária à pessoa por um canal seguro. No primeiro acesso ela precisa criar a própria senha.</p>
      <div class="row">
        <button class="btn btn-primary" type="submit" [disabled]="busy || form.name.trim().length<2 || !form.email.includes('@') || form.password.length<10">Criar conta</button>
        <button class="btn btn-secondary" type="button" (click)="creating=false">Cancelar</button>
      </div>
    </form>

    <div *ngIf="shown" class="alert tip" role="status">
      <nl-icon name="lock"/>
      <div>
        <strong>Senha temporária de {{shown.name}}</strong>
        <p>Anote agora: ela não aparece de novo. <span class="mono pw">{{shown.password}}</span>
          <button type="button" class="link" (click)="copy(shown.password)"><nl-icon name="copy"/> Copiar</button></p>
      </div>
      <button type="button" class="link" (click)="shown=null">Fechar</button>
    </div>

    <p *ngIf="!users" class="caption">Carregando…</p>
    <div *ngIf="users" class="tablewrap">
      <table class="tbl">
        <thead><tr><th>Nome</th><th>Papel</th><th>Situação</th><th>Último acesso</th><th class="num">Avaliações</th><th></th></tr></thead>
        <tbody>
          <tr *ngFor="let u of users" [class.off]="!u.active">
            <td><b>{{u.name}}</b><small>{{u.email}}</small></td>
            <td class="rolecell">
              <nl-filter-select *ngIf="u.id !== api.me()?.id; else selfRole" size="sm" [options]="roleOptions" [value]="u.role" [searchable]="false"
                [disabled]="busy || !u.active" (valueChange)="setRole(u, $any($event))" [ariaLabel]="'Papel de ' + u.name"></nl-filter-select>
              <ng-template #selfRole>{{ROLE_NAMES[u.role]}} <small>(você)</small></ng-template>
            </td>
            <td>
              <span *ngIf="!u.active" class="badge idle">Desativada</span>
              <span *ngIf="u.active && u.must_change_password" class="badge warn">Aguardando 1º acesso</span>
              <span *ngIf="u.active && !u.must_change_password" class="badge ok">Ativa</span>
            </td>
            <td>{{u.last_login_at ? when(u.last_login_at) : 'Nunca'}}</td>
            <td class="num" [title]="u.approvals + ' aprovada(s) por esta conta'">{{u.evaluations}}</td>
            <td class="acts">
              <ng-container *ngIf="u.id !== api.me()?.id">
                <button type="button" class="link" [disabled]="busy || !u.active" (click)="reset(u)">Redefinir senha</button>
                <button type="button" [class]="u.active ? 'link link-danger' : 'link'" [disabled]="busy" (click)="toggle(u)">{{u.active ? 'Desativar' : 'Reativar'}}</button>
              </ng-container>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="caption note">Contas não são apagadas: ficam desativadas para manter o histórico de quem criou, editou e aprovou cada laudo. Desativar ou redefinir a senha encerra na hora as sessões abertas da pessoa.</p>
  </div>
</section>`,
  styles: [`
nl-icon{--ico-size:16px}
.roles{list-style:none;margin:0 0 16px;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.roles li{border:1px solid var(--border-card);border-radius:var(--radius-sm);padding:10px 12px;display:flex;flex-direction:column;gap:4px;font-size:13px}
.roles span{color:var(--text-3);line-height:1.45}
.newform{border:1px solid var(--primary-border);background:var(--primary-soft);border-radius:var(--radius-sm);padding:16px;margin-bottom:16px;display:flex;flex-direction:column;gap:12px}
.newform h3{font-size:15px;font-weight:600}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.pwrow{display:flex;gap:8px}.pwrow .input{flex:1}
.row{display:flex;gap:10px;flex-wrap:wrap}
.alert{margin-bottom:16px}
.alert p{margin-top:4px}
.pw{font-size:15px;padding:2px 8px;border-radius:6px;background:var(--card);margin:0 6px;user-select:all}
.tablewrap{overflow:auto}
td small{display:block;color:var(--caption);font-size:12px}
.tbl{min-width:0}
.tbl td{white-space:normal}
.tbl tbody tr{cursor:default}
.tbl tbody tr:hover td{background:none}
.rolecell{width:210px}
tr.off td{color:var(--text-3)}
.num{text-align:right}
.acts{text-align:right}
.acts ng-container,.acts .link{display:block;margin-left:auto;white-space:nowrap}
.acts .link+.link{margin-top:4px}
.note{margin-top:12px}
@media(max-width:900px){.roles,.grid{grid-template-columns:minmax(0,1fr)}}
`],
})
export class UsersComponent implements OnInit {
  api = inject(Api);
  private confirm = inject(ConfirmService);
  ROLE_NAMES = ROLE_NAMES;
  roleOptions = (Object.keys(ROLE_NAMES) as Role[]).map(id => ({label: ROLE_NAMES[id], value: id}));
  users: Account[] | null = null;
  busy = false; creating = false;
  form = {name: '', email: '', role: 'assistant' as Role, password: ''};
  shown: {name: string; password: string} | null = null;
  newTemp = tempPassword;

  ngOnInit() { this.load(); }
  async load() { try { this.users = (await this.api.req<{users: Account[]}>('GET', '/users')).users; } catch {} }
  when(iso: string) { const d = new Date(iso); return isNaN(+d) ? brDate(iso) : `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}`; }
  startCreate() { this.form = {name: '', email: '', role: 'assistant', password: tempPassword()}; this.creating = true; this.shown = null; }

  private async run(fn: () => Promise<any>) { this.busy = true; try { await fn(); await this.load(); } catch {} finally { this.busy = false; } }

  create() {
    return this.run(async () => {
      const f = this.form;
      await this.api.req('POST', '/users', {name: f.name, email: f.email, role: f.role, password: f.password});
      this.shown = {name: f.name.trim(), password: f.password}; this.creating = false;
      this.api.notify('Conta criada.');
    });
  }
  async setRole(u: Account, role: Role) {
    if (role === u.role) return;
    const ok = await this.confirm.ask({title: `Mudar o papel de ${u.name}?`, body: `De ${ROLE_NAMES[u.role]} para ${ROLE_NAMES[role]}. Vale na hora, inclusive na sessão aberta.`, ok: 'Mudar papel'});
    if (!ok) { await this.load(); return; }
    await this.run(async () => { await this.api.req('PUT', `/users/${u.id}`, {role}); this.api.notify('Papel alterado.'); });
  }
  async toggle(u: Account) {
    if (u.active) {
      const ok = await this.confirm.ask({title: `Desativar a conta de ${u.name}?`, body: 'A pessoa sai do sistema na hora e não consegue mais entrar.',
        facts: ['Avaliações, textos e aprovações dela continuam guardados.', 'Dá para reativar depois.'], ok: 'Desativar', tone: 'danger'});
      if (!ok) return;
    }
    await this.run(async () => { await this.api.req('PUT', `/users/${u.id}`, {active: !u.active}); this.api.notify(u.active ? 'Conta desativada.' : 'Conta reativada.'); });
  }
  async reset(u: Account) {
    const ok = await this.confirm.ask({title: `Redefinir a senha de ${u.name}?`, body: 'Uma senha temporária será criada. As sessões abertas da pessoa terminam e, ao entrar, ela cria uma senha nova.', ok: 'Redefinir'});
    if (!ok) return;
    const password = tempPassword();
    await this.run(async () => { await this.api.req('POST', `/users/${u.id}/password`, {password}); this.shown = {name: u.name, password}; });
  }
  async copy(text: string) { try { await navigator.clipboard.writeText(text); this.api.notify('Senha copiada.'); } catch { this.api.notify('Não foi possível copiar. Selecione e copie à mão.'); } }
}
