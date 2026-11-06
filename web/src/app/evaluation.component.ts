import {Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {renderAsync} from 'docx-preview';
import {tablesToPng} from './table-image';
import {Api} from './api.service';
import {WorkTimer} from './work-timer.service';
import {Reader} from './reader.service';
import {ConfirmService} from './confirm.service';
import {IconComponent} from './ui/icon.component';
import {FilterSelectComponent} from './ui/filter-select.component';
import {DropZoneComponent} from './ui/drop-zone.component';
import {Identity, IdentityFormComponent, emptyIdentity} from './ui/identity-form.component';
import {CONCLUSION_GUIDANCE, OPTIONAL_SECTIONS, PERCEPTION_MAX_AGE, SECTIONS, SECTION_STATE, STATUS, SectionState, ageText, ageYears, brDate, brl, int, words} from './shared';

/** Section the AI only writes from the psychologist's own guidance (never in "Gerar laudo"). */
const MANUAL_KEY = 'conclusao';
const NOT_IN_CONCLUSION = ['demanda', 'anamnesis', 'conclusao', 'recomendacoes'];
/** Copied from the base document as written; the AI only writes it when asked. */
const DEMAND_KEY = 'demanda';

type Gen = 'pending' | 'running' | 'done' | 'error' | 'skipped';

/** Copies text. navigator.clipboard only exists on https or localhost; opened from another computer on the
 * network (http://IP) the old copy command through a hidden text box is used instead. */
async function writeClipboard(text: string): Promise<boolean> {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch {}
  const box = document.createElement('textarea');
  box.value = text; box.setAttribute('readonly', ''); box.style.position = 'fixed'; box.style.opacity = '0'; box.style.top = '0';
  document.body.appendChild(box); box.select();
  try { return document.execCommand('copy'); } catch { return false; } finally { box.remove(); }
}

@Component({
  selector: 'nl-evaluation',
  standalone: true,
  imports: [CommonModule, FormsModule, DropZoneComponent, IdentityFormComponent, IconComponent, FilterSelectComponent],
  templateUrl: './evaluation.component.html',
  styleUrl: './evaluation.component.css',
})
export class EvaluationComponent implements OnDestroy {
  private api = inject(Api);
  private timer = inject(WorkTimer);
  reader = inject(Reader);
  private confirm = inject(ConfirmService);
  @ViewChild('previewBox') previewBox?: ElementRef<HTMLDivElement>;
  @Output() changed = new EventEmitter<void>();
  @Output() deleted = new EventEmitter<void>();
  @Output() back = new EventEmitter<void>();
  @Output() generatingChange = new EventEmitter<boolean>();
  @Input() autoGenerate = false;
  @Input() set id(v: string) { if (v && v !== this.evaluationId) { this.evaluationId = v; this.load(true); } }

  MANUAL_KEY = MANUAL_KEY; DEMAND_KEY = DEMAND_KEY; SECTIONS = SECTIONS; SECTION_STATE = SECTION_STATE; STATUS = STATUS; brDate = brDate; brl = brl; int = int; words = words;
  steps = ['Identificação', 'Arquivos', 'Gerar com IA', 'Conferir e baixar'];

  evaluationId = '';
  loaded = false;
  current: any = null; documents: any[] = []; sections: any[] = []; usage: any = null; inspection: any = null;
  references: Record<string, any[]> = {}; refOpen = '';
  costOpen = false; filesOpen = false;
  instructions: any[] = []; instrDraft: Record<string, string> = {}; instrOpen = '';
  privacy: any = null; newTerm = '';
  idModel: Identity = emptyIdentity(); private idTimer: any; idSaving = false;
  step = 0;
  uploading = '';
  aiReady = false; usdBrl = 5.5;
  gen: Record<string, Gen> = {}; generating = false;
  open = ''; editing = ''; editText = ''; sectionInstr = '';
  mode: 'secoes' | 'documento' = 'secoes'; previewLoading = false;

  ngOnDestroy() { clearTimeout(this.idTimer); this.reader.stop(); }

  // ---------- loading ----------
  async load(first = false) {
    try {
      const r = await this.api.req('GET', '/evaluations/' + this.evaluationId);
      this.current = r.evaluation; this.documents = r.documents || []; this.sections = r.sections || []; this.usage = r.usage;
      if (first) this.timer.start(this.evaluationId, this.current.work_seconds, this.locked());
      else if (this.locked()) this.timer.finish();
      if (first) {
        const c = this.current;
        this.idModel = {name: c.patient_name || '', birth_date: c.birth_date || '', sex: c.sex || '', schooling: c.schooling || '', start_date: c.start_date || '', end_date: c.end_date || ''};
        this.closeRefs(); this.inspection = null; this.privacy = null; this.gen = {}; this.open = ''; this.editing = ''; this.mode = 'secoes';
        this.loadModels();
        const s = await this.api.req('GET', '/ai/settings').catch(() => null);
        this.aiReady = !!(s && s.enabled && s.configured && s.privacy_gate);
        this.step = !this.docsReady() ? 1 : !this.autoDrafted() ? 2 : 3;
      }
      if (this.docsReady() && !this.inspection) await this.inspect();
      if (this.docsReady() && !this.instructions.length || first) await this.loadInstructions();
      this.loaded = true;
      if (first && this.autoGenerate && this.docsReady() && !this.autoDrafted()) { this.step = 2; this.generateAll(true); }
    } catch {}
  }
  async inspect() {
    try { this.inspection = await this.api.req('POST', `/evaluations/${this.evaluationId}/inspect`); } catch { this.inspection = null; }
    try { this.privacy = await this.api.req('GET', `/evaluations/${this.evaluationId}/privacy`); } catch {}
    try { this.references = await this.api.req('GET', `/evaluations/${this.evaluationId}/references`); } catch { this.references = {}; }
  }
  refs(k: string) { return k === MANUAL_KEY ? [] : this.references[k] || []; }
  /** What the conclusion is built from: the texts of the result sections (no demand, no anamnesis), as the API sends them. */
  conclusionSources() { return this.applicable().filter(s => !NOT_IN_CONCLUSION.includes(s.id) && this.text(s.id).trim()).map(s => ({name: s.name, text: this.text(s.id)})); }
  /** Reference material behind a section: section texts for the conclusion, tables for the others. */
  refCount(k: string) { return k === MANUAL_KEY ? this.conclusionSources().length : this.refs(k).length; }
  refLabel(k: string) { return this.refOpen === k ? (k === MANUAL_KEY ? 'Ocultar textos' : 'Ocultar tabelas') : (k === MANUAL_KEY ? 'Ver textos das seções (' : 'Ver tabelas de referência (') + this.refCount(k) + ')'; }
  async loadInstructions() {
    try {
      const r = await this.api.req('GET', `/evaluations/${this.evaluationId}/instructions`);
      this.instructions = r.sections; this.instrModel = r.model || null;
      this.instrDraft = Object.fromEntries(r.sections.map((x: any) => [x.key, x.custom || this.inherited(x)]));
    } catch {}
  }

  // ---------- derived ----------
  locked() { return this.current?.status === 'approved'; }
  docName(kind: string) { return this.documents.filter(d => d.kind === kind).at(-1)?.filename || ''; }
  docCount() { return (this.docName('base') ? 1 : 0) + (this.docName('anamnesis') ? 1 : 0); }
  docsReady() { return this.docCount() === 2; }
  /** Sections this person needs. Percepção is for under 17 (text already written stays visible; unknown age: kept).
   * BFP and DIVA appear only when the base document has their field, even if old text exists. */
  applicable() {
    const age = ageYears(this.idModel.birth_date, this.idModel.end_date);
    const found = this.placeable();
    return SECTIONS.filter(s =>
      !(this.inspection && OPTIONAL_SECTIONS.includes(s.id) && !found.has(s.id)) &&
      !(s.id === 'percepcao' && age !== null && age >= PERCEPTION_MAX_AGE && !this.text(s.id).trim()));
  }
  /** Sections the Word file can receive: those with an interpretation field, and titled sections without one
   * (the export creates the field right after their tables). */
  placeable() { return new Set([...(this.inspection?.markers || []).map((m: any) => m.key), ...Object.keys(this.inspection?.title_ranges || {})]); }
  /** Title exists but the "Interpretação" field does not: the export adds it. */
  fieldAdded(k: string) { return !!this.inspection?.title_ranges?.[k] && !(this.inspection?.markers || []).some((m: any) => m.key === k); }
  available() { const found = this.placeable(); return this.inspection ? this.applicable().filter(s => found.has(s.id)) : this.applicable(); }
  withOldText() { return (this.inspection?.markers || []).filter((m: any) => m.existing_paragraphs > 0 && m.key !== DEMAND_KEY).map((m: any) => SECTIONS.find(s => s.id === m.key)?.name || m.key); }
  missing() { const ids = new Set(this.available().map(s => s.id)); return this.applicable().filter(s => !ids.has(s.id)).map(s => s.name); }
  isMissing(k: string) { return !!this.inspection && !this.available().some(s => s.id === k); }
  /** Why a section has no place in the base document. */
  missingWhy(k: string) {
    const domain = k === 'comportamento_diva' ? 'comportamento' : k;
    return (this.inspection?.titled_domains || []).includes(domain) ? 'O título existe no arquivo, mas falta o campo "Interpretação" dessa seção.' : 'Essa seção não existe no arquivo base.';
  }
  /** Missing sections stay visible in the review list, in their place. */
  reviewRows() { return this.inspection ? this.applicable() : this.available(); }
  section(k: string) { return this.sections.find(s => s.section_key === k); }
  text(k: string) { return this.section(k)?.content || ''; }
  state(k: string): SectionState { const s = this.section(k); return !s?.content?.trim() ? 'pend' : s.status === 'approved' ? 'ap' : 'gen'; }
  drafted() { return this.available().filter(s => this.state(s.id) !== 'pend').length; }
  approved() { return this.available().filter(s => this.state(s.id) === 'ap').length; }
  total() { return this.available().length; }
  allApproved() { return this.locked() || (this.total() > 0 && this.approved() === this.total()); }
  status() { return this.allApproved() ? STATUS.ap : this.autoDrafted() ? STATUS.rv : STATUS.rs; }
  summary() {
    const c = this.current; if (!c) return '';
    return [ageText(c.birth_date, c.end_date), c.sex, c.schooling].filter(Boolean).join(' · ');
  }
  warnings(k: string): string[] { try { return JSON.parse(this.section(k)?.source_summary || '[]'); } catch { return []; } }
  stepDone(i: number) { return [this.idModel.name.trim().length >= 2, this.docsReady(), this.autoKeys().length > 0 && this.autoDrafted() === this.autoKeys().length, this.allApproved()][i]; }
  stepSub(i: number) {
    if (i === 0) return this.idModel.name.trim() ? 'Dados preenchidos' : 'Pendente';
    if (i === 1) return `${this.docCount()} de 2 enviados`;
    if (i === 2) return this.generating ? `Gerando ${this.genDone()}/${this.genKeys().length}` : this.autoDrafted() ? (this.autoDrafted() === 1 ? '1 seção gerada' : `${this.autoDrafted()} seções geradas`) : 'Pendente';
    return this.allApproved() ? 'Aprovada' : `${this.approved()}/${this.total()} aprovadas`;
  }
  /** Paragraphs for display. A "## Título: texto..." line (title and text on one line) becomes a bold title plus a normal
   * paragraph, as in the Word export; only short "## " lines are titles. */
  paragraphs(t: string) {
    return (t || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).flatMap(p => {
      const clean = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').trim();
      if (!/^#{1,6}\s/.test(p)) return [{title: false, text: clean(p)}];
      const [first, ...rest] = p.replace(/^#{1,6}\s*/, '').split('\n');
      const inline = first.length > 80 ? /^([^:.]{2,80}):\s+(.+)$/.exec(first) : null;
      const title = inline ? inline[1] : first, body = [inline?.[2] || '', ...rest].join(' ').trim();
      return [{title: true, text: clean(title)}, ...(body ? [{title: false, text: clean(body)}] : [])];
    });
  }

  // ---------- step 1: identification (auto-save) ----------
  onIdentity(v: Identity) {
    this.idModel = v; clearTimeout(this.idTimer);
    if (v.name.trim().length < 2 || this.locked()) return;
    this.idTimer = setTimeout(() => this.saveIdentity(), 700);
  }
  async saveIdentity() {
    this.idSaving = true;
    try { await this.api.req('PUT', `/evaluations/${this.evaluationId}/identification`, this.idModel); const r = await this.api.req('GET', '/evaluations/' + this.evaluationId); this.current = r.evaluation; this.changed.emit(); }
    catch {} finally { this.idSaving = false; }
  }

  // ---------- step 2: files ----------
  async upload(kind: 'base' | 'anamnesis', f: File) {
    if (this.locked()) return;
    if (!f.name.toLowerCase().endsWith('.docx')) { this.api.notify('Envie um arquivo .docx (Word).'); return; }
    this.uploading = kind;
    try {
      await this.api.upload(this.evaluationId, kind, f);
      this.inspection = null;
      await this.load();
      if (kind === 'base') {
        const c = this.current;
        this.idModel = {...this.idModel, birth_date: this.idModel.birth_date || c.birth_date || '', sex: this.idModel.sex || c.sex || '', schooling: this.idModel.schooling || c.schooling || '', start_date: this.idModel.start_date || c.start_date || '', end_date: this.idModel.end_date || c.end_date || ''};
      }
      this.changed.emit();
      this.api.notify(this.missing().length && this.inspection ? 'Atenção: faltam no documento: ' + this.missing().join(', ') + '.' : kind === 'base' ? 'Arquivo base enviado.' : 'Anamnese enviada.');
    } catch {} finally { this.uploading = ''; }
  }

  // ---------- step 3: generation ----------
  autoKeys() { return this.available().map(s => s.id).filter(k => k !== MANUAL_KEY && k !== DEMAND_KEY); }
  autoDrafted() { return this.autoKeys().filter(k => this.state(k) !== 'pend').length; }
  demandInFile() { return (this.inspection?.markers || []).find((m: any) => m.key === DEMAND_KEY)?.existing_text || ''; }
  private same(a: string, b: string) { return (a || '').replace(/\s+/g, ' ').trim() === (b || '').replace(/\s+/g, ' ').trim(); }
  demandIsFromFile() { return !!this.demandInFile() && this.same(this.text(DEMAND_KEY), this.demandInFile()); }
  async useFileDemand() {
    try { await this.api.req('PUT', `/evaluations/${this.evaluationId}/sections/${DEMAND_KEY}`, {content: this.demandInFile()}); await this.load(); this.changed.emit(); this.api.notify('Agora a demanda é o texto do arquivo.'); } catch {}
  }
  pendingAuto() { return this.autoKeys().filter(k => this.state(k) === 'pend'); }
  generatePending() { return this.generateAll(true, this.pendingAuto()); }
  async generateDemand() {
    if (this.state(DEMAND_KEY) !== 'pend' && !await this.confirm.ask({tone: 'review', title: 'Trocar a demanda pelo texto da IA?',
      body: 'A Descrição da demanda atual será substituída por um texto gerado pela IA a partir da anamnese.',
      facts: ['O texto atual vai para o histórico', 'A seção volta para revisão'], ok: 'Gerar com IA'})) return;
    this.regenerate(DEMAND_KEY, false, true);
  }
  hasConclusion() { return this.available().some(s => s.id === MANUAL_KEY); }
  genKeys() { return Object.keys(this.gen); }
  genDone() { return Object.values(this.gen).filter(g => g === 'done' || g === 'error' || g === 'skipped').length; }
  genPct() { const n = this.genKeys().length; return n ? Math.round(this.genDone() / n * 100) : 0; }
  dotClass(k: string) { const g = this.gen[k]; if (g === 'running') return 'warn pulse'; if (g === 'error') return 'err'; if (g === 'done') return 'ok'; return this.state(k) === 'ap' ? 'ok' : this.state(k) === 'gen' ? 'warn' : ''; }
  rowLabel(k: string) { if (k === DEMAND_KEY && !this.gen[k]) return this.state(k) === 'pend' ? 'Sem texto no arquivo' : this.demandIsFromFile() ? 'Do arquivo enviado' : SECTION_STATE[this.state(k)].label; if (k === MANUAL_KEY && !this.gen[k] && this.state(k) === 'pend') return 'Você gera na etapa 4'; const g = this.gen[k]; if (g === 'running') return 'Gerando…'; if (g === 'pending') return 'Na fila'; if (g === 'error') return 'Erro'; if (g === 'skipped') return 'Não gerada'; return SECTION_STATE[this.state(k)].label; }

  async generateAll(skipConfirm = false, only?: string[]) {
    if (!this.aiReady) { this.api.notify('Geração pela API desligada. Ative em Configurações.'); return; }
    if (!skipConfirm && this.autoDrafted() && !await this.confirm.ask({tone: 'review', title: 'Gerar tudo de novo?',
      body: 'Os textos atuais de todas as seções geradas pela IA serão substituídos por novas versões. Edições feitas nelas serão perdidas.',
      facts: ['As versões anteriores ficam no histórico', 'Todas as seções voltam para revisão', 'O custo entra em Custo da IA desta avaliação'], ok: 'Regenerar tudo'})) return;
    const keys = only || this.autoKeys();
    for (const k of keys) if (!await this.saveInstruction(k)) return;
    this.gen = Object.fromEntries(keys.map(k => [k, 'pending' as Gen]));
    this.generating = true; this.generatingChange.emit(true);
    try {
      for (const k of keys) {
        this.gen[k] = 'running';
        try { await this.api.req('POST', `/evaluations/${this.evaluationId}/generate/${k}`, {notes: ''}); this.gen[k] = 'done'; await this.load(); }
        catch { this.gen[k] = 'error'; for (const r of keys) if (this.gen[r] === 'pending') this.gen[r] = 'skipped'; break; }
      }
    } finally { this.generating = false; this.generatingChange.emit(false); this.changed.emit(); }
    if (!Object.values(this.gen).includes('error')) { this.api.notify(this.hasConclusion() && this.state(MANUAL_KEY) === 'pend' ? 'Textos gerados. Revise cada seção; a Conclusão você gera com suas orientações.' : 'Textos gerados. Revise cada seção.'); this.step = 3; this.mode = 'secoes'; this.open = this.available()[0]?.id || ''; }
  }

  instruction(k: string) { return this.instructions.find(x => x.key === k); }
  /** Model of this evaluation (name for the screen), from the instructions answer. */
  instrModel: {id: string; name: string} | null = null;
  /** What applies when this evaluation has no instruction of its own: the model's, else the system default. */
  inherited(x: any) { return x?.model || (x?.key === MANUAL_KEY ? CONCLUSION_GUIDANCE : x?.default) || ''; }
  isCustom(k: string) { return !!this.instruction(k)?.custom; }
  isFromModel(k: string) { const x = this.instruction(k); return !x?.custom && !!x?.model; }
  hasDanger(mc: any) { return (mc?.items || []).some((i: any) => i.level === 'danger'); }
  customCount() { return this.instructions.filter(x => x.custom).length; }
  /** Returns false when the instruction could not be saved, so nothing is generated with an old one. */
  async saveInstruction(k: string, text = this.instrDraft[k]) {
    const ins = this.instruction(k); if (!ins || this.locked()) return true;
    const value = (text || '').trim();
    if ((ins.custom || this.inherited(ins)) === value) return true;
    try {
      const r = await this.api.req('PUT', `/evaluations/${this.evaluationId}/instructions/${k}`, {prompt: value && value !== this.inherited(ins) ? value : null});
      ins.custom = r.custom; this.instrDraft[k] = r.custom || this.inherited(ins);
      return true;
    } catch { return false; }
  }
  async resetInstruction(k: string) { const ins = this.instruction(k); if (!ins) return; this.instrDraft[k] = this.inherited(ins); await this.saveInstruction(k, this.inherited(ins)); }

  // ---------- report model of this evaluation ----------
  models: {value: string; label: string}[] = [];
  async loadModels() {
    try { const list: any[] = await this.api.req('GET', '/models'); this.models = [{value: '', label: 'Sem modelo'}, ...list.filter(m => m.active || m.id === this.current?.model_id).map(m => ({value: m.id, label: m.name}))]; } catch {}
  }
  /** Changing the model changes the default instructions and the comparison of the base document. */
  async setModel(id: string) {
    if ((this.current?.model_id || '') === id) return;
    try {
      await this.api.req('PUT', `/evaluations/${this.evaluationId}/model`, {model_id: id || null});
      this.current.model_id = id || null;
      await this.loadInstructions();
      if (this.docsReady()) await this.inspect();
      this.api.notify(id ? 'Modelo definido. As instruções dele passam a valer nesta avaliação.' : 'Avaliação sem modelo.');
    } catch {}
  }

  // privacy (pseudonymisation list)
  privacyList() { const seen = new Set<string>(); return (this.privacy?.terms || []).filter((t: any) => { const key = t.ignored ? 'off:' + t.value : t.placeholder; if (seen.has(key)) return false; seen.add(key); return true; }); }
  private async savePrivacy(extra: string[], ignored: string[]) { try { await this.api.req('PUT', `/evaluations/${this.evaluationId}/privacy`, {extra, ignored}); this.privacy = await this.api.req('GET', `/evaluations/${this.evaluationId}/privacy`); } catch {} }
  private ignoredTerms() { return (this.privacy?.terms || []).filter((t: any) => t.ignored).map((t: any) => t.value); }
  private extraTerms() { return (this.privacy?.extra || []).map((x: any) => x.value); }
  toggleTerm(t: any) { const same = (this.privacy.terms as any[]).filter(x => x.placeholder === t.placeholder || x.value === t.value).map(x => x.value); this.savePrivacy(this.extraTerms(), t.ignored ? this.ignoredTerms().filter((v: string) => !same.includes(v)) : [...this.ignoredTerms(), ...same]); }
  addTerm() { const v = this.newTerm.trim(); if (v.length < 2) return; this.newTerm = ''; this.savePrivacy([...this.extraTerms(), v], this.ignoredTerms()); }
  removeTerm(v: string) { this.savePrivacy(this.extraTerms().filter((x: string) => x !== v), this.ignoredTerms()); }

  // ---------- step 4: review ----------
  // Reference tables open below the section text (read-only, from the base document).
  toggleRefs(k: string) { this.refOpen = this.refOpen === k ? '' : k; }
  closeRefs() { this.refOpen = ''; }
  /** Section shown in the review editor: the chosen one, or the first in the list. */
  cur() { const rows = this.reviewRows(); return rows.some(s => s.id === this.open) ? this.open : rows[0]?.id || ''; }
  select(k: string) { if (this.cur() !== k) this.toggle(k); }
  sourceLabel(k: string) {
    if (k === DEMAND_KEY || k === 'anamnesis') return 'escrita a partir da anamnese';
    if (k === MANUAL_KEY) return 'escrita a partir das seções de resultados';
    if (k === 'recomendacoes') return 'escrita a partir das seções do laudo';
    return 'escrita a partir das tabelas do arquivo base';
  }
  toggle(k: string) { this.reader.stop(); this.closeRefs(); this.gptOpen = ''; this.open = this.open === k ? '' : k; this.editing = ''; this.sectionInstr = ''; }
  startEdit(k: string) { this.reader.stop(); this.editing = k; this.editText = this.text(k); this.sectionInstr = ''; setTimeout(() => (document.querySelector('textarea.draft.editing') as HTMLTextAreaElement | null)?.focus()); }
  async saveEdit(k: string) {
    if (!this.editText.trim()) { this.api.notify('O texto não pode ficar vazio.'); return; }
    try { await this.api.req('PUT', `/evaluations/${this.evaluationId}/sections/${k}`, {content: this.editText}); this.editing = ''; await this.load(); this.changed.emit(); this.api.notify('Texto salvo. A seção voltou para revisão.'); } catch {}
  }
  openInstr(k: string) { this.sectionInstr = this.sectionInstr === k ? '' : k; this.editing = ''; }
  async regenerate(k: string, withInstruction = false, skipConfirm = false) {
    if (!this.aiReady) { this.api.notify('Geração pela API desligada. Ative em Configurações.'); return; }
    if (!skipConfirm && this.state(k) !== 'pend') {
      const name = this.available().find(x => x.id === k)?.name || 'esta seção';
      const instr = (this.instrDraft[k] || '').trim();
      const ok = await this.confirm.ask({tone: 'review',
        title: withInstruction ? 'Regenerar com a sua instrução?' : 'Regenerar esta seção?',
        body: `O texto atual de "${name}" será substituído por uma nova versão gerada pela IA. Edições feitas nesta seção serão perdidas e ela volta para revisão.`,
        quote: withInstruction && instr ? {label: 'Instrução', text: instr.length > 400 ? instr.slice(0, 400) + '…' : instr} : undefined,
        facts: ['Usa só os dados desta seção no arquivo base', 'A versão anterior fica no histórico', 'O custo entra em Custo da IA desta avaliação'],
        ok: withInstruction ? 'Regenerar com instrução' : 'Regenerar'});
      if (!ok) return;
    }
    if (withInstruction && !await this.saveInstruction(k)) return;
    this.gen = {[k]: 'running'}; this.generating = true; this.generatingChange.emit(true);
    try { await this.api.req('POST', `/evaluations/${this.evaluationId}/generate/${k}`, {notes: ''}); this.gen[k] = 'done'; await this.load(); this.sectionInstr = ''; this.api.notify('Seção regenerada. Revise o texto.'); }
    catch { this.gen[k] = 'error'; }
    finally { this.generating = false; this.generatingChange.emit(false); this.changed.emit(); }
  }
  async generateConclusion() {
    const text = (this.instrDraft[MANUAL_KEY] || '').trim();
    if (text.length < 10) { this.api.notify('Escreva suas orientações para a conclusão (o que você concluiu e quer destacar).'); return; }
    if (this.state(MANUAL_KEY) !== 'pend' && !await this.confirm.ask({tone: 'review', title: 'Gerar a conclusão de novo?',
      body: 'A conclusão atual será substituída por uma nova versão escrita a partir das suas orientações e dos textos das seções de resultados.',
      quote: {label: 'Suas orientações', text: text.length > 400 ? text.slice(0, 400) + '…' : text},
      facts: ['O texto atual vai para o histórico', 'A conclusão volta para revisão'], ok: 'Gerar de novo'})) return;
    await this.regenerate(MANUAL_KEY, true, true);
  }
  async approveAndNext(k: string) {
    try {
      await this.api.req('PUT', `/evaluations/${this.evaluationId}/sections/${k}`, {content: this.text(k), approve: true});
      await this.load(); this.changed.emit();
      const list = this.available(), i = list.findIndex(s => s.id === k);
      const next = [...list.slice(i + 1), ...list.slice(0, i)].find(s => this.state(s.id) !== 'ap');
      if (this.refOpen) { if (next && this.refCount(next.id)) this.refOpen = next.id; else this.closeRefs(); }
      this.open = next?.id || ''; this.editing = ''; this.sectionInstr = '';
      if (!next && this.allApproved()) this.api.notify('Todas as seções aprovadas. Já dá para baixar o Word.');
    } catch {}
  }
  async approveAll() {
    const pending = this.available().filter(s => this.state(s.id) === 'pend');
    if (pending.length) { this.api.notify('Gere ou escreva todas as seções antes de aprovar: ' + pending.map(s => s.name).join(', ')); return; }
    if (!await this.confirm.ask({title: 'Aprovar todas as seções?', body: 'Confirme que você revisou o laudo inteiro. Depois de aprovado, os textos ficam travados e o Word pode ser baixado.', ok: 'Aprovar todas'})) return;
    try { await this.api.req('POST', `/evaluations/${this.evaluationId}/approve`, {approveSections: true}); await this.load(); this.changed.emit(); this.api.notify('Todas as seções aprovadas. Já dá para baixar o Word.'); } catch {}
  }
  /** Word or PDF of the approved report (the PDF is the same Word converted on this computer). */
  exporting: '' | 'docx' | 'pdf' = '';
  async download(format: 'docx' | 'pdf' = 'docx') {
    if (this.exporting) return;
    if (!this.allApproved()) { this.api.notify(format === 'pdf' ? 'Aprove todas as seções para baixar o PDF.' : 'Aprove todas as seções para baixar o Word.'); return; }
    if (this.inspection && this.missing().length && !await this.confirm.ask({tone: 'danger', title: 'Baixar sem estas seções?',
      body: 'O Word não terá as seções abaixo, porque elas faltam no arquivo base.', facts: this.missing(), ok: 'Baixar assim mesmo'})) return;
    this.exporting = format;
    try {
      if (!this.locked()) { await this.api.req('POST', `/evaluations/${this.evaluationId}/approve`, {approveSections: true}); await this.load(); this.changed.emit(); }
      if (format === 'pdf') this.api.notify('Gerando o PDF…');
      const data = await this.api.blob(`/evaluations/${this.evaluationId}/${format === 'pdf' ? 'export.pdf' : 'export'}`);
      const url = URL.createObjectURL(data), a = document.createElement('a');
      a.href = url; a.download = 'laudo-' + (this.current?.patient_name || 'revisado').replace(/[^\p{L}\p{N}]+/gu, '-') + '.' + format; a.click(); URL.revokeObjectURL(url);
      this.api.notify(format === 'pdf' ? 'PDF baixado.' : 'Word baixado.');
    } catch {} finally { this.exporting = ''; }
  }
  // Document preview zoom (50–150%) and page count from the rendered Word.
  zoom = 0.8; pageCount = 0;
  setZoom(d: number) { this.zoom = Math.min(1.5, Math.max(0.5, Math.round((this.zoom + d) * 10) / 10)); }
  /** Approving this one leaves nothing else to review. */
  isLastPending(k: string) { return !this.available().some(s => s.id !== k && this.state(s.id) !== 'ap'); }
  showDocument() { this.closeRefs(); this.step = 3; this.mode = 'documento'; setTimeout(() => this.renderPreview()); }
  async renderPreview() {
    const box = this.previewBox?.nativeElement; if (!box) return;
    if (!this.docName('base')) { box.innerHTML = ''; return; }
    this.previewLoading = true;
    try { const data = await this.api.blob(`/evaluations/${this.evaluationId}/preview`); box.innerHTML = ''; await renderAsync(data, box, undefined, {className: 'docx', inWrapper: true, ignoreLastRenderedPageBreak: true}); this.pageCount = box.querySelectorAll('section.docx').length; }
    catch {} finally { this.previewLoading = false; }
  }
  // ---------- ChatGPT (manual mode) ----------
  // The request carries this section's own tables/text and the instruction, with names replaced by markers (API side).
  gptOpen = ''; gptText = ''; gptHidden = 0; gptLoading = ''; gptCopied = false;
  /** Builds the request, copies it, opens ChatGPT and shows the panel to copy again or paste the answer back. */
  async openGpt(k: string) {
    if (this.gptLoading) return;
    this.gptLoading = k;
    try {
      // An instruction typed but not saved yet must go in the request.
      if (k !== MANUAL_KEY && !await this.saveInstruction(k)) return;
      const r = await this.api.req('POST', `/evaluations/${this.evaluationId}/prompt/${k}`, k === MANUAL_KEY ? {notes: (this.instrDraft[k] || '').trim()} : {});
      this.gptOpen = k; this.gptText = r.text; this.gptHidden = r.hidden || 0;
      this.gptCopied = await writeClipboard(r.text);
      const w = window.open('https://chatgpt.com/', 'chatgpt');
      this.api.notify(this.gptCopied ? (w ? 'Pedido copiado. No ChatGPT, cole com Ctrl+V.' : 'Pedido copiado. O navegador bloqueou a nova aba: use Abrir ChatGPT.') : 'Não deu para copiar sozinho: use Copiar pedido.');
    } catch {} finally { this.gptLoading = ''; }
  }
  async copyGpt() { this.gptCopied = await writeClipboard(this.gptText); this.api.notify(this.gptCopied ? 'Pedido copiado.' : 'Não foi possível copiar. Selecione o texto e use Ctrl+C.'); }
  goGpt() { window.open('https://chatgpt.com/', 'chatgpt'); }
  /** Reference tables as one PNG in the clipboard (to paste into ChatGPT as an image); saved as a file if copying images is blocked. */
  async copyTablesImage(k: string) {
    const png = tablesToPng(this.refs(k));
    try {
      await navigator.clipboard.write([new ClipboardItem({'image/png': png.then(b => { if (!b) throw new Error('empty'); return b; })})]);
      this.api.notify('Tabelas copiadas como imagem. No ChatGPT, cole com Ctrl+V junto com o pedido.');
    } catch {
      const b = await png.catch(() => null); if (!b) { this.api.notify('Não foi possível montar a imagem das tabelas.'); return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'tabelas-da-secao.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      this.api.notify('O navegador não deixou copiar a imagem: ela foi baixada. Arraste o arquivo para o ChatGPT.');
    }
  }
  /** Opens the editor with the answer from the clipboard (or empty, to paste with Ctrl+V). */
  async pasteGptAnswer(k: string) {
    this.startEdit(k);
    try { const t = (await navigator.clipboard.readText()).trim(); if (t && t !== this.gptText.trim()) { this.editText = t; this.api.notify('Resposta colada. Revise e salve a edição.'); return; } } catch {}
    setTimeout(() => (document.querySelector('textarea.draft.editing') as HTMLTextAreaElement | null)?.select(), 30);
    this.api.notify('Cole a resposta do ChatGPT com Ctrl+V (substitui o texto) e salve a edição.');
  }

  /** Copies the section text ready to paste in Word: topic titles without "##", paragraphs separated by a blank line. */
  copied = ''; private copiedTimer: any;
  async copyText(k: string) { await this.copy(k, this.paragraphs(this.text(k)).map(p => p.text).join('\n\n')); }
  /** Conclusão: every section text the conclusion is built from, each under its section name. */
  async copyAll() {
    await this.copy('__all', this.conclusionSources().map(t => t.name.toUpperCase() + '\n\n' + this.paragraphs(t.text).map(p => p.text).join('\n\n')).join('\n\n\n'));
  }
  private async copy(id: string, plain: string) {
    if (!await writeClipboard(plain)) { this.api.notify('Não foi possível copiar. Selecione o texto e use Ctrl+C.'); return; }
    this.copied = id; clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => this.copied = '', 1800);
  }
  async pasteAnswer() { try { this.editText = (await navigator.clipboard.readText()).trim(); } catch { this.api.notify('Use Ctrl+V dentro do campo.'); } }

  async remove() {
    if (this.generating) return;
    if (!await this.confirm.ask({tone: 'danger', title: 'Excluir esta avaliação?', body: `A avaliação de ${this.current?.patient_name || 'este paciente'} será apagada definitivamente.`, facts: ['Os documentos enviados serão apagados', 'Os textos e o histórico serão apagados', 'Não é possível desfazer'], ok: 'Excluir avaliação'})) return;
    try { await this.api.req('DELETE', '/evaluations/' + this.evaluationId); this.api.notify('Avaliação excluída.'); this.deleted.emit(); } catch {}
  }
  goStep(i: number) { if (i !== 3) this.closeRefs(); this.step = i; if (i === 3 && this.mode === 'documento') setTimeout(() => this.renderPreview()); }
  setMode(m: 'secoes' | 'documento') { if (m !== 'secoes') this.closeRefs(); this.mode = m; if (m === 'documento') setTimeout(() => this.renderPreview()); }
}
