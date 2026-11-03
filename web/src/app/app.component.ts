import {Component, ElementRef, ViewChild, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {HttpClient, HttpHeaders} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import {renderAsync} from 'docx-preview';

type GenState = 'pending' | 'running' | 'done' | 'error' | 'skipped';

const SECTIONS = [
  {id: 'demanda', name: 'Descrição da demanda'},
  {id: 'anamnesis', name: 'Anamnese'},
  {id: 'inteligencia', name: 'Habilidades intelectuais'},
  {id: 'percepcao', name: 'Percepção'},
  {id: 'memoria', name: 'Memória e aprendizagem'},
  {id: 'atencao', name: 'Processos atencionais'},
  {id: 'funcoes_executivas', name: 'Funções executivas'},
  {id: 'comportamento', name: 'Comportamento'},
  {id: 'comportamento_diva', name: 'Comportamento / DIVA'},
  {id: 'conclusao', name: 'Conclusão'},
  {id: 'recomendacoes', name: 'Indicações e recomendações'},
];

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
<header>
  <div class="brand"><strong>🧠 NeuroLaudos IA</strong><span class="muted">Elaboração assistida de laudos</span></div>
  <div class="row" *ngIf="loggedIn">
    <button class="ghost" [class.selected]="view==='settings'" (click)="openSettings()">⚙ Configurações</button>
    <button class="ghost" (click)="logout()">Sair</button>
  </div>
</header>

<!-- Login -->
<main *ngIf="!loggedIn" class="login">
  <section class="card">
    <h1>Entrar</h1>
    <label>E-mail</label><input [(ngModel)]="email" type="email" autocomplete="username">
    <label>Senha</label><input [(ngModel)]="password" type="password" autocomplete="current-password" (keyup.enter)="login()">
    <button style="margin-top:18px;width:100%" (click)="login()">Entrar</button>
    <button class="link" (click)="setup()">Primeiro acesso: criar administrador</button>
    <p class="warning">{{message}}</p>
  </section>
</main>

<div *ngIf="loggedIn" class="app">
  <!-- Left: evaluations -->
  <aside>
    <button style="width:100%" (click)="showNew=!showNew">{{showNew?'Cancelar':'+ Nova avaliação'}}</button>
    <div *ngIf="showNew" class="new-form">
      <label>Nome do paciente</label><input [(ngModel)]="patientName" (keyup.enter)="create()">
      <label>Data de nascimento</label><input type="date" [(ngModel)]="birthDate">
      <button style="margin-top:12px;width:100%" [disabled]="patientName.trim().length<2" (click)="create()">Criar</button>
    </div>
    <p class="aside-title">Avaliações ({{evaluations.length}})</p>
    <p *ngIf="!evaluations.length" class="muted small">Nenhuma avaliação ainda.</p>
    <div *ngFor="let x of evaluations" class="eval-item" [class.active]="x.id===evaluationId && view==='evaluation'" (click)="select(x.id)">
      <div class="eval-info"><strong>{{x.patient_name}}</strong><span class="small muted">{{x.created_at | date:'dd/MM/yyyy'}}</span></div>
      <span [class]="'badge '+x.status">{{statusLabel(x.status)}}</span>
      <button class="icon" title="Excluir" (click)="$event.stopPropagation();removeEvaluation(x)">🗑</button>
    </div>
  </aside>

  <main>
    <!-- Empty state -->
    <section *ngIf="view==='home'" class="card empty">
      <h2>Comece por aqui</h2>
      <p class="muted">Crie uma avaliação à esquerda ou abra uma existente. Depois: envie os dois arquivos, gere com a IA, confira a pré-visualização e baixe o Word.</p>
    </section>

    <!-- Evaluation workflow -->
    <ng-container *ngIf="view==='evaluation' && current">
      <div class="title-row">
        <h1>{{current.patient_name}}</h1>
        <span [class]="'badge '+current.status">{{statusLabel(current.status)}}</span>
      </div>

      <!-- 1. Files -->
      <section class="card step">
        <h2><span class="num" [class.ok]="docsReady()">1</span> Arquivos</h2>
        <div class="grid">
          <div *ngFor="let d of dropSlots" class="drop" [class.over]="dragOver===d.kind" [class.done]="docName(d.kind)" [class.busy]="uploading===d.kind" [class.disabled]="locked()"
               (click)="!locked()&&picker.click()" (dragover)="$event.preventDefault();dragOver=d.kind" (dragleave)="dragOver=''" (drop)="onDrop($event,d.kind)">
            <input #picker type="file" accept=".docx" hidden (change)="onPick($event,d.kind)">
            <div class="drop-icon">{{uploading===d.kind?'⏳':docName(d.kind)?'✅':'📄'}}</div>
            <strong>{{d.title}}</strong>
            <span *ngIf="docName(d.kind)" class="filename">{{docName(d.kind)}}</span>
            <span class="drop-cta">{{uploading===d.kind?'Enviando…':docName(d.kind)?'Arraste outro para trocar':'Arraste o DOCX aqui ou clique'}}</span>
          </div>
        </div>
        <p *ngIf="missingMarkers().length && inspection" class="warning small">Sem lugar no arquivo base para: {{missingMarkers().join(', ')}}. Essas partes serão ignoradas.</p>
      </section>

      <!-- 2. Generate -->
      <section class="card step" [class.dim]="!docsReady()">
        <h2><span class="num" [class.ok]="hasDrafts()">2</span> Gerar texto com IA</h2>
        <div *ngIf="privacy && !locked()" class="privacy">
          <div class="privacy-head"><strong>🔒 Dados ocultados antes de enviar à IA</strong><span class="muted small">A IA recebe só os marcadores. No laudo, os dados reais voltam sozinhos.</span></div>
          <div class="chips">
            <span *ngFor="let t of privacyList()" class="chip" [class.off]="t.ignored" [title]="t.ignored?'Não será ocultado. Clique para ocultar.':'Clique para NÃO ocultar'" (click)="toggleTerm(t)">
              <span class="ph">{{t.placeholder||'—'}}</span> {{t.value}} <b>{{t.ignored?'+':'×'}}</b></span>
            <span *ngFor="let x of privacy.extra" class="chip extra" title="Remover" (click)="removeExtra(x.value)"><span class="ph">{{x.placeholder}}</span> {{x.value}} <b>×</b></span>
          </div>
          <div class="row" style="margin-top:10px">
            <input style="flex:1;min-width:200px" [(ngModel)]="newTerm" placeholder="Faltou algum nome, apelido, escola? Digite e clique em Ocultar" (keyup.enter)="addExtra()">
            <button class="secondary" [disabled]="newTerm.trim().length<2" (click)="addExtra()">Ocultar</button>
          </div>
        </div>
        <ng-container *ngIf="!locked()">
          <div class="row">
            <button [disabled]="!docsReady()||generating||!aiReady" (click)="generateAll()">{{generating?'Gerando… aguarde':hasDrafts()?'✨ Gerar tudo de novo':'✨ Gerar laudo com IA'}}</button>
            <span class="muted small" *ngIf="!aiReady">IA pela API desligada. Ative em Configurações ou use o modo manual ao editar os textos.</span>
          </div>
          <div *ngIf="progressKeys().length" class="progress">
            <span *ngFor="let s of progressKeys()" [class]="'pill '+gen[s.id]">{{icon(gen[s.id])}} {{s.name}}</span>
          </div>
        </ng-container>
        <div *ngIf="runUsage.total_tokens || usage?.calls" class="cost">
          <div *ngIf="runUsage.total_tokens"><span class="muted small">Esta geração</span><strong>{{brl(runUsage.cost_brl)}}</strong><span class="small">{{int(runUsage.total_tokens)}} tokens ({{int(runUsage.input_tokens)}} entrada • {{int(runUsage.output_tokens)}} saída)</span></div>
          <div *ngIf="usage?.calls"><span class="muted small">Total desta avaliação</span><strong>{{brl(usage.cost_brl)}}</strong><span class="small">{{int(usage.total_tokens)}} tokens em {{usage.calls}} chamadas</span></div>
          <p class="muted small">Valores estimados pela tabela de preços do modelo e câmbio de {{brl(usdBrl)}}/US$. O valor exato fica no painel da OpenAI.</p>
        </div>
        <p *ngIf="locked()" class="muted">Avaliação aprovada: textos travados.</p>
      </section>

      <!-- 3. Review -->
      <section class="card step" [class.dim]="!hasDrafts()">
        <div class="review-head">
          <h2><span class="num" [class.ok]="current.status==='approved'">3</span> Conferir e baixar</h2>
          <div class="tabs">
            <button [class.selected]="reviewTab==='preview'" (click)="showPreview()">👁 Pré-visualizar</button>
            <button [class.selected]="reviewTab==='edit'" (click)="reviewTab='edit'">✏️ Editar textos</button>
          </div>
        </div>

        <div [hidden]="reviewTab!=='preview'">
          <p *ngIf="previewLoading" class="muted">Montando pré-visualização…</p>
          <div #previewBox class="preview"></div>
        </div>

        <div *ngIf="reviewTab==='edit'">
          <details *ngFor="let s of availableSections()" class="sec" [open]="openSection===s.id" (toggle)="onToggle($event,s.id)">
            <summary><span>{{s.name}}</span><span class="small muted">{{textOf(s.id)?statusLabel(statusOf(s.id)):'vazio'}}</span></summary>
            <p *ngFor="let w of warningsOf(s.id)" class="warning small">⚠ {{w}}</p>
            <textarea [(ngModel)]="drafts[s.id]" [disabled]="locked()" placeholder="Sem texto. Gere com a IA ou use o modo manual abaixo."></textarea>
            <div class="row" *ngIf="!locked()">
              <button [disabled]="drafts[s.id]===textOf(s.id)||!(drafts[s.id]||'').trim()" (click)="saveSection(s.id)">Salvar</button>
              <button class="link" (click)="copyPrompt(s.id)">Modo manual: copiar pedido para o ChatGPT</button>
              <button class="link" (click)="pasteAnswer(s.id)">Colar resposta</button>
            </div>
          </details>
        </div>

        <div class="actions">
          <button *ngIf="!locked()" [disabled]="!hasDrafts()" (click)="approveAndDownload()">✓ Aprovar e baixar Word</button>
          <button *ngIf="locked()" (click)="exportDocx()">⬇ Baixar Word</button>
          <span class="muted small">O arquivo base original nunca é alterado. A Hipótese Diagnóstica é escrita pela psicóloga no Word.</span>
        </div>
      </section>
    </ng-container>

    <!-- Settings -->
    <ng-container *ngIf="view==='settings'">
      <section class="card">
        <h2>Minha senha</h2>
        <div class="grid">
          <div><label>Senha atual</label><input type="password" [(ngModel)]="pwCurrent" autocomplete="current-password"></div>
          <div><label>Nova senha (mín. 10 caracteres)</label><input type="password" [(ngModel)]="pwNext" autocomplete="new-password"></div>
        </div>
        <button style="margin-top:14px" [disabled]="pwNext.length<10" (click)="changePassword()">Trocar senha</button>
      </section>
      <section class="card">
        <h2>IA (OpenAI)</h2>
        <p class="muted">A chave OPENAI_API_KEY fica no servidor (api/.env), nunca no navegador.</p>
        <label>Modelo</label><input [(ngModel)]="model">
        <label class="check"><input type="checkbox" [(ngModel)]="aiEnabled"> Habilitar geração pela API</label>
        <button (click)="saveSettings()">Salvar</button>
        <p class="small">Chave configurada: {{apiConfigured?'Sim':'Não'}} • Envio autorizado no servidor: {{privacyGate?'Sim':'Não'}}</p>
        <div *ngIf="globalUsage" class="cost">
          <div><span class="muted small">Gasto estimado neste mês</span><strong>{{brl(globalUsage.month.cost_brl)}}</strong><span class="small">{{int(globalUsage.month.total_tokens)}} tokens</span></div>
          <div><span class="muted small">Total desde o início</span><strong>{{brl(globalUsage.total.cost_brl)}}</strong><span class="small">{{int(globalUsage.total.total_tokens)}} tokens</span></div>
          <p class="muted small">Câmbio usado: {{brl(usdBrl)}}/US$ (USD_BRL no api/.env).</p>
        </div>
      </section>
      <section class="card">
        <h2>Instruções da IA por parte</h2>
        <select [(ngModel)]="promptKey" (change)="loadPrompt()"><option *ngFor="let s of sectionKeys" [value]="s.id">{{s.name}}</option></select>
        <textarea [(ngModel)]="promptText"></textarea>
        <button (click)="savePrompt()">Salvar instruções</button>
      </section>
    </ng-container>
  </main>
</div>

<div *ngIf="message && loggedIn" class="toast" (click)="message=''">{{message}}</div>
`})
export class AppComponent {
  private http = inject(HttpClient);
  @ViewChild('previewBox') previewBox?: ElementRef<HTMLDivElement>;

  base = '/api';
  sectionKeys = SECTIONS;
  dropSlots = [{kind: 'base', title: '1. Arquivo base (estagiária)'}, {kind: 'anamnesis', title: '2. Anamnese (psicóloga)'}];

  loggedIn = !!sessionStorage.getItem('token');
  email = ''; password = ''; message = '';
  view: 'home' | 'evaluation' | 'settings' = 'home';

  evaluations: any[] = []; showNew = false; patientName = ''; birthDate = '';
  evaluationId = ''; current: any = null; documents: any[] = []; sections: any[] = []; inspection: any = null;
  drafts: Record<string, string> = {}; warnings: Record<string, string[]> = {};
  dragOver = ''; uploading = '';
  gen: Record<string, GenState> = {}; generating = false;
  usage: any = null; runUsage: any = {}; globalUsage: any = null; usdBrl = 5.5;
  privacy: any = null; newTerm = '';
  reviewTab: 'preview' | 'edit' = 'preview'; previewLoading = false; openSection = '';

  model = 'gpt-4.1'; aiEnabled = false; apiConfigured = false; privacyGate = false; aiReady = false;
  promptKey = 'demanda'; promptText = ''; defaults: any = {}; saved: any = {};
  pwCurrent = ''; pwNext = '';

  constructor() { if (this.loggedIn) { this.load(); this.settings(); } }

  // ---- HTTP ----
  private opts() { return {headers: new HttpHeaders({Authorization: 'Bearer ' + sessionStorage.getItem('token')})}; }
  private async req(method: string, url: string, body?: any): Promise<any> {
    try { return await firstValueFrom(this.http.request(method, this.base + url, {...this.opts(), body, responseType: 'json'})); }
    catch (e: any) {
      if (e?.status === 401 && !url.startsWith('/login')) { this.logout(); this.message = 'Sessão expirada. Entre novamente.'; }
      else this.message = e?.status === 0 ? 'API indisponível. Abra o iniciar.bat.' : e?.error?.error || e.message;
      throw e;
    }
  }
  private async blob(url: string): Promise<Blob> {
    try { return await firstValueFrom(this.http.post(this.base + url, {}, {...this.opts(), responseType: 'blob'})); }
    catch (e: any) {
      let msg = 'Falha ao montar o Word.';
      try { msg = JSON.parse(await (e.error as Blob).text()).error || msg; } catch {}
      this.message = msg; throw e;
    }
  }

  // ---- Auth ----
  async login() { try { const x = await this.req('POST', '/login', {email: this.email, password: this.password}); sessionStorage.setItem('token', x.token); this.loggedIn = true; this.message = ''; await this.load(); await this.settings(); } catch {} }
  async setup() { try { await this.req('POST', '/setup', {email: this.email, name: 'Administrador', password: this.password}); this.message = 'Administrador criado. Agora clique em Entrar.'; } catch {} }
  logout() { sessionStorage.removeItem('token'); this.loggedIn = false; this.view = 'home'; this.evaluationId = ''; this.current = null; }

  // ---- Evaluations ----
  statusLabel(s: string) { return ({draft: 'rascunho', review: 'em revisão', approved: 'aprovada', generated: 'gerado', edited: 'editado'} as any)[s] || s; }
  async load() { try { this.evaluations = await this.req('GET', '/evaluations'); } catch {} }
  async create() {
    if (this.patientName.trim().length < 2) return;
    try {
      const p = await this.req('POST', '/patients', {name: this.patientName.trim(), birth_date: this.birthDate || null});
      const e = await this.req('POST', '/evaluations', {patient_id: p.id});
      this.patientName = ''; this.birthDate = ''; this.showNew = false;
      await this.load(); await this.select(e.id);
    } catch {}
  }
  async select(id: string) {
    this.evaluationId = id; this.view = 'evaluation'; this.inspection = null; this.gen = {}; this.warnings = {}; this.reviewTab = 'preview'; this.runUsage = {}; this.privacy = null;
    this.clearPreview();
    try {
      await this.refresh();
      if (this.docsReady()) await this.inspect();
      if (this.hasDrafts()) this.renderPreview();
    } catch {}
  }
  async refresh() {
    const r = await this.req('GET', '/evaluations/' + this.evaluationId);
    this.current = r.evaluation; this.documents = r.documents || []; this.sections = r.sections || []; this.usage = r.usage;
    this.drafts = Object.fromEntries(this.sections.map(s => [s.section_key, s.content]));
    for (const s of this.sections) if (s.source_summary && !this.warnings[s.section_key]) { try { this.warnings[s.section_key] = JSON.parse(s.source_summary); } catch {} }
    const i = this.evaluations.findIndex(x => x.id === this.evaluationId);
    if (i >= 0) this.evaluations[i] = {...this.evaluations[i], status: this.current.status};
  }
  async removeEvaluation(x: any) {
    if (!confirm(`Excluir a avaliação de ${x.patient_name}?\n\nOs documentos enviados e os textos serão apagados definitivamente.`)) return;
    try {
      await this.req('DELETE', '/evaluations/' + x.id);
      if (this.evaluationId === x.id) { this.evaluationId = ''; this.current = null; this.view = 'home'; }
      await this.load(); this.message = 'Avaliação excluída.';
    } catch {}
  }
  locked() { return this.current?.status === 'approved'; }

  // ---- Files ----
  docName(kind: string) { return this.documents.find(d => d.kind === kind)?.filename || ''; }
  docsReady() { return !!(this.docName('base') && this.docName('anamnesis')); }
  missingMarkers() { const found = new Set((this.inspection?.markers || []).map((m: any) => m.key)); return SECTIONS.filter(s => !found.has(s.id)).map(s => s.name); }
  availableSections() { const found = new Set((this.inspection?.markers || []).map((m: any) => m.key)); return this.inspection ? SECTIONS.filter(s => found.has(s.id)) : SECTIONS; }
  onDrop(e: DragEvent, kind: string) { e.preventDefault(); this.dragOver = ''; if (!this.locked()) this.upload(kind, e.dataTransfer?.files?.[0]); }
  onPick(e: Event, kind: string) { const input = e.target as HTMLInputElement; this.upload(kind, input.files?.[0]); input.value = ''; }
  async upload(kind: string, file?: File | null) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.docx')) { this.message = 'Envie um arquivo .docx (Word).'; return; }
    this.uploading = kind;
    try {
      const fd = new FormData(); fd.append('file', file);
      await this.req('POST', `/evaluations/${this.evaluationId}/upload/${kind}`, fd);
      await this.refresh(); this.message = '';
      if (this.docsReady()) await this.inspect();
    } catch {} finally { this.uploading = ''; }
  }
  async inspect() { try { this.inspection = await this.req('POST', `/evaluations/${this.evaluationId}/inspect`); await this.loadPrivacy(); } catch {} }

  // ---- Privacy (pseudonymisation list) ----
  async loadPrivacy() { try { this.privacy = await this.req('GET', `/evaluations/${this.evaluationId}/privacy`); } catch {} }
  privacyList() {
    // One chip per placeholder (dates have several written forms).
    const seen = new Set<string>();
    return (this.privacy?.terms || []).filter((t: any) => { const k = t.ignored ? 'off:' + t.value : t.placeholder; if (seen.has(k)) return false; seen.add(k); return true; });
  }
  private async savePrivacy(extra: string[], ignored: string[]) {
    try { await this.req('PUT', `/evaluations/${this.evaluationId}/privacy`, {extra, ignored}); await this.loadPrivacy(); } catch {}
  }
  private currentIgnored() { return (this.privacy?.terms || []).filter((t: any) => t.ignored).map((t: any) => t.value); }
  private currentExtra() { return (this.privacy?.extra || []).map((x: any) => x.value); }
  toggleTerm(t: any) {
    const same = (this.privacy.terms as any[]).filter(x => x.placeholder === t.placeholder || x.value === t.value).map(x => x.value);
    const ignored = t.ignored ? this.currentIgnored().filter((v: string) => !same.includes(v)) : [...this.currentIgnored(), ...same];
    this.savePrivacy(this.currentExtra(), ignored);
  }
  addExtra() { const v = this.newTerm.trim(); if (v.length < 2) return; this.newTerm = ''; this.savePrivacy([...this.currentExtra(), v], this.currentIgnored()); }
  removeExtra(v: string) { this.savePrivacy(this.currentExtra().filter((x: string) => x !== v), this.currentIgnored()); }

  // ---- Generation ----
  textOf(k: string) { return this.sections.find(s => s.section_key === k)?.content || ''; }
  statusOf(k: string) { return this.sections.find(s => s.section_key === k)?.status || ''; }
  warningsOf(k: string) { return this.warnings[k] || []; }
  hasDrafts() { return this.sections.some(s => s.content?.trim()); }
  progressKeys() { return SECTIONS.filter(s => this.gen[s.id]); }
  icon(s: GenState) { return ({pending: '○', running: '⏳', done: '✓', error: '✕', skipped: '–'} as any)[s]; }
  async generateAll() {
    if (this.hasDrafts() && !confirm('Gerar tudo de novo? Os textos atuais (inclusive editados) serão substituídos. As versões antigas ficam no histórico.')) return;
    const keys = this.availableSections().map(s => s.id);
    this.gen = Object.fromEntries(keys.map(k => [k, 'pending' as GenState])); this.generating = true; this.message = '';
    this.runUsage = {input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_brl: 0};
    for (const k of keys) {
      this.gen[k] = 'running';
      try {
        const r = await this.req('POST', `/evaluations/${this.evaluationId}/generate/${k}`, {notes: ''});
        this.warnings[k] = r.warnings || []; this.gen[k] = 'done';
        for (const f of ['input_tokens', 'output_tokens', 'total_tokens', 'cost_brl']) this.runUsage[f] += r.usage?.[f] || 0;
      }
      catch { this.gen[k] = 'error'; for (const rest of keys) if (this.gen[rest] === 'pending') this.gen[rest] = 'skipped'; break; }
    }
    this.generating = false;
    await this.refresh();
    if (!Object.values(this.gen).includes('error')) { this.message = 'Texto gerado. Confira a pré-visualização.'; this.showPreview(); }
  }

  // ---- Review ----
  onToggle(e: Event, id: string) { if ((e.target as HTMLDetailsElement).open) this.openSection = id; }
  async saveSection(k: string) {
    try { await this.req('PUT', `/evaluations/${this.evaluationId}/sections/${k}`, {content: this.drafts[k]}); await this.refresh(); this.message = 'Texto salvo.'; } catch {}
  }
  async copyPrompt(k: string) {
    try {
      const r = await this.req('POST', `/evaluations/${this.evaluationId}/prompt/${k}`, {});
      await navigator.clipboard.writeText(r.text); window.open('https://chatgpt.com/', 'chatgpt');
      this.message = `Pedido copiado (${r.hidden} dados ocultados). Cole no ChatGPT com Ctrl+V, depois copie a resposta e clique em Colar resposta.`;
    } catch {}
  }
  async pasteAnswer(k: string) {
    try { this.drafts[k] = (await navigator.clipboard.readText()).trim(); this.message = 'Resposta colada. Clique em Salvar.'; }
    catch { this.message = 'Não consegui ler a área de transferência. Clique no campo e use Ctrl+V.'; }
  }
  private clearPreview() { if (this.previewBox) this.previewBox.nativeElement.innerHTML = ''; }
  showPreview() { this.reviewTab = 'preview'; setTimeout(() => this.renderPreview()); }
  async renderPreview() {
    const box = this.previewBox?.nativeElement; if (!box || !this.hasDrafts()) return;
    this.previewLoading = true;
    try {
      const data = await this.blob(`/evaluations/${this.evaluationId}/preview`);
      box.innerHTML = '';
      await renderAsync(data, box, undefined, {className: 'docx', inWrapper: true, ignoreLastRenderedPageBreak: true});
    } catch {} finally { this.previewLoading = false; }
  }
  async approveAndDownload() {
    const unsaved = SECTIONS.filter(s => (this.drafts[s.id] || '') !== this.textOf(s.id));
    if (unsaved.length) { this.message = 'Salve as alterações em: ' + unsaved.map(s => s.name).join(', '); this.reviewTab = 'edit'; return; }
    if (!confirm('Confirmar que você revisou o laudo? Depois de aprovado, os textos ficam travados.')) return;
    try { await this.req('POST', `/evaluations/${this.evaluationId}/approve`, {approveSections: true}); await this.refresh(); await this.exportDocx(); } catch {}
  }
  async exportDocx() {
    try {
      const data = await this.blob(`/evaluations/${this.evaluationId}/export`);
      const url = URL.createObjectURL(data); const a = document.createElement('a');
      a.href = url; a.download = 'laudo-' + (this.current?.patient_name || 'revisado').replace(/[^\p{L}\p{N}]+/gu, '-') + '.docx';
      a.click(); URL.revokeObjectURL(url); this.message = 'Word baixado.';
    } catch {}
  }

  brl(v: number) { return (v || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: (v || 0) < 1 ? 4 : 2}); }
  int(v: number) { return (v || 0).toLocaleString('pt-BR'); }

  // ---- Settings ----
  openSettings() { this.view = 'settings'; this.settings(); }
  async settings() {
    try {
      const s = await this.req('GET', '/ai/settings');
      this.model = s.model; this.aiEnabled = s.enabled; this.apiConfigured = s.configured; this.privacyGate = s.privacy_gate;
      this.aiReady = s.enabled && s.configured && s.privacy_gate;
      this.defaults = s.defaults || {}; this.saved = Object.fromEntries((s.prompts || []).map((x: any) => [x.id, x.prompt])); this.loadPrompt();
      this.globalUsage = await this.req('GET', '/ai/usage'); this.usdBrl = this.globalUsage.usd_brl;
    } catch {}
  }
  loadPrompt() { this.promptText = this.saved[this.promptKey] || this.defaults[this.promptKey] || ''; }
  async saveSettings() { try { await this.req('PUT', '/ai/settings', {model: this.model, enabled: this.aiEnabled}); await this.settings(); this.message = 'Configuração salva.'; } catch {} }
  async savePrompt() { try { await this.req('PUT', '/ai/prompts/' + this.promptKey, {prompt: this.promptText}); this.saved[this.promptKey] = this.promptText; this.message = 'Instruções salvas.'; } catch {} }
  async changePassword() { try { await this.req('PUT', '/me/password', {current: this.pwCurrent, next: this.pwNext}); this.pwCurrent = ''; this.pwNext = ''; this.message = 'Senha alterada.'; } catch {} }
}
