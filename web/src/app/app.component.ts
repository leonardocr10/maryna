import {Component, HostListener, effect, inject, signal, NgZone} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Api, ROLE_NAMES} from './api.service';
import {STATUS, brDate} from './shared';
import {NewEvaluationComponent} from './new-evaluation.component';
import {EvaluationComponent} from './evaluation.component';
import {SettingsComponent} from './settings.component';
import {WorkTimer, clock, duration} from './work-timer.service';
import {ThemeService} from './theme.service';
import {WheelZoom} from './wheel-zoom.service';
import {IconComponent} from './ui/icon.component';
import {ConfirmDialogComponent} from './ui/confirm-dialog.component';
import {DashboardComponent} from './dashboard.component';
import {PatientsComponent} from './patients.component';
import {ModelsComponent} from './models.component';
import {DevolutivasComponent} from './devolutivas.component';
import {ReportsComponent} from './reports.component';
import {LibraryComponent} from './library.component';
import {ChatgptConsentComponent} from './ui/chatgpt-consent.component';
import {CommandPaletteComponent, rememberRecent} from './ui/command-palette.component';
import {TopbarService} from './topbar.service';
import {installTooltips} from './tooltip';
import {ReadingModeComponent} from './ui/reading-mode.component';

type Screen = 'home' | 'evaluation' | 'new' | 'settings' | 'patients' | 'models' | 'library' | 'reports' | 'devolutivas';
const SCREENS: Screen[] = ['home', 'evaluation', 'new', 'settings', 'patients', 'models', 'library', 'reports', 'devolutivas'];

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, NewEvaluationComponent, EvaluationComponent, SettingsComponent, IconComponent, ConfirmDialogComponent, DashboardComponent, PatientsComponent, ModelsComponent, DevolutivasComponent, ReportsComponent, LibraryComponent, ChatgptConsentComponent, CommandPaletteComponent, ReadingModeComponent],
  template: `
<!-- Theme switch, shared by the login screen and the top bar -->
<ng-template #themeSwitch>
  <div class="theme-switch" role="group" aria-label="Tema">
    <button type="button" [attr.aria-pressed]="theme.theme()==='light'" (click)="theme.set('light')"><nl-icon name="sun"/> Claro</button>
    <button type="button" [attr.aria-pressed]="theme.theme()==='dark'" (click)="theme.set('dark')"><nl-icon name="moon"/> Escuro</button>
  </div>
  <div class="theme-switch zoom-switch" role="group" aria-label="Tamanho da tela">
    <button type="button" [disabled]="!theme.canZoom(-1)" (click)="theme.stepZoom(-1)" title="Diminuir a tela" aria-label="Diminuir a tela">A−</button>
    <button type="button" class="zval mono" (click)="theme.stepZoom(0)" title="Voltar ao tamanho normal (100%)" aria-label="Tamanho atual; clique para voltar a 100%">{{theme.zoom()}}%</button>
    <button type="button" [disabled]="!theme.canZoom(1)" (click)="theme.stepZoom(1)" title="Aumentar a tela" aria-label="Aumentar a tela">A+</button>
  </div>
</ng-template>

<!-- Login -->
<div *ngIf="!api.loggedIn() || mustChange()" class="login">
  <svg class="login-waves" viewBox="0 0 1440 900" preserveAspectRatio="none" aria-hidden="true">
    <path class="w1" d="M0 0 H880 C760 220 760 420 860 600 C900 700 880 800 820 900 H0z"/>
    <path class="w2" d="M0 760 C300 660 600 700 900 820 V900 H0z"/>
  </svg>
  <section class="pitch">
    <div class="bar"></div>
    <h1>NeuroLaudos IA</h1>
    <h2>Elaboração assistida de laudos neuropsicológicos</h2>
    <p>A IA redige rascunhos a partir do arquivo base e da anamnese. Você revisa, aprova cada seção e baixa o Word.</p>
    <ul>
      <li><span class="fi"><nl-icon name="doc"/></span><span><b>Arquivo base preservado</b><small>Tabelas, escores e referências nunca são alterados</small></span></li>
      <li><span class="fi"><nl-icon name="spark"/></span><span><b>Interpretação com IA</b><small>Rascunhos por seção, revisados por você</small></span></li>
      <li><span class="fi"><nl-icon name="check"/></span><span><b>Aprovação seção a seção</b><small>O Word só sai com tudo aprovado</small></span></li>
    </ul>
  </section>
  <section class="login-side">
    <!-- No e-mail service: the request goes to the administrator, who hands over a temporary password -->
    <form *ngIf="!api.loggedIn() && forgot" class="login-card" (submit)="$event.preventDefault();requestReset()">
      <img class="login-logo" src="assets/brand/neurolaudos-logo.webp" alt="NeuroLaudos IA — Elaboração assistida de laudos">
      <div><h1>Esqueci minha senha</h1><p class="sub">Informe o seu e-mail. O administrador da clínica recebe o pedido e passa a você uma senha temporária.</p></div>
      <ng-container *ngIf="!forgotSent">
        <div class="field"><label for="fg-email">E-mail</label>
          <div class="with-ico"><nl-icon name="mail"/><input id="fg-email" class="input" type="email" name="femail" [(ngModel)]="email" autocomplete="username" placeholder="seu@email.com"></div></div>
        <button class="btn btn-primary btn-block" type="submit" [disabled]="!email.includes('@') || loggingIn"><nl-icon name="mail"/> Pedir nova senha</button>
      </ng-container>
      <div *ngIf="forgotSent" class="alert tip" role="status"><nl-icon name="checkc"/><div><strong>Pedido registrado</strong><p>Se este e-mail tiver uma conta ativa, o administrador já vê o pedido em Configurações &gt; Usuários. Fale com ele para receber a senha temporária.</p></div></div>
      <button type="button" class="link" (click)="forgot=false">Voltar para o login</button>
    </form>
    <form *ngIf="!api.loggedIn() && !forgot" class="login-card" (submit)="$event.preventDefault();login()">
      <img class="login-logo" src="assets/brand/neurolaudos-logo.webp" alt="NeuroLaudos IA — Elaboração assistida de laudos">
      <div><h1>Acesse sua conta</h1><p class="sub">Entre para gerenciar avaliações e laudos.</p></div>
      <div class="field"><label for="lg-email">E-mail</label>
        <div class="with-ico"><nl-icon name="mail"/><input id="lg-email" class="input" type="email" name="email" [(ngModel)]="email" autocomplete="username" placeholder="seu@email.com"></div></div>
      <div class="field"><label for="lg-pw">Senha</label>
        <div class="with-ico"><nl-icon name="lock"/><input id="lg-pw" class="input" [type]="showPw ? 'text' : 'password'" name="password" [(ngModel)]="password" autocomplete="current-password" [readonly]="mfaStep">
          <button type="button" class="pw-eye" (click)="showPw=!showPw" [attr.aria-label]="showPw ? 'Ocultar senha' : 'Mostrar senha'" [attr.aria-pressed]="showPw"><nl-icon [name]="showPw ? 'eyeoff' : 'eye'"/></button></div></div>
      <div *ngIf="mfaStep" class="field"><label for="lg-code">Código do aplicativo autenticador</label>
        <div class="with-ico"><nl-icon name="shield"/><input id="lg-code" class="input mono" name="code" [(ngModel)]="mfaCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000"></div></div>
      <button class="btn btn-primary btn-block" type="submit" [disabled]="!email||!password||loggingIn||(mfaStep && mfaCode.trim().length!==6)"><nl-icon name="login"/> {{loggingIn ? 'Entrando…' : 'Entrar'}}</button>
      <button type="button" class="link forgot" (click)="forgot=true;forgotSent=false">Esqueci minha senha</button>
      <p class="login-meta"><span><nl-icon name="shield"/> Ambiente seguro e confidencial (LGPD)</span></p>
    </form>
    <!-- First access or password reset by the admin: the temporary password is replaced before anything else -->
    <form *ngIf="api.loggedIn() && mustChange()" class="login-card" (submit)="$event.preventDefault();firstPassword()">
      <img class="login-logo" src="assets/brand/neurolaudos-logo.webp" alt="NeuroLaudos IA — Elaboração assistida de laudos">
      <div><h1>Crie a sua senha</h1><p class="sub">Olá, {{api.me()?.name}}. A senha que você recebeu é temporária: escolha uma só sua para continuar.</p></div>
      <div class="field"><label for="fp-cur">Senha temporária</label>
        <div class="with-ico"><nl-icon name="lock"/><input id="fp-cur" class="input" type="password" name="cur" [(ngModel)]="pwTemp" autocomplete="current-password"></div></div>
      <div class="field"><label for="fp-new">Nova senha <small>(mín. 10 caracteres)</small></label>
        <div class="with-ico"><nl-icon name="lock"/><input id="fp-new" class="input" type="password" name="next" [(ngModel)]="pwNew" autocomplete="new-password"></div></div>
      <div class="field"><label for="fp-rep">Repita a nova senha</label>
        <div class="with-ico"><nl-icon name="lock"/><input id="fp-rep" class="input" type="password" name="rep" [(ngModel)]="pwRepeat" autocomplete="new-password"></div>
        <span *ngIf="pwRepeat && pwRepeat!==pwNew" class="caption field-hint-warn">As senhas não são iguais.</span></div>
      <button class="btn btn-primary btn-block" type="submit" [disabled]="!pwTemp || pwNew.length<10 || pwNew!==pwRepeat || loggingIn"><nl-icon name="check"/> {{loggingIn ? 'Salvando…' : 'Salvar e entrar'}}</button>
      <button type="button" class="link" (click)="logout()">Sair</button>
    </form>
  </section>
</div>

<!-- OAuth consent for the ChatGPT plugin (the request id survives the sign-in) -->
<nl-chatgpt-consent *ngIf="oauthRequest && api.loggedIn() && api.me() && !mustChange()" [requestId]="oauthRequest" (done)="clearOauthRequest()"></nl-chatgpt-consent>
<div *ngIf="api.loggedIn() && api.me() && !mustChange()" class="app" [class.nav-collapsed]="navCollapsed()">
  <aside class="nav" aria-label="Navegação principal">
    <button type="button" class="nav-brand" (click)="goHome()" title="NeuroLaudos IA">
      <img class="brand-full" src="assets/brand/neurolaudos-logo-light.webp" alt="NeuroLaudos IA — Elaboração assistida de laudos">
      <img class="brand-mark" src="assets/brand/neurolaudos-mark-light.webp" alt="NeuroLaudos IA">
    </button>
    <nav class="nav-items">
      <button *ngFor="let n of navItems" type="button" class="nav-item" [class.on]="isOn(n.id)" (click)="go(n.id)" [title]="n.label" [attr.aria-current]="isOn(n.id) ? 'page' : null"><nl-icon [name]="n.icon"/><span class="lbl">{{n.label}}</span></button>
    </nav>
    <svg class="nav-wave" viewBox="0 0 256 420" preserveAspectRatio="none" aria-hidden="true"><path d="M0 170 C70 90 170 40 256 0 V420 H0z"/></svg>
    <button type="button" class="nav-item nav-collapse" (click)="toggleNav()" [attr.aria-expanded]="!navCollapsed()" [title]="navCollapsed() ? 'Expandir menu' : 'Recolher menu'">
      <nl-icon name="chevl"/><span class="lbl">{{navCollapsed() ? 'Expandir menu' : 'Recolher menu'}}</span></button>
    <div class="nav-user">
      <span class="avatar" [title]="api.me()?.email || ''">{{initials()}}</span><span class="lbl"><b>{{api.me()?.name || 'NeuroLaudos'}}</b><small>{{roleName()}}</small></span>
      <button type="button" class="nav-logout" (click)="logout()" title="Sair" aria-label="Sair"><nl-icon name="logout"/></button>
    </div>
  </aside>

  <div class="workspace">
    <header class="top">
      <!-- Left: what the open screen puts here (the evaluation: back to the list, patient, status) -->
      <div *ngIf="screen()==='evaluation' && topbar.info?.() as t; else noTitle" class="top-title">
        <button type="button" class="top-back" (click)="goHome()" title="Voltar às avaliações" aria-label="Voltar às avaliações"><nl-icon name="chevl"/> Avaliações</button>
        <span class="top-sep" aria-hidden="true">/</span>
        <b class="top-name">{{t.title}}</b>
        <span *ngIf="t.badge" [class]="'badge ' + t.badge.css">{{t.badge.label}}</span>
        <small *ngIf="t.sub" class="top-sub">{{t.sub}}</small>
      </div>
      <ng-template #noTitle><span class="grow"></span></ng-template>
      <span *ngIf="screen()==='evaluation' && topbar.info?.()" class="grow"></span>
      <button type="button" class="top-search" (click)="paletteOpen=true" title="Buscar (Ctrl+K)" aria-label="Buscar paciente, avaliação ou tela (Ctrl+K)"><nl-icon name="search"/><kbd>Ctrl K</kbd></button>
      <ng-container *ngTemplateOutlet="themeSwitch"></ng-container>
      <div *ngIf="screen()==='evaluation' && timer.evalId()" class="timer" [class.paused]="timer.state()==='paused'" [class.finished]="timer.state()==='finished'" [title]="timerTitle()">
        <span class="tdot"></span>
        <span class="mono tval">{{clock(timer.seconds())}}</span>
        <span class="tlabel">{{timer.state()==='finished' ? 'concluída' : timer.state()==='paused' ? 'pausado' : 'em andamento'}}</span>
        <span *ngIf="timer.stats()?.finished" class="tavg">média {{duration(timer.stats().avg_work_seconds)}}</span>
      </div>
    </header>

    <main class="main">
      <div class="content">
        <!-- an evaluation screen with no evaluation open (e.g. it was deleted elsewhere) falls back to the list instead of a blank page -->
        <nl-dashboard *ngIf="screen()==='home' || (screen()==='evaluation' && !selectedId())" [evaluations]="evaluations()" [query]="search" (queryChange)="search=$event" (open)="open($event)" (create)="go('new')"></nl-dashboard>
        <nl-patients *ngIf="screen()==='patients'" [evaluations]="evaluations()" (open)="open($event)" (create)="go('new')" (created)="onCreated({id: $event, generate: false})"></nl-patients>
        <nl-new-evaluation *ngIf="screen()==='new'" (closed)="goHome()" (created)="onCreated($event)"></nl-new-evaluation>
        <nl-settings *ngIf="screen()==='settings'" (open)="open($event)"></nl-settings>
        <nl-evaluation *ngIf="screen()==='evaluation' && selectedId()" [id]="selectedId()" [autoGenerate]="autoGenerate"
          (changed)="load()" (deleted)="onDeleted()" (generatingChange)="generating=$event" (back)="goHome()"></nl-evaluation>
        <nl-models *ngIf="screen()==='models'"></nl-models>
        <nl-devolutivas *ngIf="screen()==='devolutivas'"></nl-devolutivas>
        <nl-library *ngIf="screen()==='library'"></nl-library>
        <nl-reports *ngIf="screen()==='reports'" [evaluations]="evaluations()"></nl-reports>
      </div>
    </main>
  </div>
</div>

<nl-command-palette *ngIf="paletteOpen && api.loggedIn()" [evaluations]="evaluations()" [screens]="paletteScreens()" (openEvaluation)="open($event)" (goScreen)="goFromPalette($event)" (closed)="paletteOpen=false"></nl-command-palette>
<nl-confirm-dialog></nl-confirm-dialog>
<nl-reading-mode></nl-reading-mode>
<div *ngIf="api.toast()" class="toast" role="status">{{api.toast()}}</div>
`,
  styles: [`
:host{display:block;height:calc(100vh / var(--zoom, 1))}
nl-icon{--ico-size:16px}

/* ---------- Login ---------- */
.login{position:relative;display:grid;grid-template-columns:1fr minmax(420px,42%);min-height:calc(100vh / var(--zoom, 1));background:var(--sidebar-deep);overflow:hidden}
.login-waves{position:absolute;inset:0;width:100%;height:100%}
.login-waves .w1{fill:var(--sidebar-bg)}.login-waves .w2{fill:var(--sidebar-active);opacity:.35}
.pitch{position:relative;z-index:1;color:var(--sidebar-text);padding:clamp(72px,calc(13vh / var(--zoom, 1)),180px) 64px 48px clamp(40px,calc(7vw / var(--zoom, 1)),160px);max-width:760px}
.pitch .bar{width:96px;height:6px;border-radius:var(--radius-pill);background:var(--brand-mint);margin-bottom:36px}
.pitch h1{font-size:clamp(40px,calc(4.4vw / var(--zoom, 1)),64px);line-height:1;font-weight:700;letter-spacing:-.01em}
.pitch h2{margin-top:14px;font-size:clamp(20px,calc(2vw / var(--zoom, 1)),28px);line-height:1.25;font-weight:400}
.pitch p{margin:24px 0 32px;font-size:16px;line-height:1.55;color:var(--sidebar-muted);max-width:520px}
.pitch ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:18px}
.pitch li{display:flex;gap:16px;align-items:center}
.pitch .fi{width:52px;height:52px;border-radius:var(--radius-lg);background:var(--sidebar-active);display:grid;place-items:center;flex:none;--ico-size:24px}
.pitch li b{display:block;font-size:17px;font-weight:600}.pitch li small{font-size:14px;color:var(--sidebar-muted)}
.login-side{position:relative;z-index:1;display:grid;place-items:center;padding:24px}
.login-card{width:min(440px,100%);background:var(--card);border-radius:var(--radius-xl);padding:40px 44px;box-shadow:0 24px 60px rgba(0,0,0,.25);display:flex;flex-direction:column;gap:18px}
.login-logo{width:240px;max-width:100%;height:auto;margin-bottom:6px}
:host-context([data-theme="dark"]) .login-logo{content:url('/assets/brand/neurolaudos-logo-light.webp')}
.login-card h1{font-size:26px;font-weight:700;color:var(--brand-ink)}
.login-card .forgot{align-self:center;font-size:13px}
.login-card .sub{color:var(--text-3);font-size:13.5px;margin-top:4px}
.with-ico{position:relative;display:flex;align-items:center}
.with-ico>nl-icon{position:absolute;left:12px;color:var(--text-3);--ico-size:18px;pointer-events:none}
.with-ico .input{padding-left:40px}
.with-ico .input:focus{padding-left:39.5px}
.pw-eye{position:absolute;right:6px;width:34px;height:34px;border:0;border-radius:var(--radius-sm);background:none;color:var(--text-3);display:grid;place-items:center;cursor:pointer;--ico-size:18px}
.pw-eye:hover{background:var(--chip)}
.btn-block{width:100%;height:48px;font-size:15px}
.login-meta{display:flex;justify-content:center;font-size:12px;color:var(--text-3);border-top:1px solid var(--divider);padding-top:14px}
.login-meta span{display:inline-flex;gap:6px;align-items:center}
@media(max-width:900px){.login{grid-template-columns:1fr}.pitch{display:none}}

/* ---------- App shell ---------- */
.app{display:grid;grid-template-columns:248px minmax(0,1fr);height:calc(100vh / var(--zoom, 1));background:var(--bg);transition:grid-template-columns .2s ease}
.app.nav-collapsed{grid-template-columns:76px minmax(0,1fr)}
.nav{position:relative;overflow:hidden;background:var(--sidebar-bg);color:var(--sidebar-text);display:flex;flex-direction:column;gap:4px;padding:20px 14px 14px;margin:12px 0 12px 12px;border-radius:var(--radius-xl)}
.nav-brand{position:relative;z-index:1;display:flex;align-items:center;background:none;border:0;padding:0 8px 18px;cursor:pointer}
.brand-full{width:100%;max-width:200px;height:auto;display:block}
.brand-mark{display:none;width:42px;height:auto}
.nav-items{display:flex;flex-direction:column;gap:4px;position:relative;z-index:1}
.nav-item{position:relative;z-index:1;display:flex;align-items:center;gap:12px;height:42px;padding:0 14px;border:0;border-radius:var(--radius-sm);background:none;color:var(--sidebar-text);font:500 14.5px var(--font);cursor:pointer;text-align:left;white-space:nowrap;--ico-size:20px}
.nav-item:hover{background:rgba(255,255,255,.07)}
.nav-item.on{background:var(--sidebar-active);font-weight:600}
.nav-item:focus-visible,.nav-brand:focus-visible,.nav-logout:focus-visible{outline:2px solid var(--brand-mint);outline-offset:2px}
.nav-wave{position:absolute;left:0;right:0;bottom:0;height:45%;width:100%}
.nav-wave path{fill:var(--sidebar-deep)}
.nav-collapse{margin-top:auto;color:var(--sidebar-muted);font-size:13.5px}
.nav-collapse nl-icon{transition:transform .2s}
.nav-user{position:relative;z-index:1;display:flex;align-items:center;gap:10px;padding:10px 6px 2px;border-top:1px solid rgba(255,255,255,.08);margin-top:4px}
.avatar{width:36px;height:36px;border-radius:50%;background:var(--brand-mint);color:#06231d;display:grid;place-items:center;font:600 13px var(--font);flex:none}
.nav-user .lbl b{display:block;font-size:14px}.nav-user .lbl small{color:var(--sidebar-muted);font-size:12px}
.nav-logout{margin-left:auto;width:34px;height:34px;border:0;border-radius:var(--radius-sm);background:none;color:var(--sidebar-muted);display:grid;place-items:center;cursor:pointer;--ico-size:18px}
.nav-logout:hover{background:rgba(255,255,255,.08);color:var(--sidebar-text)}
.nav-collapsed .nav{padding:20px 10px 14px}
.nav-collapsed .lbl,.nav-collapsed .brand-full{display:none}
.nav-collapsed .brand-mark{display:block}
.nav-collapsed .nav-brand{justify-content:center;padding:0 0 18px}
.nav-collapsed .nav-item{justify-content:center;padding:0;gap:0}
.nav-collapsed .nav-collapse nl-icon{transform:rotate(180deg)}
.nav-collapsed .nav-user{flex-direction:column;padding:10px 0 2px;gap:6px}
.nav-collapsed .nav-logout{margin-left:0}

.workspace{display:flex;flex-direction:column;min-width:0;height:calc(100vh / var(--zoom, 1))}
.top{height:48px;flex:none;display:flex;align-items:center;gap:10px;padding:0 12px}
.top .grow{flex:1}
.top-title{display:flex;align-items:center;gap:8px;min-width:0;flex:0 1 auto}
.top-back{display:inline-flex;align-items:center;gap:2px;height:30px;padding:0 8px 0 4px;border:0;border-radius:6px;background:none;color:var(--primary-text);font:600 13px var(--font);cursor:pointer;--ico-size:15px}
.top-back:hover{background:var(--chip)}
.top-sep{color:var(--text-3)}
.top-name{font-size:16px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 0 auto;max-width:340px}
.top-sub{flex:0 100 auto;font-size:12.5px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.top-search{display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 10px;border:1px solid var(--border-card);border-radius:var(--radius-pill);background:var(--card);color:var(--text-2);cursor:pointer;--ico-size:17px}
.top-search:hover{border-color:var(--primary);color:var(--text)}
.top-search kbd{white-space:nowrap;font:500 11px var(--mono);color:var(--text-3);background:var(--chip);border:1px solid var(--border-card);border-radius:5px;padding:1px 5px}
@media(max-width:1100px){.top-sub{display:none}.top-search kbd{display:none}}
.gsearch{position:relative;display:flex;align-items:center;flex:0 1 560px;min-width:200px}
.gsearch>nl-icon{position:absolute;left:12px;color:var(--text-3);--ico-size:18px;pointer-events:none}
.gsearch .input{height:40px;padding-left:40px;border-color:var(--border-card)}
.gsearch .input:focus{padding-left:39.5px}
.gsearch kbd{position:absolute;right:8px;font:500 11.5px var(--mono);color:var(--text-3);background:var(--chip);border:1px solid var(--border-card);border-radius:6px;padding:2px 6px}
@media(max-width:1280px){.gsearch kbd{display:none}}
.icon-btn{width:38px;height:38px;border:1px solid var(--border-card);border-radius:var(--radius-sm);background:var(--card);color:var(--text-2);display:grid;place-items:center;cursor:pointer;--ico-size:18px}
.icon-btn:hover{background:var(--chip)}
.icon-btn:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.timer{display:flex;align-items:center;gap:8px;height:36px;padding:0 14px;border-radius:var(--radius-pill);background:var(--primary-soft-2);border:1px solid var(--primary-border);font-size:12.5px;color:var(--primary-text);cursor:default;white-space:nowrap}
.tdot{width:9px;height:9px;border-radius:50%;background:var(--brand-mint);animation:blink 1.6s infinite}
.tval{font-size:15px;font-weight:600;color:var(--text)}
.tavg{color:var(--text-3);border-left:1px solid var(--primary-border-2);padding-left:8px}
.timer.paused{background:var(--chip);border-color:var(--border-input);color:var(--text-3)}
.timer.paused .tdot{background:var(--warn-dot);animation:none}
.timer.finished .tdot{background:var(--ok-dot);animation:none}
@keyframes blink{50%{opacity:.3}}
@media(prefers-reduced-motion:reduce){.tdot{animation:none}}

.main{flex:1;min-height:0;overflow:auto;padding:0 10px 24px}
.content{margin:0 auto}

@media(max-width:1180px){
  .app,.app.nav-collapsed{grid-template-columns:76px minmax(0,1fr)}
  .nav{padding:20px 10px 14px}
  .lbl,.brand-full,.nav-collapse{display:none}
  .brand-mark{display:block}
  .nav-brand{justify-content:center;padding:0 0 18px}
  .nav-item{justify-content:center;padding:0;gap:0}
  .nav-user{flex-direction:column;padding:10px 0 2px;gap:6px}
  .nav-logout{margin-left:0}
}
@media(max-width:900px){
  .main{padding:0 12px 16px}
  .top{padding:0 12px}
  .tlabel,.tavg{display:none}
  .theme-switch button{padding:0 9px}
  .zoom-switch .zval{display:none}
}
`],
})
export class AppComponent {
  api = inject(Api);
  timer = inject(WorkTimer);
  theme = inject(ThemeService);
  STATUS = STATUS; brDate = brDate; clock = clock; duration = duration;
  email = ''; password = ''; showPw = false; loggingIn = false;
  pwTemp = ''; pwNew = ''; pwRepeat = ''; forgot = false; forgotSent = false; mfaStep = false; mfaCode = '';

  // Open screen/evaluation survive a page reload (kept per browser tab).
  private saved = (() => { try { return JSON.parse(sessionStorage.getItem('nl_view') || '{}'); } catch { return {}; } })();
  screen = signal<Screen>(SCREENS.includes(this.saved.screen) ? (this.saved.screen === 'evaluation' && !this.saved.id ? 'home' : this.saved.screen) : 'home');
  navItems: {id: Screen; label: string; icon: string}[] = [
    {id: 'home', label: 'Avaliações', icon: 'home'}, {id: 'patients', label: 'Pacientes', icon: 'users'},
    {id: 'models', label: 'Modelos de laudo', icon: 'doc'}, {id: 'library', label: 'Biblioteca de testes', icon: 'lib'},
    {id: 'devolutivas', label: 'Devolutivas', icon: 'calendar'},
    {id: 'reports', label: 'Relatórios', icon: 'chart'}, {id: 'settings', label: 'Configurações', icon: 'gear'}];
  evaluations = signal<any[]>([]);
  navCollapsed = signal((() => { try { return localStorage.getItem('nl_nav_collapsed') === '1'; } catch { return false; } })());
  selectedId = signal<string>(this.saved.id || '');
  search = '';
  generating = false; autoGenerate = false;
  /** ?autorizar_chatgpt=<id> from the OAuth authorize redirect: kept for this tab and removed from the address bar. */
  oauthRequest = (() => { try { const q = new URLSearchParams(location.search); const id = q.get('autorizar_chatgpt');
    if (id && /^[A-Za-z0-9_-]{20,80}$/.test(id)) { sessionStorage.setItem('nl_oauth_request', id); q.delete('autorizar_chatgpt'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash); }
    return sessionStorage.getItem('nl_oauth_request') || ''; } catch { return ''; } })();
  clearOauthRequest() { this.oauthRequest = ''; try { sessionStorage.removeItem('nl_oauth_request'); } catch {} }


  private wheelZoom = inject(WheelZoom);
  private zone = inject(NgZone);
  constructor() {
    installTooltips();
    // Ctrl + wheel anywhere else: the app's screen size (same as A- / A+), never the browser zoom
    this.wheelZoom.register(dir => { this.zone.run(() => { if (this.theme.canZoom(dir)) this.theme.stepZoom(dir); }); this.wheelZoom.hud('Tela ' + this.theme.zoom() + '%'); return true; });
    if (this.api.loggedIn()) this.api.loadMe().then(() => { if (!this.mustChange()) this.load(); });
    effect(() => { try { sessionStorage.setItem('nl_view', JSON.stringify({screen: this.screen(), id: this.selectedId()})); } catch {} });
  }

  toggleNav() { const v = !this.navCollapsed(); this.navCollapsed.set(v); try { localStorage.setItem('nl_nav_collapsed', v ? '1' : '0'); } catch {} }

  async login() {
    this.loggingIn = true;
    try {
      if (await this.api.login(this.email, this.password, this.mfaStep ? this.mfaCode : undefined) === 'mfa') { this.mfaStep = true; setTimeout(() => (document.querySelector('#lg-code') as HTMLInputElement | null)?.focus()); return; }
      this.mfaStep = false; this.mfaCode = '';
      if (this.mustChange()) this.pwTemp = this.password;
      this.password = ''; this.showPw = false;
      if (!this.mustChange()) await this.load();
    } catch {} finally { this.loggingIn = false; }
  }
  async requestReset() {
    this.loggingIn = true;
    try { await this.api.req('POST', '/password-requests', {email: this.email}); this.forgotSent = true; } catch {} finally { this.loggingIn = false; }
  }
  mustChange() { return !!this.api.me()?.must_change_password; }
  roleName() { const r = this.api.me()?.role; return r ? ROLE_NAMES[r] : ''; }
  initials() { const n = (this.api.me()?.name || 'NeuroLaudos').trim().split(/\s+/); return ((n[0]?.[0] || '') + (n.length > 1 ? n[n.length - 1][0] : '')).toUpperCase(); }
  async firstPassword() {
    this.loggingIn = true;
    try {
      const r = await this.api.req<any>('PUT', '/me/password', {current: this.pwTemp, next: this.pwNew});
      this.api.signedIn(r); this.pwTemp = this.pwNew = this.pwRepeat = '';
      this.api.notify('Senha criada. Bem-vinda(o)!'); await this.load();
    } catch {} finally { this.loggingIn = false; }
  }
  logout() { if (this.blocked()) return; this.timer.stop(); this.api.logout(); this.selectedId.set(''); this.screen.set('home'); try { sessionStorage.removeItem('nl_view'); } catch {} }
  async load() {
    try {
      const list = await this.api.req<any[]>('GET', '/evaluations');
      this.evaluations.set(list);
      if (this.selectedId() && !list.some(e => e.id === this.selectedId())) this.selectedId.set('');
    } catch {}
  }

  timerTitle() {
    const st = this.timer.stats(), s = this.timer.state();
    const head = s === 'finished' ? 'Tempo total de trabalho nesta avaliação (concluída).' : s === 'paused' ? 'Pausado: ' + this.timer.pauseReason() + '.' : 'Tempo de trabalho nesta avaliação.';
    const avg = st?.finished ? ` Média das ${st.finished} avaliações concluídas: ${duration(st.avg_work_seconds)} de trabalho, ${duration(st.avg_calendar_seconds)} do início ao fim.` : '';
    return head + ' Conta só com a avaliação aberta; pausa com a aba escondida ou após 5 minutos sem uso.' + avg;
  }
  private blocked() { if (this.generating) { this.api.notify('Aguarde a geração terminar.'); return true; } return false; }
  go(s: Screen) { if (this.blocked()) return; this.autoGenerate = false; if (s !== 'evaluation') this.timer.stop(); this.screen.set(s); }
  goHome() { this.go('home'); }
  isOn(id: Screen) { return this.screen() === id || (id === 'home' && (this.screen() === 'evaluation' || this.screen() === 'new')); }
  globalSearch(v: string) { this.search = v; if (this.screen() !== 'home' && v.trim()) this.go('home'); }
  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent) { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && this.api.loggedIn() && this.api.me() && !this.mustChange()) { e.preventDefault(); this.paletteOpen = !this.paletteOpen; } }
  /** Ctrl+K search (patients, evaluations and screens). */
  paletteOpen = false;
  topbar = inject(TopbarService);
  paletteScreens() { return [{id: 'new', label: 'Nova avaliação', icon: 'plus'}, ...this.navItems]; }
  goFromPalette(id: string) { this.go(id as Screen); }
  open(id: string) { if (this.blocked()) return; this.autoGenerate = false; rememberRecent(id); this.selectedId.set(id); this.screen.set('evaluation'); }
  async onCreated(e: {id: string; generate: boolean}) { await this.load(); this.autoGenerate = e.generate; this.selectedId.set(e.id); this.screen.set('evaluation'); }
  async onDeleted() { this.timer.stop(); this.selectedId.set(''); this.screen.set('home'); await this.load(); }
}
