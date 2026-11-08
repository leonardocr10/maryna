import {Component, ElementRef, EventEmitter, HostListener, Input, NgZone, OnDestroy, Output, QueryList, ViewChild, ViewChildren, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {tablesToPng} from './table-image';
import {Api} from './api.service';
import {WorkTimer} from './work-timer.service';
import {Reader} from './reader.service';
import {ConfirmService} from './confirm.service';
import {IconComponent} from './ui/icon.component';
import {DictateComponent} from './ui/dictate.component';
import {RichEditorComponent} from './ui/rich-editor.component';
import {htmlFromText, sanitizeHtml, textFromHtml} from './rich-text';
import {DomSanitizer} from '@angular/platform-browser';
import {Dictation} from './dictation/dictation.service';
import {FilterSelectComponent} from './ui/filter-select.component';
import {DropZoneComponent} from './ui/drop-zone.component';
import {Identity, IdentityFormComponent, emptyIdentity} from './ui/identity-form.component';
import {Pending, ReviewPanelComponent} from './ui/review-panel.component';
import {SectionVersionsComponent} from './ui/section-versions.component';
import {DevolutivaComponent} from './ui/devolutiva.component';
// PlanComponent (Sessões) is hidden for now; import it again with <nl-plan> in the template to show it.
import {DeliveryComponent} from './ui/delivery.component';
import {ChatgptAnamnesisComponent} from './ui/chatgpt-anamnesis.component';
import {TopbarService} from './topbar.service';
import {ReadingService} from './ui/reading-mode.component';
import {WheelZoom} from './wheel-zoom.service';
import {Narrator, highlight, segmentsOf} from './ui/reading-narrator';
import {AI_MODE_CONFIRM, CONCLUSION_GUIDANCE, HAND_ONLY, niceTitle, OPTIONAL_SECTIONS, PERCEPTION_MAX_AGE, SECTIONS, SECTION_STATE, STATUS, SectionState, ageText, ageYears, brDate, brl, int, words} from './shared';
/** Interpretation sections: written from their own tables in the base document. */
const INTERPRETATION_SLOTS = ['inteligencia', 'percepcao', 'memoria', 'atencao', 'funcoes_executivas', 'comportamento', 'personalidade', 'comportamento_diva'];

/** Section the AI only writes from the psychologist's own guidance (never in "Gerar laudo"). */
const MANUAL_KEY = 'conclusao';
const NOT_IN_CONCLUSION = ['demanda', 'anamnesis', 'conclusao', 'hipotese', 'recomendacoes'];
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
  imports: [CommonModule, FormsModule, DropZoneComponent, IdentityFormComponent, IconComponent, FilterSelectComponent, DictateComponent, RichEditorComponent, ReviewPanelComponent, SectionVersionsComponent, DevolutivaComponent, DeliveryComponent, ChatgptAnamnesisComponent],
  templateUrl: './evaluation.component.html',
  styleUrl: './evaluation.component.css',
})
export class EvaluationComponent implements OnDestroy {
  private api = inject(Api);
  private timer = inject(WorkTimer);
  reader = inject(Reader);
  private reading = inject(ReadingService);
  dictation = inject(Dictation);
  private instrSaveTimer: any;
  private confirm = inject(ConfirmService);
  /** Patient, status and summary go to the top bar (left), so the screen starts with the steps and the work. */
  private topbar = inject(TopbarService);
  private readonly topInfo = () => this.current ? {title: this.current.patient_name, badge: this.status(), sub: [this.summary() || 'Complete a identificação', this.current.start_date ? 'início ' + this.brDate(this.current.start_date) : ''].filter(Boolean).join(' · ')} : null;
  ngOnInit() { this.topbar.info = this.topInfo; }
  @ViewChild('previewBox') previewBox?: ElementRef<HTMLDivElement>;
  @Output() changed = new EventEmitter<void>();
  @Output() deleted = new EventEmitter<void>();
  @Output() back = new EventEmitter<void>();
  @Output() generatingChange = new EventEmitter<boolean>();
  @Input() autoGenerate = false;
  @Input() set id(v: string) { if (v && v !== this.evaluationId) { this.evaluationId = v; this.load(true); } }

  MANUAL_KEY = MANUAL_KEY; DEMAND_KEY = DEMAND_KEY; SECTIONS = SECTIONS; SECTION_STATE = SECTION_STATE; STATUS = STATUS; brDate = brDate; brl = brl; int = int; words = words;
  steps = ['Identificação e arquivos', 'Arquivos', 'Gerar com IA', 'Conferir e baixar'];
  /** Short step names for the compact indicator under the patient name. */
  shortStep(i: number) { return ['Identificação', 'Arquivos', 'Gerar com IA', 'Conferir e baixar'][i]; }
  /** Pending strip: explanation and actions for missing sections, closed by default. */
  resolveOpen = false;

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

  ngOnDestroy() { this.unwheel(); clearTimeout(this.previewTimer); this.flushEditors(); for (const k of Object.keys(this.docTimers)) { clearTimeout(this.docTimers[k]); this.saveDocSection(k); } if (this.topbar.info === this.topInfo) this.topbar.info = null; this.paint('nl-find', []); this.paint('nl-find-on', []); this.paint('nl-target', []); clearTimeout(this.idTimer); clearTimeout(this.instrSaveTimer); this.reader.stop(); if (this.autoTimer) { clearTimeout(this.autoTimer); this.autosave(this.editing); } }

  // ---------- loading ----------
  async load(first = false) {
    if (first) { this.previous = null; this.prevOpen = ''; this.loadPrevious(); }
    try {
      const r = await this.api.req('GET', '/evaluations/' + this.evaluationId);
      this.current = r.evaluation; this.documents = r.documents || []; this.sections = r.sections || []; this.usage = r.usage;
      if (first) this.timer.start(this.evaluationId, this.current.work_seconds, this.locked());
      else if (this.locked()) this.timer.finish();
      if (first) {
        const c = this.current;
        this.placeDate = c.place_date || '';
        this.idModel = {name: c.patient_name || '', birth_date: c.birth_date || '', sex: c.sex || '', schooling: c.schooling || '', start_date: c.start_date || '', end_date: c.end_date || ''};
        this.closeRefs(); this.inspection = null; this.privacy = null; this.gen = {}; this.open = ''; this.editing = ''; this.mode = 'secoes';
        this.loadModels();
        const s = await this.api.req('GET', '/ai/settings').catch(() => null);
        this.aiReady = !!(s && s.enabled && s.configured && s.privacy_gate);
        this.step = !this.docsReady() ? 0 : this.aiOn() && !this.autoDrafted() ? 2 : 3;
      }
      if (this.docsReady() && !this.inspection) await this.inspect();
      if (this.docsReady() && !this.instructions.length || first) await this.loadInstructions();
      this.loaded = true;
      if (first && this.autoGenerate && this.aiOn() && this.docsReady() && !this.autoDrafted()) { this.step = 2; this.generateAll(true); }
    } catch {}
  }
  async inspect() {
    try { this.inspection = await this.api.req('POST', `/evaluations/${this.evaluationId}/inspect`); if (this.inspection?.synced) await this.load(); } catch { this.inspection = null; }
    if (this.canWrite()) try { this.privacy = await this.api.req('GET', `/evaluations/${this.evaluationId}/privacy`); } catch {}
    try { this.references = await this.api.req('GET', `/evaluations/${this.evaluationId}/references`); } catch { this.references = {}; }
  }
  refs(k: string) { return k === MANUAL_KEY ? [] : this.references[k] || []; }
  /** "No arquivo base, nesta seção" without what "Tabelas de referência" already shows (the tables and their captions). */
  fileShown(k: string): any[] {
    const refs = this.refs(k); if (!refs.length) return this.fileBlock(k);
    const caps = new Set(refs.map((t: any) => (t.caption || '').trim()).filter(Boolean));
    return this.fileBlock(k).filter(b => b.type !== 'table' && !(b.type === 'p' && caps.has((b.text || '').trim())));
  }
  /** Everything the base document has in this section, in Word order (kept in the Word file as it is). */
  fileBlock(k: string): any[] { return (this.references as any)?._blocks?.[k] || []; }
  /** What the conclusion is built from: the texts of the result sections (no demand, no anamnesis), as the API sends them. */
  conclusionSources() { return this.applicable().filter(s => !NOT_IN_CONCLUSION.includes(s.id) && !this.isFixed(s.id) && this.text(s.id).trim()).map(s => ({name: s.name, text: this.text(s.id)})); }
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
  /** Generate, edit, approve, preview and download are for the psychologist (and admin); the assistant uploads and reads. */
  canWrite() { const r = this.api.me()?.role; return r === 'admin' || r === 'psychologist'; }
  /** What is still missing before the evaluation can go on: identification, files, sections without a place or table,
   *  plus the consistency checks the server ran on the base document (inspection.checks). */
  // ---------- Pendências panel: one row per item, with the action that solves it ----------
  pendOpen = false;
  /** Review state from the review panel (badge, text, open correction requests). */
  review: {badge: {label: string; css: string; icon: string}; text: string; notes: any[]} | null = null;
  byIssue = (_: number, it: {key: string}) => it.key;
  private static names(list: string[]) { return list.length > 1 ? list.slice(0, -1).join(', ') + ' e ' + list.at(-1) + '.' : (list[0] || '') + '.'; }
  issues(): {key: string; level: string; title: string; desc: string; action: string; run: () => void}[] {
    const out: {key: string; level: string; title: string; desc: string; action: string; run: () => void}[] = [], id = this.idModel;
    const toId = () => { this.pendOpen = false; this.goStep(0); };
    if (id.name.trim().length < 2) out.push({key: 'name', level: 'danger', title: 'Nome do paciente ausente', desc: 'Obrigatório no laudo.', action: 'Completar dados', run: toId});
    const gaps = ([['birth_date', 'data de nascimento'], ['sex', 'sexo'], ['schooling', 'escolaridade'], ['start_date', 'data de início'], ['end_date', 'data de finalização']] as const)
      .filter(([k]) => !String(id[k] || '').trim()).map(([, l]) => l);
    if (gaps.length) { const d = EvaluationComponent.names(gaps); out.push({key: 'id', level: 'warn', title: 'Identificação incompleta', desc: d[0].toUpperCase() + d.slice(1), action: 'Completar dados', run: toId}); }
    if (!this.docName('base')) out.push({key: 'base', level: 'danger', title: 'Arquivo base ausente', desc: 'Envie o .docx da estagiária.', action: 'Enviar arquivo', run: toId});
    if (!this.docName('anamnesis')) out.push({key: 'ana', level: 'danger', title: 'Anamnese ausente', desc: 'Envie o .docx da psicóloga.', action: 'Enviar arquivo', run: toId});
    if (this.inspection && this.missing().length) out.push({key: 'missing', level: 'warn', title: this.missing().length === 1 ? 'Seção ausente no arquivo base' : 'Seções ausentes no arquivo base',
      desc: EvaluationComponent.names(this.missing()), action: this.resolveOpen ? 'Recolher' : 'Resolver', run: () => { this.resolveOpen = !this.resolveOpen; }});
    if (this.inspection && Object.keys(this.references).length) {
      const noTable = this.available().filter(s => this.references[s.id] !== undefined && s.id !== MANUAL_KEY && s.id !== 'recomendacoes' && !this.refs(s.id).length);
      if (noTable.length) out.push({key: 'tables', level: 'warn', title: 'Tabelas de resultados não encontradas', desc: EvaluationComponent.names(noTable.map(s => s.name)), action: 'Ver seções',
        run: () => { this.pendOpen = false; this.goStep(3); this.setMode('secoes'); this.select(noTable[0].id); }});
    }
    (this.inspection?.checks || []).forEach((c: any, i: number) => out.push({key: 'check' + i, level: c.level, title: c.text, desc: '', action: 'Ver', run: toId}));
    return out;
  }
  pendCount() { return this.issues().length + (this.review?.notes?.length || 0); }
  pendings(): Pending[] {
    const out: Pending[] = [], id = this.idModel;
    if (id.name.trim().length < 2) out.push({level: 'danger', text: 'Falta o nome do paciente.', step: 0});
    const gaps = ([['birth_date', 'data de nascimento'], ['sex', 'sexo'], ['schooling', 'escolaridade'], ['start_date', 'data de início'], ['end_date', 'data de finalização']] as const)
      .filter(([k]) => !String(id[k] || '').trim()).map(([, l]) => l);
    if (gaps.length) out.push({level: 'warn', text: 'Identificação incompleta: ' + gaps.join(', ') + '.', step: 0});
    if (!this.docName('base')) out.push({level: 'danger', text: 'Falta o arquivo base (estagiária).', step: 1});
    if (!this.docName('anamnesis')) out.push({level: 'danger', text: 'Falta a anamnese (psicóloga).', step: 1});
    if (this.inspection && this.missing().length) out.push({level: 'warn', text: 'Seções sem lugar no arquivo base: ' + this.missing().join(', ') + '.', step: 1});
    if (this.inspection && Object.keys(this.references).length) {
      const noTable = this.available().filter(s => this.references[s.id] !== undefined && s.id !== MANUAL_KEY && s.id !== 'recomendacoes' && !this.refs(s.id).length).map(s => s.name);
      if (noTable.length) out.push({level: 'warn', text: 'Sem tabela de resultados no arquivo base: ' + noTable.join(', ') + '.', step: 1});
    }
    for (const c of this.inspection?.checks || []) out.push({level: c.level, text: c.text, step: 1});
    return out;
  }
  /** Nothing can change: approved evaluation, or a role without write access. */
  readOnly() { return this.locked() || !this.canWrite(); }
  docName(kind: string) { return this.documents.filter(d => d.kind === kind).at(-1)?.filename || ''; }
  docCount() { return (this.docName('base') ? 1 : 0) + (this.docName('anamnesis') ? 1 : 0); }
  docsReady() { return this.docCount() === 2; }
  /** Sections this person needs. Percepção is for under 17 (text already written stays visible; unknown age: kept).
   * BFP and DIVA appear only when the base document has their field, even if old text exists. */
  applicable() {
    const age = ageYears(this.idModel.birth_date, this.idModel.end_date);
    const found = this.placeable();
    const list = SECTIONS.filter(s =>
      !(this.inspection && OPTIONAL_SECTIONS.includes(s.id) && !found.has(s.id)) &&
      !(s.id === 'percepcao' && !this.text(s.id).trim() && ((age !== null && age >= PERCEPTION_MAX_AGE) || (age === null && !!this.inspection && !found.has(s.id)))));
    // names as written in the document ("Comportamento social", "Sugestões e encaminhamentos")
    const named = list.map(s => ({...s, name: this.docTitle(s.id) || s.name}));
    if (!this.fixedBlocks().length) return named;
    // fixed parts of the file join the list in the order they appear in the Word document
    const all = [...named, ...this.fixedBlocks().map((b: any) => ({id: b.key, name: b.name}))];
    return all.map((s, i) => ({s, i, p: this.docPos(s.id)})).sort((a, b) => (a.p ?? 1e9) - (b.p ?? 1e9) || a.i - b.i).map(x => x.s);
  }
  /** Fixed parts under a heading box ("Fontes fundamentais", "Instrumentos aplicados"...): text of the file, editable by hand. */
  fixedBlocks() { return (this.inspection?.fixed_blocks || []).map((b: any) => ({...b, name: niceTitle(b.label)})); }
  docTitle(k: string) { const t = this.inspection?.titles?.[k]; return t ? niceTitle(t) : ''; }
  /** Untouched copy of the uploaded files (manual evaluations start from it). */
  fromFile(k: string) { const r = this.section(k); return !!r && r.source_summary === 'from_file' && (r.version || 1) === 1 && !!r.content?.trim(); }
  /** Section lists are rebuilt on every change check (names from the document): keep the same DOM rows by id, or clicks get lost. */
  bySection = (_: number, s: {id: string}) => s.id;
  byKind = (_: number, g: {kind: string}) => g.kind;
  isFixed(k: string) { return k.startsWith('fixo_'); }
  fixedText(k: string) { return this.fixedBlocks().find((b: any) => b.key === k)?.existing_text || ''; }
  private docPos(k: string): number | null {
    const m = (this.inspection?.markers || []).find((x: any) => x.key === k); if (m) return m.index;
    const f = this.fixedBlocks().find((b: any) => b.key === k); if (f) return f.index;
    const t = this.inspection?.title_ranges?.[k]; return t ? t[0] : null;
  }
  /** Sections the Word file can receive: those with an interpretation field, and titled sections without one
   * (the export creates the field right after their tables). */
  placeable() { return new Set([...this.inFile(), ...this.createdKeys()]); }
  /** Places the base document itself has. */
  private inFile() { return new Set([...(this.inspection?.markers || []).map((m: any) => m.key), ...Object.keys(this.inspection?.title_ranges || {}), ...this.fixedBlocks().map((b: any) => b.key)]); }
  // ---------- Sections the base document lacks, created in the Word by the psychologist's choice ----------
  createdKeys(): string[] { try { const v = JSON.parse(this.current?.created_sections || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
  /** Chosen to be created and not (or no longer) in the base document. */
  isCreated(k: string) { return !!this.inspection && this.createdKeys().includes(k) && !this.inFile().has(k); }
  /** A created interpretation has no tables in the file, so the AI has nothing of its own to write from (rule 10). */
  isInterpretation(k: string) { return INTERPRETATION_SLOTS.includes(k); }
  private createdWithoutData(k: string) { return this.isCreated(k) && this.isInterpretation(k); }
  missingKeys() { const ids = new Set(this.available().map(s => s.id)); return this.applicable().filter(s => !ids.has(s.id)); }
  /** Where the created section goes: before the next section the file has, else above the closing place and date. */
  createdPlace(k: string) {
    const i = SECTIONS.findIndex(s => s.id === k), file = this.inFile();
    const next = SECTIONS.slice(i + 1).find(s => file.has(s.id));
    return next ? `antes de "${next.name}"` : 'no final, antes do local e data';
  }
  creatingSection = '';
  // ---------- Sections the psychologist leaves out of the Word (approved exception to rule 2, always her choice) ----------
  excludedKeys(): string[] { try { const v = JSON.parse(this.current?.excluded_sections || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
  isExcluded(k: string) { return this.excludedKeys().includes(k); }
  /** Excluding a section of the base file removes its title, tables and texts from the exported copy; the uploaded file never changes. */
  async setExcluded(k: string, exclude: boolean) {
    if (this.readOnly() || this.locked() || this.creatingSection) return;
    const name = this.sectionName(k);
    if (exclude && !await this.confirm.ask({tone: 'danger', title: `Excluir "${name}" do documento?`,
      body: 'O título, as tabelas e os textos desta parte saem do Word baixado. O arquivo base enviado continua guardado como está.',
      facts: ['O texto escrito aqui continua salvo', 'A seção não precisa ser aprovada para finalizar', 'Você pode incluir a seção de novo depois'], ok: 'Excluir do documento'})) return;
    this.creatingSection = k;
    try {
      const r = await this.api.req('PUT', `/evaluations/${this.evaluationId}/excluded-sections`, {key: k, exclude});
      this.current = {...this.current, excluded_sections: r.excluded_sections.length ? JSON.stringify(r.excluded_sections) : null};
      this.api.notify(exclude ? `"${name}" foi excluída do documento.` : `"${name}" volta para o documento.`);
      if (this.inDocView()) this.renderPreview(true);
      this.changed.emit();
    } catch {} finally { this.creatingSection = ''; }
  }
  /** Why the generation buttons are off in this section. */
  handWhy(k: string) {
    if (HAND_ONLY.includes(k)) return 'Escrita só pela psicóloga: a IA nunca redige o diagnóstico.';
    if (this.isFixed(k)) return 'Texto fixo do arquivo: já entra aprovado. Se você editar, aprove de novo.';
    return 'Seção criada no documento, sem tabelas no arquivo: o texto é escrito por você.';
  }
  async setCreated(k: string, create: boolean) {
    if (this.readOnly() || this.locked() || this.creatingSection) return;
    if (!create) {
      const name = SECTIONS.find(s => s.id === k)?.name || k;
      if (!await this.confirm.ask({tone: 'danger', title: `Excluir "${name}" do documento?`, body: 'O título e o texto desta seção deixam de entrar no Word. O arquivo base não muda.', facts: ['O texto continua salvo nesta seção', 'Você pode criar a seção de novo depois'], ok: 'Excluir do documento'})) return;
    }
    this.creatingSection = k;
    try {
      const r = await this.api.req('PUT', `/evaluations/${this.evaluationId}/created-sections`, {key: k, create});
      this.current = {...this.current, created_sections: r.created_sections.length ? JSON.stringify(r.created_sections) : null};
      const name = SECTIONS.find(s => s.id === k)?.name || k;
      this.api.notify(create ? `"${name}" será criada no Word ${this.createdPlace(k)}. Escreva o texto da seção.` : `"${name}" foi excluída do documento.`);
      if (create && this.step === 3) { this.mode = 'secoes'; this.select(k); }
      this.changed.emit();
    } catch {} finally { this.creatingSection = ''; }
  }
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
  text(k: string) { return this.section(k)?.content || (this.isFixed(k) ? this.fixedText(k) : ''); }
  private domSan = inject(DomSanitizer);
  /** Saved formatting of the section, only while it still matches the text (any other change, e.g. a new AI draft, drops it). */
  richOf(k: string): string {
    const s = this.section(k), h = s?.content_html;
    // untouched fixed part of the file: its own formatting (bold labels, lists)
    if (!s?.content && this.isFixed(k)) { const f = this.fixedBlocks().find((b: any) => b.key === k)?.existing_html; return f ? sanitizeHtml(f) : ''; }
    if (!h || !s?.content) return '';
    const n = (t: string) => t.replace(/\s+/g, ' ').trim();
    return n(textFromHtml(h)) === n(s.content) ? sanitizeHtml(h) : '';
  }
  private richCache = new Map<string, any>();
  richView(k: string) { const h = this.richOf(k); let v = this.richCache.get(h); if (!v) { v = this.domSan.bypassSecurityTrustHtml(h); this.richCache.set(h, v); } return v; }
  @ViewChild('rte') rte?: RichEditorComponent;
  /** Every editor on screen; the editors send typed text after a short pause, so saves call flushEditors() first. */
  @ViewChildren(RichEditorComponent) editors?: QueryList<RichEditorComponent>;
  private flushEditors() { this.editors?.forEach(e => e.flush()); }
  /** The Word preview is rebuilt only after a longer pause in typing (rebuilding it is heavy and froze the typing). */
  private previewTimer: any = null; private typedAt = 0;
  private previewLater() {
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      if (Date.now() - this.typedAt < 2500) { this.previewLater(); return; }
      if (this.inDocView()) this.renderPreview(true);
    }, 2500);
  }
  editHtml = ''; editInitHtml = '';
  onEditText(k: string, t: string) { this.typedAt = Date.now(); this.editText = t; this.saveState = this.isDirty() ? 'dirty' : 'saved'; this.emNarr.stop(); this.autosaveLater(k); }
  /** Replaces the whole text being edited (answer pasted from ChatGPT). */
  private setEditText(t: string) { this.editText = t; this.editInitHtml = this.editHtml = htmlFromText(t); }
  state(k: string): SectionState { const s = this.section(k); if (this.isFixed(k) && !s?.content?.trim()) return 'file'; return !s?.content?.trim() ? 'pend' : s.status === 'approved' ? 'ap' : 'gen'; }
  /** Approved, or a fixed text of the base file left as it is (the Word keeps the original paragraphs: approved by itself). */
  done(k: string) { const st = this.state(k); return st === 'ap' || st === 'file'; }
  drafted() { return this.available().filter(s => this.state(s.id) !== 'pend').length; }
  approved() { return this.available().filter(s => this.done(s.id) || this.isExcluded(s.id)).length; }
  total() { return this.available().length; }
  allApproved() { return this.locked() || (this.total() > 0 && this.approved() === this.total()); }
  status() { return this.allApproved() ? STATUS.ap : this.autoDrafted() ? STATUS.rv : STATUS.rs; }
  summary() {
    const c = this.current; if (!c) return '';
    return [ageText(c.birth_date, c.end_date), c.sex, c.schooling].filter(Boolean).join(' · ');
  }
  warnings(k: string): string[] { try { return JSON.parse(this.section(k)?.source_summary || '[]'); } catch { return []; } }
  /** Manual evaluations never call the AI: the professional writes every section. */
  aiOn() { return this.current?.ai_mode !== 'manual'; }
  /** Manual evaluation: the AI is used only when the person picks it for one section, after confirming once per evaluation. */
  private manualAiOk = '';
  async allowSectionAi(): Promise<boolean> {
    if (this.aiOn() || this.manualAiOk === this.evaluationId) return true;
    if (!await this.confirm.ask({tone: 'review', title: 'Usar a IA nesta seção?',
      body: 'Esta avaliação é manual. Os dados desta seção só vão para a IA porque você escolheu, com nomes, datas e contatos trocados por marcadores.',
      facts: ['As outras seções continuam manuais', 'O texto da IA é rascunho: você revisa e aprova', 'A avaliação continua no modo Manual'], ok: 'Usar a IA'})) return false;
    this.manualAiOk = this.evaluationId; return true;
  }
  /** Body of a section-level AI request: a manual evaluation says the person chose it. */
  aiBody(extra: any = {}) { return this.aiOn() ? extra : {...extra, manual_ai: true}; }
  async toggleCg(k: string) { if (this.cgOpen === k) { this.cgOpen = ''; return; } if (await this.allowSectionAi()) { this.gptOpen = ''; this.cgOpen = k; } }
  /** Closing "Cidade, data." line: what the evaluation saved, else what the base document says. */
  placeDate = '';
  placeInFile() { return this.inspection?.place_date || ''; }
  async savePlaceDate(v = this.placeDate) {
    const value = (v || '').replace(/\s+/g, ' ').trim();
    if (value === (this.current?.place_date || '') || this.readOnly()) return;
    try { await this.api.req('PUT', `/evaluations/${this.evaluationId}/place-date`, {value}); this.current = {...this.current, place_date: value || null}; this.placeDate = value; this.api.notify(value ? 'Local e data atualizados.' : 'Local e data voltam a ser os do arquivo.'); } catch {}
  }
  /** City of the line in use + today's date in words ("Uberlândia, 7 de novembro de 2026."). */
  todayPlaceDate() {
    const base = this.placeDate || this.placeInFile();
    const city = base.includes(',') ? base.split(',')[0].trim() : '';
    const d = new Date(), months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    const text = `${d.getDate()} de ${months[d.getMonth()]} de ${d.getFullYear()}.`;
    this.placeDate = city ? `${city}, ${text}` : text;
    if (city) this.savePlaceDate();
  }
  async setAiMode(mode: 'ai' | 'manual') {
    if ((this.current?.ai_mode || 'ai') === mode || this.readOnly()) return;
    if (mode === 'ai' && !await this.confirm.ask(AI_MODE_CONFIRM)) return;
    try { await this.api.req('PUT', `/evaluations/${this.evaluationId}/mode`, {mode}); this.current = {...this.current, ai_mode: mode}; this.changed.emit(); if (mode === 'manual' && this.step === 2) this.goStep(3); if (mode === 'manual' && this.docsReady()) await this.inspect(); this.api.notify(mode === 'manual' ? 'Avaliação manual: a IA fica desligada.' : 'IA ligada nesta avaliação.'); } catch {}
  }
  stepDone(i: number) {
    if (i === 2 && !this.aiOn()) return this.docsReady(); return [this.idModel.name.trim().length >= 2 && this.docsReady(), this.docsReady(), this.autoKeys().length > 0 && this.autoDrafted() === this.autoKeys().length, this.allApproved()][i]; }
  stepSub(i: number) {
    if (i === 0) return !this.idModel.name.trim() ? 'Falta o nome' : `${this.docCount()} de 2 arquivos`;
    if (i === 1) return `${this.docCount()} de 2 enviados`;
    if (i === 2 && !this.aiOn()) return 'Sem IA';
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
    if (v.name.trim().length < 2 || this.readOnly()) return;
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
    const wasReady = this.docsReady();
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
    } catch { return; } finally { this.uploading = ''; }
    await this.offerGeneration(wasReady);
  }
  /** The second file completes the pair: nothing drafted yet, so offer the AI drafting right away (paid call, so it asks first). */
  private async offerGeneration(wasReady: boolean) {
    if (!this.aiOn()) return;
    if (wasReady || !this.docsReady() || this.readOnly() || this.generating || this.autoDrafted()) return;
    this.step = 2;
    if (!this.aiReady) return;
    const n = this.autoKeys().length;
    if (!n || !await this.confirm.ask({tone: 'review', title: 'Gerar os textos com IA agora?',
      body: `Os dois arquivos foram enviados. A IA redige ${n} ${n === 1 ? 'seção' : 'seções'} como rascunho para sua revisão.`,
      facts: ['Cada seção usa só os dados do próprio tópico', 'Nomes e dados pessoais são ocultados antes do envio', 'O custo entra em Custo da IA desta avaliação'],
      ok: 'Gerar com IA'})) return;
    await this.generateAll(true);
  }

  // ---------- step 3: generation ----------
  autoKeys() { return this.available().map(s => s.id).filter(k => k !== MANUAL_KEY && k !== DEMAND_KEY && !this.isHand(k)); }
  /** Sections the AI never writes (the diagnostic hypothesis, fixed parts, interpretations created without tables). */
  isHand(k: string) { return HAND_ONLY.includes(k) || this.isFixed(k) || this.createdWithoutData(k); }
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
    await this.regenerate(DEMAND_KEY, false, true);
  }
  hasConclusion() { return this.available().some(s => s.id === MANUAL_KEY); }
  genKeys() { return Object.keys(this.gen); }
  genDone() { return Object.values(this.gen).filter(g => g === 'done' || g === 'error' || g === 'skipped').length; }
  genPct() { const n = this.genKeys().length; return n ? Math.round(this.genDone() / n * 100) : 0; }
  dotClass(k: string) { const g = this.gen[k]; if (g === 'running') return 'warn pulse'; if (g === 'error') return 'err'; if (g === 'done') return 'ok'; return this.done(k) ? 'ok' : this.state(k) === 'gen' ? 'warn' : ''; }
  rowLabel(k: string) { if (k === DEMAND_KEY && !this.gen[k]) return this.state(k) === 'pend' ? 'Sem texto no arquivo' : this.demandIsFromFile() ? 'Do arquivo enviado' : SECTION_STATE[this.state(k)].label; if (k === MANUAL_KEY && !this.gen[k] && this.state(k) === 'pend') return 'Você gera na etapa 4'; const g = this.gen[k]; if (g === 'running') return 'Gerando…'; if (g === 'pending') return 'Na fila'; if (g === 'error') return 'Erro'; if (g === 'skipped') return 'Não gerada'; return SECTION_STATE[this.state(k)].label; }

  async generateAll(skipConfirm = false, only?: string[]) {
    if (!this.aiOn()) { this.api.notify('Avaliação manual: a IA está desligada. Mude para Com IA em Identificação.'); return; }
    if (!this.aiReady) { this.api.notify('Geração pela API desligada. Ative em Configurações.'); return; }
    if (!skipConfirm && this.autoDrafted() && !await this.confirm.ask({tone: 'review', title: 'Gerar tudo de novo?',
      body: 'Os textos atuais de todas as seções geradas pela IA serão substituídos por novas versões. Edições feitas nelas serão perdidas.',
      facts: ['As versões anteriores ficam no histórico', 'Todas as seções voltam para revisão', 'O custo entra em Custo da IA desta avaliação'], ok: 'Gerar todas de novo'})) return;
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
    const ins = this.instruction(k); if (!ins || this.readOnly()) return true;
    const value = (text || '').trim();
    if ((ins.custom || this.inherited(ins)) === value) return true;
    try {
      const r = await this.api.req('PUT', `/evaluations/${this.evaluationId}/instructions/${k}`, {prompt: value && value !== this.inherited(ins) ? value : null});
      ins.custom = r.custom; this.instrDraft[k] = r.custom || this.inherited(ins);
      return true;
    } catch { return false; }
  }
  /** Dictated text reaches the instruction field without a blur, so it is saved shortly after. */
  saveInstructionLater(k: string) { clearTimeout(this.instrSaveTimer); this.instrSaveTimer = setTimeout(() => this.saveInstruction(k), 1500); }
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
  select(k: string) { if (k && this.cur() !== k) this.toggle(k); }
  // ---------- Conferir seções: navegação ----------
  // 'compacta' (padrão): a seção aberta em destaque, anterior/próxima, uma barra fina e o menu "Todas as seções".
  // 'barra': o modelo anterior, uma barra por seção com o nome embaixo. A escolha fica salva neste navegador.
  secMenu = false; secFilter: '' | 'ok' | 'warn' | 'idle' | 'missing' = '';
  secKind(k: string) { return this.isMissing(k) ? 'missing' : SECTION_STATE[this.state(k)].css; }
  secBadge(k: string) { return 'badge ' + (this.isMissing(k) ? 'danger' : SECTION_STATE[this.state(k)].css); }
  secLabel(k: string) { return this.isMissing(k) ? 'Falta no documento' : SECTION_STATE[this.state(k)].label; }
  secNum(k: string) { return (this.reviewRows().findIndex(s => s.id === k) + 1).toString().padStart(2, '0'); }
  curIndex() { const c = this.cur(); return this.reviewRows().findIndex(s => s.id === c); }
  curName() { return this.reviewRows()[this.curIndex()]?.name || ''; }
  neighbor(d: number) { return this.reviewRows()[this.curIndex() + d]; }
  stepSection(d: number) { const s = this.neighbor(d); if (s) { this.secMenu = false; this.select(s.id); } }
  pickSection(k: string) { this.secMenu = false; this.select(k); }
  /** Progress summary of the section bar: only the kinds that have sections. */
  secGroups() {
    return ([{kind: 'ok', one: 'aprovada', label: 'aprovadas'}, {kind: 'warn', one: 'para revisar', label: 'para revisar'},
      {kind: 'idle', one: 'pendente', label: 'pendentes'}, {kind: 'missing', one: 'falta no documento', label: 'faltam no documento'}] as {kind: 'ok' | 'warn' | 'idle' | 'missing'; one: string; label: string}[]).filter(g => this.secCount(g.kind));
  }
  secCount(kind: string) { return this.reviewRows().filter(s => this.secKind(s.id) === kind).length; }
  /** A status in the summary filters the list and the bars; a second click on it shows all again. */
  pickLegend(kind: 'ok' | 'warn' | 'idle' | 'missing') { this.secFilter = this.secMenu && this.secFilter === kind ? '' : kind; this.secMenu = true; }
  /** Bars of the progress strip: all sections, or only the filtered ones while the section list is open. */
  barRows() { return this.secMenu && this.secFilter ? this.secMenuRows() : this.reviewRows(); }
  secMenuRows() { return this.secFilter ? this.reviewRows().filter(s => this.secKind(s.id) === this.secFilter) : this.reviewRows(); }
  // ---------- Documento, modelo B: section texts beside the Word ----------
  /** Section whose text is open in the side list and marked in the Word. */
  docActive = '';
  // ---------- "Editar documento": all section texts in one continuous page ----------
  // Only the section texts are editable (the approved destinations); each one is saved to its own section, so the
  // Seções view, versions and the Word all show the change. Nothing of the base file itself becomes editable.
  docEditing = false; docFinishing = false; docSaving = 0; docSavedAt = '';
  docInit: Record<string, string> = {};
  private docDraft: Record<string, {text: string; html: string}> = {};
  private docTimers: Record<string, any> = {};
  docEditRows() { return this.reviewRows().filter(s => !this.isMissing(s.id)); }
  async startDocEdit() {
    if (this.readOnly() || this.docEditing) return;
    if (this.editing) await this.closeEdit();
    this.docInit = {}; this.docDraft = {}; this.docSavedAt = '';
    for (const s of this.docEditRows()) { const t = this.text(s.id); this.docInit[s.id] = this.richOf(s.id) || htmlFromText(t); this.docDraft[s.id] = {text: t, html: this.docInit[s.id]}; }
    this.docEditing = true;
    if (this.docActive) setTimeout(() => document.getElementById('de-' + this.docActive)?.scrollIntoView({block: 'start'}));
  }
  onDocText(k: string, t: string) { this.typedAt = Date.now(); (this.docDraft[k] ??= {text: '', html: ''}).text = t; this.docLater(k); }
  onDocHtml(k: string, h: string) { (this.docDraft[k] ??= {text: '', html: ''}).html = h; this.docLater(k); }
  private docLater(k: string) { clearTimeout(this.docTimers[k]); this.docTimers[k] = setTimeout(() => { delete this.docTimers[k]; this.saveDocSection(k); }, 1200); }
  private async saveDocSection(k: string) {
    const d = this.docDraft[k]; if (!d) return;
    const s = this.section(k);
    if (!d.text.trim() || (d.text === this.text(k) && (!s || d.html === s.content_html))) return;
    this.docSaving++;
    try {
      await this.api.req('PUT', `/evaluations/${this.evaluationId}/sections/${k}`, {content: d.text, html: d.html, merge: true});
      if (s) { s.content = d.text; s.content_html = d.html; s.status = 'edited'; }
      this.docSavedAt = new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'});
    } catch {} finally { this.docSaving--; }
  }
  /** Saves what is still waiting, leaves the editing page and shows the Word with the new texts. */
  async finishDocEdit() {
    if (!this.docEditing || this.docFinishing) return;
    this.docFinishing = true;
    try {
      this.flushEditors();
      const waiting = Object.keys(this.docTimers);
      for (const k of waiting) clearTimeout(this.docTimers[k]);
      this.docTimers = {};
      for (const k of waiting) await this.saveDocSection(k);
      this.docEditing = false;
      await this.load(); this.changed.emit();
      if (this.inDocView()) { this.docIndex = null; this.renderPreview(true); }
    } finally { this.docFinishing = false; }
  }
  /** Width of the side panel in the Documento view, dragged by the divider (kept per browser); 0 = default. */
  sideW = (() => { try { return Number(localStorage.getItem('nl-doc-side')) || 0; } catch { return 0; } })();
  private saveSideW() { try { if (this.sideW) localStorage.setItem('nl-doc-side', String(Math.round(this.sideW))); else localStorage.removeItem('nl-doc-side'); } catch {} }
  startResize(e: PointerEvent, side: HTMLElement) {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement, startX = e.clientX, startW = side.getBoundingClientRect().width;
    const box = side.parentElement!.getBoundingClientRect().width, scale = startW / (side.offsetWidth || startW) || 1;
    handle.setPointerCapture(e.pointerId); document.body.classList.add('nl-resizing');
    const move = (ev: PointerEvent) => { this.sideW = Math.min(box - 360, Math.max(280, startW + ev.clientX - startX)) / scale; };
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); document.body.classList.remove('nl-resizing'); this.saveSideW(); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
  }
  resizeKey(e: KeyboardEvent, side: HTMLElement) {
    const step = e.key === 'ArrowLeft' ? -40 : e.key === 'ArrowRight' ? 40 : 0; if (!step) return;
    e.preventDefault(); this.sideW = Math.max(280, (this.sideW || side.offsetWidth) + step); this.saveSideW();
  }
  resetSide() { this.sideW = 0; this.saveSideW(); }
  docSideRows() { return this.reviewRows().filter(s => !this.isMissing(s.id) && !this.isFixed(s.id)); }
  showInDoc(k: string) { this.docActive = k; this.jumpToSection(k); }
  async approveInDoc(k: string) { await this.approveAndNext(k); this.docActive = k; this.docJump = k; await this.renderPreview(); }
  /** Edits inside the side card; the Word beside it is rebuilt after each pause in typing. */
  editFromDoc(k: string) { this.docActive = k; this.startEdit(k); }
  closeDocCard() { if (this.editing) this.closeEdit(); this.docActive = ''; this.paint('nl-target', []); }
  private inDocView() { return this.step === 3 && this.mode === 'documento'; }
  /** Section before (-1) or after (1) this one in the review order. */
  neighbour(k: string, d: -1 | 1) { const rows = this.reviewRows(), i = rows.findIndex(s => s.id === k); return rows[i + d]?.id || ''; }
  neighbourName(k: string, d: -1 | 1) { const n = this.neighbour(k, d); return n ? this.sectionName(n) : ''; }
  sourceLabel(k: string) {
    if (k === DEMAND_KEY || k === 'anamnesis') return 'escrita a partir da anamnese';
    if (k === MANUAL_KEY) return 'escrita a partir das seções de resultados';
    if (k === 'recomendacoes') return 'escrita a partir das seções do laudo';
    if (this.isFixed(k)) return 'texto do arquivo base; pode ser reescrito à mão';
    if (this.isHand(k)) return 'escrita pela psicóloga, sem IA';
    return 'escrita a partir das tabelas do arquivo base';
  }
  toggle(k: string) { this.reader.stop(); this.closeRefs(); this.gptOpen = ''; this.open = this.open === k ? '' : k; this.editing = ''; this.sectionInstr = ''; }
  // ---------- autosave while editing: one version per editing session (merge:true on the server) ----------
  private autoTimer: any = null; autoSaved = ''; autoSaving = false;
  versionsOpen = '';
  /** Patient's previous approved evaluation (re-evaluation), for comparison only. */
  previous: any = null; prevOpen = '';
  async loadPrevious() { try { this.previous = (await this.api.req<any>('GET', `/evaluations/${this.evaluationId}/previous`)).previous; } catch { this.previous = null; } }
  // ---------- standard texts (Configurações > Textos-padrão), inserted at the cursor ----------
  snippets: any[] = []; private snippetsLoaded = false;
  async loadSnippets() { if (this.snippetsLoaded || !this.canWrite()) return; this.snippetsLoaded = true; try { this.snippets = await this.api.req('GET', '/snippets'); } catch {} }
  snippetsFor(k: string) { return this.snippets.filter(x => !x.section_key || x.section_key === k).map(x => ({label: x.title, value: x.id, group: x.section_key ? 'Desta seção' : 'Qualquer seção'})); }
  insertSnippet(id: string) {
    const sn = this.snippets.find(x => x.id === id); if (!sn) return;
    this.rte?.insertText(sn.text);
  }
  autosaveLater(k: string) { clearTimeout(this.autoTimer); this.autoTimer = setTimeout(() => this.autosave(k), this.inDocView() ? 1200 : this.editFull ? 1500 : 2500); }
  /** What the server has for the section being edited (set at start and after each confirmed save). */
  private lastSaved = {content: '', html: ''};
  private inflight: Promise<boolean> | null = null;
  /** Real saving state: success only after the server answers. */
  saveState: 'saved' | 'dirty' | 'saving' | 'error' | 'empty' = 'saved';
  isDirty() { return !!this.editing && (this.editText !== this.lastSaved.content || this.editHtml !== this.lastSaved.html); }
  /** Saves the section being edited. One request at a time, so an older answer never overwrites newer text; on error the
   *  text stays on screen and can be sent again. The server merges these saves into one version (no version per pause). */
  async autosave(k: string): Promise<boolean> {
    this.autoTimer = null;
    if (!k || this.editing !== k || this.readOnly()) return true;
    if (this.inflight) { await this.inflight; if (this.editing !== k) return true; }
    if (!this.isDirty()) { if (this.saveState !== 'error') this.saveState = 'saved'; return true; }
    if (!this.editText.trim()) { this.saveState = 'empty'; return false; }
    const content = this.editText, html = this.editHtml;
    this.autoSaving = true; this.saveState = 'saving';
    const req = (async () => {
      try { await this.api.req('PUT', `/evaluations/${this.evaluationId}/sections/${k}`, {content, html, merge: true}); return true; } catch { return false; }
    })();
    this.inflight = req;
    const ok = await req;
    this.inflight = null; this.autoSaving = false;
    if (!ok) { this.saveState = 'error'; return false; }
    this.lastSaved = {content, html};
    const s = this.section(k); if (s) { s.content = content; s.content_html = html; s.status = 'edited'; }
    this.autoSaved = new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'});
    if (this.inDocView()) this.previewLater();
    this.saveState = this.isDirty() ? 'dirty' : 'saved';
    if (this.isDirty() && this.editing === k) this.autosaveLater(k);
    return true;
  }
  /** Sends what is pending now (the last dictated words included) and waits for the server. */
  async flushSave(): Promise<boolean> {
    clearTimeout(this.autoTimer); this.autoTimer = null;
    if (!this.editing) return true;
    await this.dictation.stop();
    this.flushEditors();
    clearTimeout(this.autoTimer); this.autoTimer = null;
    return this.autosave(this.editing);
  }
  /** Leaves edit mode; text already saved automatically stays saved. */
  async closeEdit() { clearTimeout(this.previewTimer); clearTimeout(this.autoTimer); this.autoTimer = null; const saved = !!this.autoSaved; this.editing = ''; this.autoSaved = ''; if (saved) { await this.load(); this.changed.emit(); if (this.inDocView()) this.renderPreview(true); } }
  startEdit(k: string) { this.reader.stop(); this.loadSnippets(); this.versionsOpen = ''; this.autoSaved = ''; this.editing = k; this.editText = this.text(k); this.editInitHtml = this.editHtml = this.richOf(k) || htmlFromText(this.editText); this.lastSaved = {content: this.editText, html: this.editInitHtml}; this.saveState = 'saved'; this.sectionInstr = ''; setTimeout(() => this.rte?.focus()); }
  async saveEdit(k: string) {
    await this.dictation.stop(); // the last dictated words enter the text before it is saved
    this.flushEditors();
    if (!this.editText.trim()) { this.api.notify('O texto não pode ficar vazio.'); return; }
    clearTimeout(this.autoTimer); this.autoTimer = null;
    try { await this.api.req('PUT', `/evaluations/${this.evaluationId}/sections/${k}`, {content: this.editText, html: this.editHtml, merge: true}); this.editing = ''; this.autoSaved = ''; await this.load(); this.changed.emit(); if (this.inDocView()) this.renderPreview(true); this.api.notify('Texto salvo. A seção voltou para revisão.'); } catch {}
  }
  // ---------- Full-window edit mode (index, editor sheet, tools; autosave as above) ----------
  private zone = inject(NgZone);
  /** Ctrl + wheel: the Word preview when it is on screen (alone or in the document view), else the edit mode's text zoom. */
  private wheel = inject(WheelZoom);
  private unwheel = this.wheel.register(dir => {
    if (this.reading.doc() && !this.docOnly) return false;
    if (this.docOnly || (this.mode === 'documento' && this.step === 3 && !this.editFull)) {
      // the Word page scales at once; the real zoom (a full re-layout of the document) only when the wheel stops
      const box = this.previewBox?.nativeElement, cur = this.wheel.current(box, this.zoom);
      const next = Math.min(2.5, Math.max(0.5, Math.round((cur + dir * 0.1) * 10) / 10));
      this.wheel.preview(box, this.zoom, next, v => this.setZoom(v - this.zoom), Math.round(next * 100) + '%');
      return true;
    }
    if (this.editFull && this.editing) {
      const el = this.rte?.element, z = this.EM_ZOOMS, cur = this.wheel.current(el, this.emZoom), i = z.indexOf(cur);
      const next = z[Math.max(0, Math.min(z.length - 1, (i < 0 ? 2 : i) + dir))];
      this.wheel.preview(el, this.emZoom, next, v => { this.emZoom = v; }, Math.round(next * 100) + '%');
      return true;
    }
    return false;
  });
  editFull = false;
  emSide = true; emTools = true; emZoom = 1; emFull = false;
  emPanel: '' | 'find' | 'versions' | 'listen' | 'ai' = '';
  emFind = {q: '', by: '', matchCase: false, word: false}; emFound = 0; emFoundAt = -1;
  /** Text at the start of this editing session, for "Descartar alterações desta sessão". */
  private emStart = {key: '', content: '', html: ''};
  readonly emNarr = new Narrator(this.zone);
  @ViewChild('emDict') emDict?: DictateComponent;
  readonly EM_ZOOMS = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
  readonly EM_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
  /** Sheet widths of the edit mode (same names as in the reading mode); kept in this browser. */
  readonly EM_WIDTHS = [
    {id: 'narrow', name: 'Estreita', hint: 'folha de 680 px', px: 680, pct: 38},
    {id: 'normal', name: 'Confortável', hint: 'folha de 900 px', px: 900, pct: 50},
    {id: 'wide', name: 'Ampla', hint: 'folha de 1.100 px', px: 1100, pct: 66},
    {id: 'xwide', name: 'Muito ampla', hint: 'folha de 1.400 px', px: 1400, pct: 84},
    {id: 'full', name: 'Toda a largura', hint: 'ocupa toda a área do editor', px: 0, pct: 100}];
  emWidth = (() => { try { const v = localStorage.getItem('nl.edit.width') || ''; return ['narrow', 'normal', 'wide', 'xwide', 'full'].includes(v) ? v : 'normal'; } catch { return 'normal'; } })();
  emWidthPreview = '';
  emWidthOpen = false;
  emSheet() { const id = this.emWidthPreview || this.emWidth; return this.EM_WIDTHS.find(w => w.id === id)?.px ?? 900; }
  emWidthName() { return this.EM_WIDTHS.find(w => w.id === this.emWidth)?.name || ''; }
  emPickWidth(id: string) { this.emWidth = id; this.emWidthPreview = ''; this.emWidthOpen = false; try { localStorage.setItem('nl.edit.width', id); } catch {} }
  /** Saves, leaves the edit mode and shows the section in the Word preview. */
  async emSeeInDoc() { if (!await this.emSafe()) return; const k = this.editing; this.emLeave(); this.viewInDocument(k); }
  emNarrow() { return window.innerWidth < 1000; }

  /** Opens the edit mode on a section (header "Escrever/Editar"). */
  openEditMode(k: string) {
    if (this.readOnly()) return;
    this.reading.close();
    this.startEdit(k);
    this.emStart = {key: k, content: this.editText, html: this.editInitHtml};
    this.editFull = true; this.emPanel = '';
    const narrow = this.emNarrow(); this.emSide = !narrow; this.emTools = !narrow;
    document.documentElement.classList.add('nl-reading-open');
    this.emNarr.onSegment = i => { const sg = i === null ? undefined : this.emNarr.segment(i); highlight('nl-speak', sg ? [sg.range] : []); if (sg) (sg.range.startContainer.parentElement as HTMLElement | null)?.scrollIntoView({block: 'center', behavior: 'smooth'}); };
    this.emNarr.loadVoices();
  }
  emIndex() { return this.reviewRows(); }
  emPos() { return this.reviewRows().findIndex(s => s.id === this.editing); }
  emName() { return this.sectionName(this.editing); }
  emWords() { return words(this.editText); }
  emChars() { return this.editText.replace(/\n/g, '').length; }
  emOrigin(): string {
    const k = this.editing, r = this.section(k);
    if (!r) return '';
    if (this.fromFile(k)) return 'Texto do arquivo base';
    if (r.status === 'draft' || r.status === 'review') return 'Rascunho gerado por IA';
    if (r.status === 'edited') return 'Texto editado à mão';
    return '';
  }
  emSaveLabel() {
    return ({saved: 'Todas as alterações salvas', dirty: 'Alterações não salvas', saving: 'Salvando…', error: 'Falha ao salvar', empty: 'Texto vazio não é salvo'} as const)[this.saveState];
  }
  /** Saves first; if the server refuses, the person decides (try again or stay). Never drops text silently. */
  private async emSafe(): Promise<boolean> {
    for (;;) {
      if (await this.flushSave()) return true;
      const empty = this.saveState === 'empty';
      const retry = await this.confirm.ask({tone: 'review', title: empty ? 'O texto está vazio' : 'Não foi possível salvar',
        body: empty ? 'Uma seção não pode ser salva sem texto. Escreva algo ou desfaça (Ctrl+Z) antes de sair.' : 'As alterações desta seção ainda não chegaram ao servidor. Elas continuam aqui na tela.',
        ok: empty ? 'Ficar na seção' : 'Tentar de novo', cancel: empty ? 'Sair sem salvar' : 'Ficar na seção'});
      if (empty) return !retry;          // "Sair sem salvar" (cancel) leaves; the saved text stays as it was
      if (!retry) return false;
    }
  }
  /** Message of the loading layer shown while switching modes or sections (only when it takes more than a blink). */
  busyMsg = ''; private busyTimer: any;
  private async busy<T>(msg: string, fn: () => Promise<T> | T): Promise<T> {
    clearTimeout(this.busyTimer); this.busyTimer = setTimeout(() => this.busyMsg = msg, 120);
    try {
      const r = await fn();
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(null))));   // the new screen is drawn
      return r;
    } finally { clearTimeout(this.busyTimer); this.busyMsg = ''; }
  }
  confirmOpen() { return !!this.confirm.current(); }
  goEdit(k: string) { return this.busy('Abrindo o modo edição…', () => this.openEditMode(k)); }
  goRead(k: string) { return this.busy('Abrindo o modo leitura…', () => this.readSection(k)); }
  emGo(k: string) {
    if (!k || k === this.editing) { if (this.emNarrow()) this.emSide = false; return Promise.resolve(); }
    return this.busy('Salvando e abrindo a seção…', () => this.emGoNow(k));
  }
  private async emGoNow(k: string) {
    if (!await this.emSafe()) return;
    this.emNarr.stop(); this.rte?.clearFind(); this.emFound = 0; this.emFoundAt = -1;
    this.select(k); this.startEdit(k);
    this.emStart = {key: k, content: this.editText, html: this.editInitHtml};
    if (this.emNarrow()) this.emSide = false;
    if (this.emPanel === 'versions') this.emPanel = '';
  }
  emStep(d: -1 | 1) { const rows = this.reviewRows(), i = this.emPos(); const n = rows[i + d]; if (n) this.emGo(n.id); }
  /** Leaves the edit mode keeping what is saved (after saving what is pending). */
  async emClose(done = false) {
    if (!await this.emSafe()) return;
    this.emLeave();
    if (done) this.api.notify('Edição concluída. A seção continua em revisão.');
  }
  private emLeave() {
    this.emNarr.stop(); highlight('nl-speak', []); this.rte?.clearFind();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    document.documentElement.classList.remove('nl-reading-open');
    this.editFull = false; this.emPanel = '';
    this.closeEdit();
  }
  emCanDiscard() { return this.emStart.key === this.editing && !!this.emStart.content.trim() && (this.editText !== this.emStart.content || this.editHtml !== this.emStart.html); }
  /** Puts back the text this editing session started with (saved again, so it becomes the current version). */
  async emDiscard() {
    if (!this.emCanDiscard()) return;
    if (!await this.confirm.ask({tone: 'danger', title: 'Descartar as alterações desta sessão?', body: 'O texto volta a ser exatamente o que era quando você abriu o modo edição nesta seção. As mudanças feitas desde então saem do texto.',
      facts: ['O texto descartado fica em Versões, se já tinha sido salvo', 'Outras seções não mudam'], ok: 'Descartar alterações'})) return;
    this.flushEditors(); // nothing typed may arrive after the text is put back
    clearTimeout(this.autoTimer); this.autoTimer = null;
    await this.dictation.stop();
    if (this.inflight) await this.inflight;
    const k = this.editing, {content, html} = this.emStart;
    try {
      await this.api.req('PUT', `/evaluations/${this.evaluationId}/sections/${k}`, {content, html, merge: true});
      const sec = this.section(k); if (sec) { sec.content = content; sec.content_html = html; }
      this.startEdit(k); this.emStart = {key: k, content, html};
      this.api.notify('Alterações descartadas.');
    } catch { this.saveState = 'error'; }
  }
  async emRetry() { await this.flushSave(); }
  /** "Salvar" in the bar (and Ctrl+S): sends what is pending now and says how it went. */
  async emSaveNow() {
    const had = this.isDirty() || this.saveState === 'error';
    const ok = await this.flushSave();
    if (ok) this.api.notify(had ? 'Alterações salvas.' : 'Tudo já estava salvo.');
    else if (this.saveState === 'empty') this.api.notify('Texto vazio não é salvo.');
  }
  emUndo() { this.rte?.undo(); this.rte?.focus(); }
  emRedo() { this.rte?.redo(); this.rte?.focus(); }
  async emToggleFull() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await (document.querySelector('.em') as HTMLElement | null)?.requestFullscreen(); } catch {}
  }
  @HostListener('document:fullscreenchange') emFullChange() { this.emFull = !!document.fullscreenElement && !!document.querySelector('.em'); }
  emCanFull() { return !!document.fullscreenEnabled; }
  emToReading() { return this.busy('Salvando e abrindo o modo leitura…', () => this.emToReadingNow()); }
  private async emToReadingNow() {
    if (!await this.emSafe()) return;
    this.emNarr.stop();
    const k = this.editing, rows = this.reviewRows().filter(s => s.id === k || this.text(s.id).trim());
    const docs = rows.map(s => ({key: s.id, title: s.name, subtitle: 'Seção ' + this.secNum(s.id), num: this.secNum(s.id), text: s.id === k ? this.editText : this.text(s.id),
      html: (s.id === k ? this.editHtml : this.richOf(s.id)) || undefined, status: {label: this.secLabel(s.id), css: this.secKind(s.id)}}));
    this.reading.open(docs, Math.max(0, rows.findIndex(s => s.id === k)), this.evaluationId, this.editFromReading(), this.canWrite() ? (key: string) => this.openDocOnly(key) : null);
  }
  /** "Editar" in the reading mode: back to (or into) the edit mode on the section being read. Not offered read-only. */
  private editFromReading(): ((k: string) => void) | null {
    if (this.readOnly()) return null;
    return k => { if (this.editFull && this.editing) this.emGo(k); else this.busy('Abrindo o modo edição…', () => { this.select(k); this.openEditMode(k); }); };
  }
  emZoomStep(d: number) { const z = this.EM_ZOOMS, i = z.indexOf(this.emZoom); this.emZoom = z[Math.max(0, Math.min(z.length - 1, (i < 0 ? 2 : i) + d))]; }
  emTogglePanel(p: 'find' | 'versions' | 'listen' | 'ai') {
    this.emPanel = this.emPanel === p ? '' : p;
    if (this.emPanel === 'find') setTimeout(() => (document.getElementById('em-find-q') as HTMLInputElement | null)?.focus());
    else this.rte?.clearFind();
    if (this.emNarrow()) this.emTools = true;
  }
  // tools
  async emCopy() {
    const t = this.editText;
    try { await navigator.clipboard.writeText(t); this.api.notify('Texto copiado.'); }
    catch { this.api.notify('Não foi possível copiar. Selecione o texto e use Ctrl+C.'); }
  }
  /** Pastes what is copied (e.g. the ChatGPT answer) at the cursor, or over the selected text. */
  async emPaste() {
    let t = '';
    try { t = await navigator.clipboard.readText(); } catch { this.api.notify('O navegador não liberou a área de transferência: clique no texto e use Ctrl+V.'); return; }
    if (!t.trim()) { this.api.notify('Não há texto copiado.'); return; }
    this.rte?.pasteText(t);
  }
  emDictate() { if (this.emDict) this.emDict.toggle(); else this.api.notify('Ditado por voz indisponível neste computador.'); }
  emFindRun() { this.emFound = this.rte?.find(this.emFind.q, this.emFind) ?? 0; this.emFoundAt = this.rte?.foundAt ?? -1; }
  emFindStep(d: number) { this.rte?.findStep(d); this.emFoundAt = this.rte?.foundAt ?? -1; }
  emReplace() { this.rte?.replaceOne(this.emFind.q, this.emFind.by, this.emFind); this.emFound = this.rte?.foundCount ?? 0; this.emFoundAt = this.rte?.foundAt ?? -1; }
  emReplaceAll() {
    const n = this.rte?.replaceAll(this.emFind.q, this.emFind.by, this.emFind) ?? 0;
    this.emFound = this.rte?.foundCount ?? 0; this.emFoundAt = this.rte?.foundAt ?? -1;
    this.api.notify(n ? `${n} ${n === 1 ? 'ocorrência substituída' : 'ocorrências substituídas'} nesta seção. Ctrl+Z desfaz.` : 'Nada encontrado nesta seção.');
  }
  async emVersionRestored() {
    this.emPanel = '';
    await this.load(); this.changed.emit();
    const k = this.editing; this.startEdit(k); this.emStart = {key: k, content: this.editText, html: this.editInitHtml};
  }
  emListen() {
    const st = this.emNarr.state();
    if (st === 'playing' || st === 'loading') { this.emNarr.pause(); return; }
    if (st === 'paused') { this.emNarr.resume(); return; }
    const el = this.rte?.element; if (!el) return;
    this.reader.stop(); this.emNarr.load(segmentsOf(el)); this.emNarr.start(0);
  }
  // ---------- "Gerar com IA" (instruction + generation) and ChatGPT, in dialogs, from the section or the edit mode ----------
  aiFor = ''; cgFor = '';
  openAi(k: string) { if (this.isHand(k) || this.readOnly()) return; this.aiFor = k; setTimeout(() => { const el = document.getElementById('ai-instr') as HTMLTextAreaElement | null; if (!el) return; el.focus(); el.setSelectionRange(0, 0); el.scrollTop = 0; }); }
  /** Saves what is being edited, generates with the instruction shown, and puts the new draft in the editor when it is open. */
  async runAi() {
    const k = this.aiFor; if (!k) return;
    if (this.editing === k && !await this.emSafe()) return;
    if (k === MANUAL_KEY) await this.generateConclusion();
    else if (k === DEMAND_KEY) await this.generateDemand();
    else await this.regenerate(k, true);
    if (this.gen[k] === 'done') { this.aiFor = ''; this.refreshEditor(k); }
  }
  async openCg(k: string) {
    if (this.isHand(k)) return;
    if (this.editing === k && !await this.emSafe()) return;
    if (await this.allowSectionAi()) { this.gptOpen = ''; this.cgFor = k; }
  }
  cgToAi() { const k = this.cgFor; this.cgFor = ''; this.openAi(k); }
  async onCgSaved() { const k = this.cgFor; await this.load(); this.changed.emit(); this.refreshEditor(k); }
  /** A new draft arrived for the section open in the edit mode: the editor shows it (the previous text is in Versões). */
  private refreshEditor(k: string) {
    if (!this.editFull || this.editing !== k) return;
    this.startEdit(k); this.emStart = {key: k, content: this.editText, html: this.editInitHtml};
  }
  @HostListener('window:beforeunload', ['$event']) emBeforeUnload(e: BeforeUnloadEvent) {
    if (this.editing && (this.isDirty() || this.saveState === 'saving' || this.saveState === 'error')) { e.preventDefault(); e.returnValue = ''; }
  }
  /** One keydown listener for the whole component: Angular keeps only one host listener per event, so the edit mode
   *  keys and the document view's Ctrl+F share it (the edit mode first). */
  @HostListener('document:keydown', ['$event']) onKeydown(e: KeyboardEvent) { this.emKey(e); if (!e.defaultPrevented) this.onDocKey(e); }
  emKey(e: KeyboardEvent) {
    if (this.docOnly && e.key === 'Escape' && !this.confirm.current()) { e.preventDefault(); e.stopPropagation(); if (this.docWidthOpen) { this.docWidthOpen = false; this.docWidthPreview = ''; if (this.docWidth) this.fitDocWidth(); return; } this.closeDocOnly(); return; }
    if (this.docOnly) return;
    if (!this.editFull || this.reading.doc()) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (e.key === 'Escape') {
      if (this.confirm.current()) return;   // an open dialog closes first
      e.preventDefault(); e.stopPropagation();
      if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
      if (this.aiFor || this.cgFor) { if (!this.generating) { this.aiFor = ''; this.cgFor = ''; } return; }
      if (this.emWidthOpen) { this.emWidthOpen = false; this.emWidthPreview = ''; return; }
      if (this.emPanel) { this.emPanel = ''; this.rte?.clearFind(); return; }
      if (this.emNarrow() && (this.emSide || this.emTools)) { this.emSide = false; this.emTools = false; return; }
      this.emClose(); return;
    }
    if (mod && k === 's') { e.preventDefault(); this.emSaveNow(); return; }
    if (mod && (k === 'f' || k === 'h')) { e.preventDefault(); if (this.emPanel !== 'find') this.emTogglePanel('find'); else (document.getElementById('em-find-q') as HTMLInputElement | null)?.focus(); }
  }

  openInstr(k: string) { this.sectionInstr = this.sectionInstr === k ? '' : k; this.editing = ''; }
  async regenerate(k: string, withInstruction = false, skipConfirm = false) {
    if (withInstruction) await this.dictation.stop();
    if (!this.aiReady) { this.api.notify('Geração pela API desligada. Ative em Configurações.'); return; }
    if (!await this.allowSectionAi()) return;
    if (!skipConfirm && this.state(k) !== 'pend') {
      const name = this.available().find(x => x.id === k)?.name || 'esta seção';
      const instr = (this.instrDraft[k] || '').trim();
      const ok = await this.confirm.ask({tone: 'review',
        title: withInstruction ? 'Gerar de novo com a sua instrução?' : 'Gerar esta seção de novo?',
        body: `O texto atual de "${name}" será substituído por uma nova versão gerada pela IA. Edições feitas nesta seção serão perdidas e ela volta para revisão.`,
        quote: withInstruction && instr ? {label: 'Instrução', text: instr.length > 400 ? instr.slice(0, 400) + '…' : instr} : undefined,
        facts: ['Usa só os dados desta seção no arquivo base', 'A versão anterior fica no histórico', 'O custo entra em Custo da IA desta avaliação'],
        ok: 'Gerar com IA'});
      if (!ok) return;
    }
    if (withInstruction && !await this.saveInstruction(k)) return;
    this.gen = {[k]: 'running'}; this.generating = true; this.generatingChange.emit(true);
    try { await this.api.req('POST', `/evaluations/${this.evaluationId}/generate/${k}`, this.aiBody({notes: ''})); this.gen[k] = 'done'; await this.load(); this.sectionInstr = ''; this.api.notify('Rascunho gerado. Revise o texto.'); }
    catch { this.gen[k] = 'error'; }
    finally { this.generating = false; this.generatingChange.emit(false); this.changed.emit(); }
  }
  async generateConclusion() {
    await this.dictation.stop();
    const text = (this.instrDraft[MANUAL_KEY] || '').trim();
    if (text.length < 10) { this.api.notify('Escreva suas orientações para a conclusão (o que você concluiu e quer destacar).'); return; }
    if (this.state(MANUAL_KEY) !== 'pend' && !await this.confirm.ask({tone: 'review', title: 'Gerar a conclusão de novo?',
      body: 'A conclusão atual será substituída por uma nova versão escrita a partir das suas orientações e dos textos das seções de resultados.',
      quote: {label: 'Suas orientações', text: text.length > 400 ? text.slice(0, 400) + '…' : text},
      facts: ['O texto atual vai para o histórico', 'A conclusão volta para revisão'], ok: 'Gerar de novo'})) return;
    await this.regenerate(MANUAL_KEY, true, true);
  }
  /** Things a final read usually misses: placeholders left by the pseudonymisation, empty text, a text far over the
   *  suggested length, and the warnings the generation left (categories, numbers, gender). It never changes the text. */
  finalCheck(keys: string[]): string[] {
    const out: string[] = [];
    for (const k of keys) {
      const name = SECTIONS.find(s => s.id === k)?.name || k, t = this.text(k), limit = Number(this.instruction(k)?.limit) || 0;
      if (!t.trim()) { out.push(`${name}: sem texto.`); continue; }
      const marks = [...new Set(t.match(/\[[A-ZÇÃÉ_]+(?:_\d+)?\]/g) || [])];
      if (marks.length) out.push(`${name}: marcador não trocado (${marks.join(', ')}).`);
      if (limit && words(t) > limit * 1.5) out.push(`${name}: ${words(t)} palavras, bem acima das ${limit} sugeridas.`);
      if (!this.done(k)) for (const w of this.warnings(k)) out.push(`${name}: ${w}`);
    }
    return out;
  }
  async approveAndNext(k: string) {
    const issues = this.finalCheck([k]);
    if (issues.length && !await this.confirm.ask({tone: 'review', title: 'Conferir antes de aprovar', facts: issues, ok: 'Aprovar mesmo assim', cancel: 'Voltar e revisar'})) return;
    try {
      await this.api.req('PUT', `/evaluations/${this.evaluationId}/sections/${k}`, {content: this.text(k), approve: true});
      await this.load(); this.changed.emit();
      const list = this.available(), i = list.findIndex(s => s.id === k);
      const next = [...list.slice(i + 1), ...list.slice(0, i)].find(s => !this.done(s.id) && !this.isExcluded(s.id));
      if (this.refOpen) { if (next && this.refCount(next.id)) this.refOpen = next.id; else this.closeRefs(); }
      this.open = next?.id || ''; this.editing = ''; this.sectionInstr = '';
      if (!next && this.allApproved()) this.api.notify('Todas as seções aprovadas. Já dá para baixar o Word.');
    } catch {}
  }
  // ---------- "Aprovar todas": a modal with one check per section, its issues and a final confirmation ----------
  approveOpen = false; apmSel: Record<string, boolean> = {}; apmReviewed = false; apmBusy = false;
  approveRows() { return this.available(); }
  openApproveAll() {
    this.apmSel = {}; this.apmReviewed = false;
    for (const s of this.approveRows()) this.apmSel[s.id] = this.state(s.id) !== 'pend';
    this.approveOpen = true;
  }
  apmCanPick(k: string) { return this.state(k) !== 'pend' && !this.done(k); }
  apmIssues(k: string) { const name = SECTIONS.find(s => s.id === k)?.name || k; return this.done(k) || this.state(k) === 'pend' ? [] : this.finalCheck([k]).map(t => t.startsWith(name + ': ') ? t.slice(name.length + 2) : t); }
  apmAll(on: boolean) { for (const s of this.approveRows()) if (this.apmCanPick(s.id)) this.apmSel[s.id] = on; }
  apmPicked() { return this.approveRows().filter(s => this.apmCanPick(s.id) && this.apmSel[s.id]); }
  /** Approving every remaining section also approves the evaluation (locked, Word ready); a part approves only those. */
  apmLocks() { const picked = new Set(this.apmPicked().map(s => s.id)); return this.approveRows().every(s => this.done(s.id) || picked.has(s.id)); }
  async confirmApproveAll() {
    const picked = this.apmPicked(); if (!picked.length || !this.apmReviewed || this.apmBusy) return;
    this.apmBusy = true;
    try {
      if (this.apmLocks()) {
        await this.api.req('POST', `/evaluations/${this.evaluationId}/approve`, {approveSections: true});
        this.api.notify('Todas as seções aprovadas. Já dá para baixar o Word.');
      } else {
        for (const s of picked) await this.api.req('PUT', `/evaluations/${this.evaluationId}/sections/${s.id}`, {content: this.text(s.id), approve: true});
        this.api.notify(picked.length === 1 ? '1 seção aprovada.' : `${picked.length} seções aprovadas.`);
      }
      this.approveOpen = false; await this.load(); this.changed.emit();
      if (this.inDocView()) this.renderPreview(true);
    } catch {} finally { this.apmBusy = false; }
  }
  async approveAll() {
    const pending = this.available().filter(s => this.state(s.id) === 'pend');
    if (pending.length) { this.api.notify('Gere ou escreva todas as seções antes de aprovar: ' + pending.map(s => s.name).join(', ')); return; }
    const issues = this.finalCheck(this.available().map(s => s.id));
    if (!await this.confirm.ask(issues.length
      ? {tone: 'review', title: 'Conferência final: revise antes de aprovar', body: 'Encontramos pontos que costumam passar despercebidos. Depois de aprovado, os textos ficam travados.', facts: issues, ok: 'Aprovar mesmo assim', cancel: 'Voltar e revisar'}
      : {title: 'Aprovar todas as seções?', body: 'A conferência automática não achou problemas. Confirme que você revisou o laudo inteiro: depois de aprovado, os textos ficam travados e o Word pode ser baixado.', ok: 'Aprovar todas'})) return;
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
  // Document preview zoom (50–150%, kept per browser), page count and the page at the top of the view.
  zoom = EvaluationComponent.savedDocZoom(); pageCount = 0; pageAt = 1;
  private static savedDocZoom() { try { const z = Number(localStorage.getItem('nl-doc-zoom')); if (z >= 0.5 && z <= 2.5) return z; } catch {} return 0.8; }
  /** Width of the Word page on screen (same choices as the edit mode); '' = the zoom chosen with − / + or Ctrl + wheel. */
  docWidth = (() => { try { return localStorage.getItem('nl-doc-width') || ''; } catch { return ''; } })();
  docWidthOpen = false; docWidthPreview = '';
  docWidthName() { return this.EM_WIDTHS.find(w => w.id === this.docWidth)?.name || 'Largura'; }
  pickDocWidth(id: string) {
    this.docWidth = id; this.docWidthPreview = ''; this.docWidthOpen = false;
    try { localStorage.setItem('nl-doc-width', id); } catch {}
    this.fitDocWidth();
  }
  /** Zoom that makes the page as wide as the chosen width (never wider than the area). */
  fitDocWidth(id = this.docWidthPreview || this.docWidth) {
    const w = this.EM_WIDTHS.find(x => x.id === id); if (!w) return;
    const page = this.previewBox?.nativeElement.querySelector('section.docx') as HTMLElement | null, sc = this.docScroll?.nativeElement;
    if (!page || !sc) return;
    const natural = (page.getBoundingClientRect().width / (this.zoom || 1)) || 794, room = sc.clientWidth - 48;
    const target = Math.min(w.px || room, room);
    this.zoom = Math.min(2.5, Math.max(0.5, Math.round(target / natural * 100) / 100));
    setTimeout(() => this.onDocScroll());
  }
  @HostListener('window:resize') onDocResize() { if (this.docWidth && this.mode === 'documento') this.fitDocWidth(); }
  setZoom(d: number) {
    if (this.docWidth) { this.docWidth = ''; try { localStorage.removeItem('nl-doc-width'); } catch {} }
    this.zoom = Math.min(2.5, Math.max(0.5, Math.round((this.zoom + d) * 10) / 10));
    try { localStorage.setItem('nl-doc-zoom', String(this.zoom)); } catch {}
    setTimeout(() => this.onDocScroll());
  }
  /** Approving this one leaves nothing else to review. */
  isLastPending(k: string) { return !this.available().some(s => s.id !== k && !this.done(s.id) && !this.isExcluded(s.id)); }
  showDocument() { if (!this.canWrite()) return; this.closeRefs(); this.step = 3; this.mode = 'documento'; setTimeout(() => this.renderPreview()); }
  /** quiet: refresh while editing (no "Montando…", same place, the edited section stays highlighted). */
  async renderPreview(quiet = false) {
    const box = this.previewBox?.nativeElement; if (!box) return;
    if (!this.docName('base')) { box.innerHTML = ''; return; }
    if (this.previewBusy) { this.previewAgain = true; return; }
    this.previewBusy = true; if (!quiet) this.previewLoading = true;
    const keep = this.docScroll?.nativeElement.scrollTop || 0;
    try {
      const data = await this.api.blob(`/evaluations/${this.evaluationId}/preview`);
      // rendered aside and swapped in at once, so the page does not blink or jump
      const next = document.createElement('div');
      const {renderAsync} = await import('docx-preview');
      await renderAsync(data, next, undefined, {className: 'docx', inWrapper: true, ignoreLastRenderedPageBreak: true});
      box.replaceChildren(...Array.from(next.childNodes)); this.docIndex = null;
      this.pageCount = box.querySelectorAll('section.docx').length;
      if (this.docWidth) this.fitDocWidth();
      if (quiet && this.docActive) this.jumpToSection(this.docActive, false);
      // Back at the same place, unless a section asked to be shown; a search still typed runs again on the new text.
      if (this.docScroll) this.docScroll.nativeElement.scrollTop = keep;
      if (this.findQuery.trim()) this.runFind(false);
      if (this.docJump) { const k = this.docJump; this.docJump = ''; setTimeout(() => this.jumpToSection(k)); }
      setTimeout(() => this.onDocScroll());
    }
    catch {} finally {
      this.previewLoading = false; this.previewBusy = false;
      if (this.previewAgain) { this.previewAgain = false; this.renderPreview(true); }
    }
  }
  private previewBusy = false; private previewAgain = false;

  // ---------- Document view: find, go to a section ----------
  // Search ignores accents, case and extra spaces, and finds words split across pieces of formatting.
  // Highlights use the CSS Custom Highlight API, so the rendered Word is never changed.
  @ViewChild('docScroll') docScroll?: ElementRef<HTMLDivElement>;
  @ViewChild('findBox') findBox?: ElementRef<HTMLInputElement>;
  findQuery = ''; findHits: Range[] = []; findAt = -1;
  /** Section opened through "Ver no documento" (for the way back), and one waiting for the preview to finish. */
  docFrom = ''; private docJump = '';
  private docIndex: {text: string; map: ({node: Text; off: number} | null)[]} | null = null;

  private static fold(c: string) {
    if (/\s/.test(c)) return ' ';
    if (/[\u2018\u2019\u201A\u2032`´]/.test(c)) return "'";
    if (/[\u201C\u201D\u201E\u2033]/.test(c)) return '"';
    if (/[\u2010-\u2015\u2212]/.test(c)) return '-';
    return c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()[0] ?? c;
  }
  private static foldText(s: string) {
    let t = '';
    for (let i = 0; i < s.length; i++) { const f = EvaluationComponent.fold(s[i]); if (f === ' ' && (!t || t.endsWith(' '))) continue; t += f; }
    return t.trim();
  }
  /** The whole document text, folded, with where each character came from; paragraphs and cells stay apart. */
  private buildIndex() {
    const box = this.previewBox?.nativeElement; if (!box) return null;
    let text = ''; const map: ({node: Text; off: number} | null)[] = []; let block: Element | null = null;
    const walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
      const parent = n.parentElement; if (!parent || parent.closest('style, script')) continue;
      const b = parent.closest('p, td, th, li, h1, h2, h3, h4, h5, h6');
      if (b !== block) { if (text && !text.endsWith('\n')) { text += '\n'; map.push(null); } block = b; }
      for (let i = 0; i < n.data.length; i++) {
        const f = EvaluationComponent.fold(n.data[i]);
        if (f === ' ' && (!text || text.endsWith(' ') || text.endsWith('\n'))) continue;
        text += f; map.push({node: n, off: i});
      }
    }
    return {text, map};
  }
  private rangesOf(q: string, limit = 1000): Range[] {
    const idx = this.docIndex ??= this.buildIndex(), fq = EvaluationComponent.foldText(q);
    if (!idx || !fq) return [];
    const out: Range[] = [];
    for (let i = idx.text.indexOf(fq); i >= 0 && out.length < limit; i = idx.text.indexOf(fq, i + fq.length)) {
      const a = idx.map[i], z = idx.map[i + fq.length - 1];
      if (!a || !z) continue;
      const r = document.createRange(); r.setStart(a.node, a.off); r.setEnd(z.node, z.off + 1); out.push(r);
    }
    return out;
  }
  private paint(name: string, ranges: Range[]) {
    const reg = (globalThis as any).CSS?.highlights, H = (globalThis as any).Highlight;
    if (!reg || !H) return;
    if (ranges.length) reg.set(name, new H(...ranges)); else reg.delete(name);
  }
  private show(r: Range) {
    // Scrolls only the document area (both rectangles are on screen, so the zoom does not matter).
    const sc = this.docScroll?.nativeElement, at = r.getBoundingClientRect();
    if (sc) { const box = sc.getBoundingClientRect(); sc.scrollTop += at.top - box.top - box.height / 3; if (at.left < box.left || at.right > box.right) sc.scrollLeft += at.left - box.left - 24; }
    // Browsers without highlights: the match is selected instead.
    if (!(globalThis as any).CSS?.highlights) { const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(r); }
  }
  /** Runs the search; with scroll=false (document rendered again) it keeps the current match without moving. */
  runFind(scroll = true) {
    this.findHits = this.rangesOf(this.findQuery);
    this.findAt = !this.findHits.length ? -1 : scroll ? 0 : Math.min(Math.max(this.findAt, 0), this.findHits.length - 1);
    this.paint('nl-find', this.findHits); this.paint('nl-find-on', this.findAt >= 0 ? [this.findHits[this.findAt]] : []);
    if (scroll && this.findAt >= 0) this.show(this.findHits[this.findAt]);
  }
  findStep(dir: 1 | -1) {
    if (!this.findHits.length) { this.runFind(); return; }
    this.findAt = (this.findAt + dir + this.findHits.length) % this.findHits.length;
    this.paint('nl-find-on', [this.findHits[this.findAt]]); this.show(this.findHits[this.findAt]);
  }
  clearFind() { this.findQuery = ''; this.findHits = []; this.findAt = -1; this.paint('nl-find', []); this.paint('nl-find-on', []); }
  onFindKey(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); this.findStep(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); this.clearFind(); }
  }
  /** Ctrl+F in the document view goes to this search (it ignores accents); a second Ctrl+F opens the browser's. */
  onDocKey(e: KeyboardEvent) {
    if (this.step !== 3 || this.mode !== 'documento' || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'f') return;
    const el = this.findBox?.nativeElement; if (!el || document.activeElement === el) return;
    e.preventDefault(); el.focus(); el.select();
  }
  /** Page shown in the upper third of the scroll area. */
  onDocScroll() {
    const sc = this.docScroll?.nativeElement, pages = this.previewBox?.nativeElement.querySelectorAll('section.docx');
    if (!sc || !pages?.length) return;
    const mark = sc.getBoundingClientRect().top + sc.getBoundingClientRect().height / 3; let at = 1;
    pages.forEach((p, i) => { if (p.getBoundingClientRect().top <= mark) at = i + 1; });
    this.pageAt = at;
  }
  sectionName(k: string) { return this.reviewRows().find(s => s.id === k)?.name || ''; }
  docSections() { return this.reviewRows().filter(s => !this.isMissing(s.id)).map(s => ({label: s.name, value: s.id})); }
  /** First words of the section text as they go into the Word; the section name as a fallback. */
  private anchorsOf(k: string): string[] {
    const out: string[] = [], ps = this.paragraphs(this.text(k));
    const cut = (t: string, n = 70) => t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') : t;
    const body = ps.filter(x => !x.title && x.text.trim().split(/\s+/).length >= 4).slice(0, 3);
    for (const p of body.length ? body : ps.slice(0, 1)) out.push(cut(p.text.trim()));
    for (const p of body) out.push(cut(p.text.trim(), 32));
    // No text yet: what the base document already has in this section (paragraphs and table cells, in order).
    for (const b of this.fileBlock(k)) {
      const ts: string[] = b.type === 'p' ? [b.text] : b.type === 'table' ? (b.grid || []).flat().map((c: any) => c?.text) : [];
      for (const t of ts) if (t?.trim() && t.trim().length >= 4 && out.length < 16) out.push(cut(t.trim()));
    }
    const name = this.sectionName(k); if (name) out.push(name);
    return out;
  }
  /** Goes to the first piece of the section found only once in the document (a table header like "Teste" repeats in every section). */
  jumpToSection(k: string, scroll = true) {
    let first: Range | null = null;
    for (const a of this.anchorsOf(k)) {
      const hits = this.rangesOf(a, 2);
      if (hits.length === 1) { first = hits[0]; break; }
      first ??= hits[0] || null;
    }
    if (first) { this.paint('nl-target', [first]); if (scroll) this.show(first); return; }
    this.paint('nl-target', []);
    if (scroll) this.api.notify('Não achei o texto desta seção no documento. Confira se ela já tem texto.');
  }
  /** From a section: opens the document already at that section's text. */
  viewInDocument(k: string) {
    if (!this.canWrite()) return;
    if (this.isMissing(k)) { this.api.notify('Esta seção não entra no Word: o arquivo base não tem o lugar dela.'); return; }
    this.docFrom = k; this.docJump = k; this.docActive = k; this.setMode('documento');
  }
  /** "Ver documento" from the reading or edit mode: the Word preview alone, over everything (no section column).
   *  Closing it goes back to the mode it was opened from; the text being edited is saved first. */
  docOnly = false; private docOnlyMode: 'secoes' | 'documento' = 'secoes';
  openDocOnly(k: string) {
    if (!this.canWrite()) return;
    return this.busy('Salvando e montando o documento…', async () => {
      if (this.editing && !await this.emSafe()) return;
      this.emNarr.pause();
      this.docOnlyMode = this.mode; this.docOnly = true; this.reading.covered.set(true);
      this.docFrom = ''; this.docJump = this.isMissing(k) || this.isExcluded(k) ? '' : k; this.docActive = this.docJump;
      this.mode = 'documento';
      await new Promise(r => setTimeout(r)); await this.renderPreview();
    });
  }
  closeDocOnly() {
    this.docOnly = false; this.reading.covered.set(false);
    this.paint('nl-target', []); this.docActive = ''; this.mode = this.docOnlyMode;
  }
  backToSection() { const k = this.docFrom; this.docFrom = ''; this.paint('nl-target', []); this.setMode('secoes'); if (k) this.select(k); }
  // ---------- ChatGPT (manual mode) ----------
  // The request carries this section's own tables/text and the instruction, with names replaced by markers (API side).
  gptOpen = ''; gptText = ''; gptHidden = 0; gptLoading = ''; gptCopied = false;
  /** Section whose generation panel is open (API, ChatGPT plugin or copy and paste). */
  cgOpen = '';
  /** Section whose "other ways to generate" menu is open; any click elsewhere or Esc closes it. */
  actMenu = '';
  @HostListener('document:click') closeActMenu() { this.actMenu = ''; this.secMenu = false; }
  @HostListener('document:keydown.escape') escActMenu() { this.actMenu = ''; this.secMenu = false; if (!this.editFull && !this.generating && !this.confirm.current()) { this.aiFor = ''; this.cgFor = ''; } }
  sectionImages(k: string): string[] { return this.fileBlock(k).filter(b => b.type === 'img').map(b => b.src); }
  /** "OpenAI API" in the panel: the same generation as the section's own buttons. */
  useApiFor(k: string) { if (k === MANUAL_KEY) this.generateConclusion(); else if (k === DEMAND_KEY) this.generateDemand(); else this.regenerate(k); }
  /** Builds the request, copies it, opens ChatGPT and shows the panel to copy again or paste the answer back. */
  async openGpt(k: string) {
    if (this.gptLoading) return;
    if (!await this.allowSectionAi()) return;
    this.gptLoading = k;
    try {
      // An instruction typed but not saved yet must go in the request.
      if (k !== MANUAL_KEY && !await this.saveInstruction(k)) return;
      const r = await this.api.req('POST', `/evaluations/${this.evaluationId}/prompt/${k}`, this.aiBody(k === MANUAL_KEY ? {notes: (this.instrDraft[k] || '').trim()} : {}));
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
    try { const t = (await navigator.clipboard.readText()).trim(); if (t && t !== this.gptText.trim()) { this.setEditText(t); this.api.notify('Resposta colada. Revise e salve a edição.'); return; } } catch {}
    setTimeout(() => (document.querySelector('textarea.draft.editing') as HTMLTextAreaElement | null)?.select(), 30);
    this.api.notify('Cole a resposta do ChatGPT com Ctrl+V (substitui o texto) e salve a edição.');
  }

  /** Copies the section text ready to paste in Word: topic titles without "##", paragraphs separated by a blank line. */
  copied = ''; private copiedTimer: any;
  /** Reading mode (display only): the section text, the base file's text, the previous evaluation, the conclusion sources. */
  /** All sections with text, in order, so ← → in the reading mode goes through the report. */
  readSection(k: string) {
    const rows = this.reviewRows().filter(s => s.id === k || this.text(s.id).trim());
    // status only as the system keeps it (approved, to review, pending); reading never changes it
    const docs = rows.map(s => ({key: s.id, title: s.name, subtitle: 'Seção ' + this.secNum(s.id), num: this.secNum(s.id), text: this.text(s.id), html: this.richOf(s.id) || undefined,
      status: {label: this.secLabel(s.id), css: this.secKind(s.id)}}));
    this.reading.open(docs, Math.max(0, rows.findIndex(s => s.id === k)), this.evaluationId, this.editFromReading(), this.canWrite() ? (key: string) => this.openDocOnly(key) : null);
  }
  hasFileText(k: string) { return this.fileShown(k).some(b => b.type === 'p'); }
  readFileText(k: string, name: string) { this.reading.open({title: name, subtitle: 'Texto presente no arquivo base', text: this.fileShown(k).filter(b => b.type === 'p').map(b => b.text).join('\n\n')}); }
  readPrevious(k: string, name: string) { this.reading.open({title: name, subtitle: 'Avaliação anterior · ' + this.brDate(this.previous?.start_date || this.previous?.created_at), text: this.previous?.sections?.[k] || ''}); }
  readSources() { this.reading.open({title: 'Textos das seções usados na conclusão', text: this.conclusionSources().map(t => '## ' + t.name + '\n\n' + t.text).join('\n\n')}); }
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
  async pasteAnswer() { try { this.setEditText((await navigator.clipboard.readText()).trim()); } catch { this.api.notify('Use Ctrl+V dentro do campo.'); } }

  async remove() {
    if (this.generating || !this.canWrite()) return;
    if (!await this.confirm.ask({tone: 'danger', title: 'Excluir esta avaliação?', body: `A avaliação de ${this.current?.patient_name || 'este paciente'} será apagada definitivamente.`, facts: ['Os documentos enviados serão apagados', 'Os textos e o histórico serão apagados', 'Não é possível desfazer'], ok: 'Excluir avaliação'})) return;
    try { await this.api.req('DELETE', '/evaluations/' + this.evaluationId); this.api.notify('Avaliação excluída.'); this.deleted.emit(); } catch {}
  }
  /** Steps shown: a manual evaluation has no AI step, so "Conferir e baixar" becomes the third one. */
  /** Identificação and files share the first step; a manual evaluation has no AI step. */
  stepIdx() { return this.aiOn() ? [0, 2, 3] : [0, 3]; }
  goStep(i: number) { if (i === 1) i = 0; if (i === 2 && !this.aiOn()) i = 3; if (i !== 3) this.closeRefs(); this.step = i; if (i === 3 && this.mode === 'documento') setTimeout(() => this.renderPreview()); }
  setMode(m: 'secoes' | 'documento') { if (m === 'documento' && !this.canWrite()) return; if (m !== 'documento' && this.docEditing) this.finishDocEdit(); if (m !== 'secoes') this.closeRefs(); this.mode = m; if (m === 'documento') setTimeout(() => this.renderPreview()); }
}
