import {Component, computed, effect, inject, signal} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Api} from './api.service';
import {EvalStatus, STATUS, brDate, fold, listStatus} from './shared';
import {NewEvaluationComponent} from './new-evaluation.component';
import {EvaluationComponent} from './evaluation.component';
import {SettingsComponent} from './settings.component';
import {WorkTimer, clock, duration} from './work-timer.service';

type Screen = 'evaluation' | 'new' | 'settings';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, NewEvaluationComponent, EvaluationComponent, SettingsComponent],
  template: `
<!-- Login -->
<div *ngIf="!api.loggedIn()" class="login-wrap">
  <form class="card login" (submit)="$event.preventDefault();login()">
    <div class="brand"><span class="logo">NL</span><div><strong>NeuroLaudos IA</strong><span>Elaboração assistida de laudos</span></div></div>
    <div class="field"><label>E-mail</label><input class="input" type="email" name="email" [(ngModel)]="email" autocomplete="username"></div>
    <div class="field"><label>Senha</label><input class="input" type="password" name="password" [(ngModel)]="password" autocomplete="current-password"></div>
    <button class="btn btn-primary" type="submit" [disabled]="!email||!password">Entrar</button>
  </form>
</div>

<ng-container *ngIf="api.loggedIn()">
  <header class="top">
    <button class="brand" type="button" (click)="goHome()"><span class="logo">NL</span><div><strong>NeuroLaudos IA</strong><span>Elaboração assistida de laudos</span></div></button>
    <nav>
      <div *ngIf="screen()==='evaluation' && timer.evalId()" class="timer" [class.paused]="timer.state()==='paused'" [class.finished]="timer.state()==='finished'" [title]="timerTitle()">
        <span class="tdot"></span>
        <span class="mono tval">{{clock(timer.seconds())}}</span>
        <span class="tlabel">{{timer.state()==='finished' ? 'concluída' : timer.state()==='paused' ? 'pausado' : 'em andamento'}}</span>
        <span *ngIf="timer.stats()?.finished" class="tavg">média {{duration(timer.stats().avg_work_seconds)}}</span>
      </div>
      <button class="btn-text" [class.active]="screen()==='settings'" (click)="go('settings')">⚙ Configurações</button>
      <button class="btn-text" (click)="logout()">⎋ Sair</button>
    </nav>
  </header>

  <div class="shell">
    <aside class="side">
      <button class="new-btn" [class.active]="screen()==='new'" (click)="go('new')">+ Nova avaliação</button>
      <input class="search" [(ngModel)]="search" placeholder="Buscar paciente…" (ngModelChange)="searchSig.set($event)">
      <div class="chips">
        <button *ngFor="let f of filters" class="chip" [class.on]="filter()===f.id" (click)="filter.set(f.id)">{{f.label}} {{count(f.id)}}</button>
      </div>
      <div class="list">
        <p *ngIf="!visible().length" class="caption empty">{{evaluations().length?'Nenhuma avaliação encontrada.':'Nenhuma avaliação ainda.'}}</p>
        <button *ngFor="let e of visible()" class="item" [class.active]="screen()==='evaluation'&&e.id===selectedId()" (click)="open(e.id)">
          <span class="name">{{e.patient_name}}</span>
          <span class="meta"><span>{{e.age ? e.age + ' · ' : ''}}{{brDate(e.created_at)}}</span><span [class]="'badge '+STATUS[st(e)].css">{{STATUS[st(e)].label}}</span></span>
        </button>
      </div>
    </aside>

    <main class="main">
      <div class="content">
        <nl-new-evaluation *ngIf="screen()==='new'" (closed)="goHome()" (created)="onCreated($event)"></nl-new-evaluation>
        <nl-settings *ngIf="screen()==='settings'"></nl-settings>
        <nl-evaluation *ngIf="screen()==='evaluation' && selectedId()" [id]="selectedId()" [autoGenerate]="autoGenerate"
          (changed)="load()" (deleted)="onDeleted()" (generatingChange)="generating=$event"></nl-evaluation>
        <div *ngIf="screen()==='evaluation' && !selectedId()" class="card empty-state">
          <h2>Comece por aqui</h2>
          <p class="muted">Crie uma avaliação ou abra uma da lista. Depois: envie os dois arquivos, gere com a IA, confira e baixe o Word.</p>
          <button class="btn btn-primary" (click)="go('new')">+ Nova avaliação</button>
        </div>
      </div>
    </main>
  </div>
</ng-container>

<div *ngIf="api.toast()" class="toast">{{api.toast()}}</div>
`,
  styles: [`
:host{display:block;height:100vh}
.top{height:60px;background:#fff;border-bottom:1px solid var(--border-card);padding:0 24px;display:flex;align-items:center;justify-content:space-between}
.brand{display:flex;align-items:center;gap:10px;background:none;border:0;padding:0;cursor:pointer;text-align:left;font-family:var(--font)}
.brand strong{display:block;font-size:15px;font-weight:700;color:var(--text)}
.brand span{display:block;font-size:11px;color:var(--caption)}
.logo{width:30px;height:30px;border-radius:8px;background:var(--primary);color:#fff!important;font-size:13px!important;font-weight:700;display:flex!important;align-items:center;justify-content:center;flex:none}
nav{display:flex;gap:4px;align-items:center}
.timer{display:flex;align-items:center;gap:8px;height:34px;padding:0 12px;margin-right:8px;border-radius:20px;background:var(--primary-soft);border:1px solid var(--primary-border);font-size:12px;color:var(--primary-text);cursor:default}
.tdot{width:8px;height:8px;border-radius:50%;background:var(--ok-dot);animation:blink 1.6s infinite}
.tval{font-size:14px;font-weight:600;color:var(--text)}
.tavg{color:var(--caption);border-left:1px solid var(--primary-border);padding-left:8px}
.timer.paused{background:var(--chip);border-color:var(--border-input);color:var(--text-3)}
.timer.paused .tdot{background:var(--warn-dot);animation:none}
.timer.finished .tdot{background:var(--primary);animation:none}
@keyframes blink{50%{opacity:.3}}
@media(max-width:900px){.tlabel,.tavg{display:none}}
.shell{display:flex;height:calc(100vh - 60px)}
.side{width:300px;flex:none;background:#fff;border-right:1px solid var(--border-card);padding:18px 16px;display:flex;flex-direction:column;gap:14px;overflow:hidden}
.new-btn{height:42px;border:0;border-radius:9px;background:var(--primary);color:#fff;font:600 14px var(--font);cursor:pointer;flex:none}
.new-btn:hover,.new-btn.active{background:var(--primary-hover)}
.search{height:38px;flex:none;border:1px solid var(--search-border);border-radius:8px;padding:0 12px;font:400 13.5px var(--font);outline:none;color:var(--text)}
.search:focus{border-color:var(--primary)}
.search::placeholder{color:var(--placeholder)}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{font:500 12px var(--font);padding:4px 10px;border-radius:20px;border:0;background:var(--chip);color:var(--text-2);cursor:pointer}
.chip.on{background:var(--text);color:#fff}
.list{flex:1;overflow:auto;display:flex;flex-direction:column;gap:2px;margin:0 -4px;padding:0 4px}
.item{display:flex;flex-direction:column;gap:5px;padding:11px 12px;border-radius:9px;border:1px solid transparent;background:none;cursor:pointer;text-align:left;font-family:var(--font)}
.item:hover{background:#f6f9f8}
.item.active{background:var(--primary-soft);border-color:var(--primary-border)}
.name{font-size:13.5px;font-weight:600;color:var(--text);line-height:1.3}
.meta{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--caption)}
.empty{padding:8px 4px}
.main{flex:1;overflow:auto;background:var(--bg)}
.content{max-width:1280px;margin:0 auto;padding:26px 32px}
.empty-state{padding:48px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px}
.empty-state h2{font-size:20px}
.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
.login{width:380px;max-width:100%;padding:28px;display:flex;flex-direction:column;gap:16px}
.login .brand{cursor:default;margin-bottom:6px}
@media(max-width:900px){.shell{flex-direction:column;height:auto}.side{width:auto;border-right:0;border-bottom:1px solid var(--border-card)}.list{max-height:260px}.content{padding:18px 16px}}
`],
})
export class AppComponent {
  api = inject(Api);
  timer = inject(WorkTimer);
  STATUS = STATUS; brDate = brDate; clock = clock; duration = duration;
  email = ''; password = '';

  // Open screen/evaluation survive a page reload (kept per browser tab).
  private saved = (() => { try { return JSON.parse(sessionStorage.getItem('nl_view') || '{}'); } catch { return {}; } })();
  screen = signal<Screen>(['evaluation', 'new', 'settings'].includes(this.saved.screen) ? this.saved.screen : 'evaluation');
  evaluations = signal<any[]>([]);
  selectedId = signal<string>(this.saved.id || '');
  filter = signal<'all' | EvalStatus>('all');
  search = ''; searchSig = signal('');
  generating = false; autoGenerate = false;
  filters: {id: 'all' | EvalStatus; label: string}[] = [{id: 'all', label: 'Todas'}, {id: 'rs', label: 'Rascunho'}, {id: 'rv', label: 'Revisão'}, {id: 'ap', label: 'Aprovadas'}];

  visible = computed(() => {
    const q = fold(this.searchSig().trim()), f = this.filter();
    return this.evaluations().filter(e => (!q || fold(e.patient_name).includes(q)) && (f === 'all' || listStatus(e) === f));
  });

  constructor() {
    if (this.api.loggedIn()) this.load();
    effect(() => { try { sessionStorage.setItem('nl_view', JSON.stringify({screen: this.screen(), id: this.selectedId()})); } catch {} });
  }

  st(e: any) { return listStatus(e); }
  count(f: 'all' | EvalStatus) { return f === 'all' ? this.evaluations().length : this.evaluations().filter(e => listStatus(e) === f).length; }

  async login() { try { await this.api.login(this.email, this.password); this.password = ''; await this.load(); } catch {} }
  logout() { if (this.blocked()) return; this.timer.stop(); this.api.logout(); this.selectedId.set(''); this.screen.set('evaluation'); try { sessionStorage.removeItem('nl_view'); } catch {} }
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
  goHome() { this.go('evaluation'); }
  open(id: string) { if (this.blocked()) return; this.autoGenerate = false; this.selectedId.set(id); this.screen.set('evaluation'); }
  async onCreated(e: {id: string; generate: boolean}) { await this.load(); this.autoGenerate = e.generate; this.selectedId.set(e.id); this.screen.set('evaluation'); }
  async onDeleted() { this.timer.stop(); this.selectedId.set(''); await this.load(); }
}
