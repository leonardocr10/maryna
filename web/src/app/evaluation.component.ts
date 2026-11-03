import {Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {renderAsync} from 'docx-preview';
import {Api} from './api.service';
import {WorkTimer} from './work-timer.service';
import {DropZoneComponent} from './ui/drop-zone.component';
import {Identity, IdentityFormComponent, emptyIdentity} from './ui/identity-form.component';
import {SECTIONS, SECTION_STATE, STATUS, SectionState, ageText, brDate, brl, int, words} from './shared';

/** Section the AI only writes from the psychologist's own guidance (never in "Gerar laudo"). */
const MANUAL_KEY = 'conclusao';

type Gen = 'pending' | 'running' | 'done' | 'error' | 'skipped';

@Component({
  selector: 'nl-evaluation',
  standalone: true,
  imports: [CommonModule, FormsModule, DropZoneComponent, IdentityFormComponent],
  templateUrl: './evaluation.component.html',
  styleUrl: './evaluation.component.css',
})
export class EvaluationComponent implements OnDestroy {
  private api = inject(Api);
  private timer = inject(WorkTimer);
  @ViewChild('previewBox') previewBox?: ElementRef<HTMLDivElement>;
  @Output() changed = new EventEmitter<void>();
  @Output() deleted = new EventEmitter<void>();
  @Output() generatingChange = new EventEmitter<boolean>();
  @Input() autoGenerate = false;
  @Input() set id(v: string) { if (v && v !== this.evaluationId) { this.evaluationId = v; this.load(true); } }

  MANUAL_KEY = MANUAL_KEY; SECTIONS = SECTIONS; SECTION_STATE = SECTION_STATE; STATUS = STATUS; brDate = brDate; brl = brl; int = int; words = words;
  steps = ['Identificação', 'Arquivos', 'Gerar com IA', 'Conferir e baixar'];

  evaluationId = '';
  loaded = false;
  current: any = null; documents: any[] = []; sections: any[] = []; usage: any = null; inspection: any = null;
  instructions: any[] = []; instrDraft: Record<string, string> = {}; instrOpen = '';
  privacy: any = null; newTerm = '';
  idModel: Identity = emptyIdentity(); private idTimer: any; idSaving = false;
  step = 0;
  uploading = '';
  aiReady = false; usdBrl = 5.5;
  gen: Record<string, Gen> = {}; generating = false;
  open = ''; editing = ''; editText = ''; sectionInstr = '';
  mode: 'secoes' | 'documento' = 'secoes'; previewLoading = false;

  ngOnDestroy() { clearTimeout(this.idTimer); }

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
        this.inspection = null; this.privacy = null; this.gen = {}; this.open = ''; this.editing = ''; this.mode = 'secoes';
        const s = await this.api.req('GET', '/ai/settings').catch(() => null);
        this.aiReady = !!(s && s.enabled && s.configured && s.privacy_gate);
        this.step = !this.docsReady() ? 1 : !this.drafted() ? 2 : 3;
      }
      if (this.docsReady() && !this.inspection) await this.inspect();
      if (this.docsReady() && !this.instructions.length || first) await this.loadInstructions();
      this.loaded = true;
      if (first && this.autoGenerate && this.docsReady() && !this.drafted()) { this.step = 2; this.generateAll(true); }
    } catch {}
  }
  async inspect() {
    try { this.inspection = await this.api.req('POST', `/evaluations/${this.evaluationId}/inspect`); } catch { this.inspection = null; }
    try { this.privacy = await this.api.req('GET', `/evaluations/${this.evaluationId}/privacy`); } catch {}
  }
  async loadInstructions() {
    try {
      const r = await this.api.req('GET', `/evaluations/${this.evaluationId}/instructions`);
      this.instructions = r.sections;
      this.instrDraft = Object.fromEntries(r.sections.map((x: any) => [x.key, x.custom || (x.key === MANUAL_KEY ? '' : x.default)]));
    } catch {}
  }

  // ---------- derived ----------
  locked() { return this.current?.status === 'approved'; }
  docName(kind: string) { return this.documents.filter(d => d.kind === kind).at(-1)?.filename || ''; }
  docCount() { return (this.docName('base') ? 1 : 0) + (this.docName('anamnesis') ? 1 : 0); }
  docsReady() { return this.docCount() === 2; }
  available() { const found = new Set((this.inspection?.markers || []).map((m: any) => m.key)); return this.inspection ? SECTIONS.filter(s => found.has(s.id)) : SECTIONS; }
  missing() { const ids = new Set(this.available().map(s => s.id)); return SECTIONS.filter(s => !ids.has(s.id)).map(s => s.name); }
  section(k: string) { return this.sections.find(s => s.section_key === k); }
  text(k: string) { return this.section(k)?.content || ''; }
  state(k: string): SectionState { const s = this.section(k); return !s?.content?.trim() ? 'pend' : s.status === 'approved' ? 'ap' : 'gen'; }
  drafted() { return this.available().filter(s => this.state(s.id) !== 'pend').length; }
  approved() { return this.available().filter(s => this.state(s.id) === 'ap').length; }
  total() { return this.available().length; }
  allApproved() { return this.locked() || (this.total() > 0 && this.approved() === this.total()); }
  status() { return this.allApproved() ? STATUS.ap : this.drafted() ? STATUS.rv : STATUS.rs; }
  summary() {
    const c = this.current; if (!c) return '';
    return [ageText(c.birth_date, c.end_date), c.sex, c.schooling, c.start_date ? 'Início ' + brDate(c.start_date) : ''].filter(Boolean).join(' · ');
  }
  warnings(k: string): string[] { try { return JSON.parse(this.section(k)?.source_summary || '[]'); } catch { return []; } }
  stepDone(i: number) { return [this.idModel.name.trim().length >= 2, this.docsReady(), this.total() > 0 && this.drafted() === this.total(), this.allApproved()][i]; }
  stepSub(i: number) {
    if (i === 0) return this.idModel.name.trim() ? 'Dados preenchidos' : 'Pendente';
    if (i === 1) return `${this.docCount()} de 2 enviados`;
    if (i === 2) return this.generating ? `Gerando ${this.genDone()}/${this.genKeys().length}` : this.drafted() ? (this.drafted() === 1 ? '1 seção gerada' : `${this.drafted()} seções geradas`) : 'Pendente';
    return this.allApproved() ? 'Aprovada' : `${this.approved()}/${this.total()} aprovadas`;
  }
  paragraphs(t: string) { return (t || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p => ({title: /^#{1,6}\s/.test(p) && p.split('\n').length === 1, text: p.replace(/^#{1,6}\s*/, '').replace(/\*\*(.+?)\*\*/g, '$1')})); }

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
      this.api.notify(kind === 'base' ? 'Arquivo base enviado.' : 'Anamnese enviada.');
    } catch {} finally { this.uploading = ''; }
  }

  // ---------- step 3: generation ----------
  autoKeys() { return this.available().map(s => s.id).filter(k => k !== MANUAL_KEY); }
  hasConclusion() { return this.available().some(s => s.id === MANUAL_KEY); }
  genKeys() { return Object.keys(this.gen); }
  genDone() { return Object.values(this.gen).filter(g => g === 'done' || g === 'error' || g === 'skipped').length; }
  genPct() { const n = this.genKeys().length; return n ? Math.round(this.genDone() / n * 100) : 0; }
  dotClass(k: string) { const g = this.gen[k]; if (g === 'running') return 'warn pulse'; if (g === 'error') return 'err'; if (g === 'done') return 'ok'; return this.state(k) === 'ap' ? 'ok' : this.state(k) === 'gen' ? 'warn' : ''; }
  rowLabel(k: string) { if (k === MANUAL_KEY && !this.gen[k] && this.state(k) === 'pend') return 'Você gera na etapa 4'; const g = this.gen[k]; if (g === 'running') return 'Gerando…'; if (g === 'pending') return 'Na fila'; if (g === 'error') return 'Erro'; if (g === 'skipped') return 'Não gerada'; return SECTION_STATE[this.state(k)].label; }

  async generateAll(skipConfirm = false) {
    if (!this.aiReady) { this.api.notify('Geração pela API desligada. Ative em Configurações.'); return; }
    if (!skipConfirm && this.drafted() && !confirm('Gerar tudo de novo? Os textos atuais serão substituídos (as versões antigas ficam no histórico).')) return;
    const keys = this.autoKeys();
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
  isCustom(k: string) { return !!this.instruction(k)?.custom; }
  customCount() { return this.instructions.filter(x => x.custom).length; }
  async saveInstruction(k: string, text = this.instrDraft[k]) {
    const ins = this.instruction(k); if (!ins || this.locked()) return;
    const value = (text || '').trim();
    if ((ins.custom || ins.default) === value) return;
    try {
      const r = await this.api.req('PUT', `/evaluations/${this.evaluationId}/instructions/${k}`, {prompt: value && value !== ins.default ? value : null});
      ins.custom = r.custom; this.instrDraft[k] = r.custom || ins.default;
    } catch {}
  }
  async resetInstruction(k: string) { const ins = this.instruction(k); if (!ins) return; this.instrDraft[k] = ins.default; await this.saveInstruction(k, ins.default); }

  // privacy (pseudonymisation list)
  privacyList() { const seen = new Set<string>(); return (this.privacy?.terms || []).filter((t: any) => { const key = t.ignored ? 'off:' + t.value : t.placeholder; if (seen.has(key)) return false; seen.add(key); return true; }); }
  private async savePrivacy(extra: string[], ignored: string[]) { try { await this.api.req('PUT', `/evaluations/${this.evaluationId}/privacy`, {extra, ignored}); this.privacy = await this.api.req('GET', `/evaluations/${this.evaluationId}/privacy`); } catch {} }
  private ignoredTerms() { return (this.privacy?.terms || []).filter((t: any) => t.ignored).map((t: any) => t.value); }
  private extraTerms() { return (this.privacy?.extra || []).map((x: any) => x.value); }
  toggleTerm(t: any) { const same = (this.privacy.terms as any[]).filter(x => x.placeholder === t.placeholder || x.value === t.value).map(x => x.value); this.savePrivacy(this.extraTerms(), t.ignored ? this.ignoredTerms().filter((v: string) => !same.includes(v)) : [...this.ignoredTerms(), ...same]); }
  addTerm() { const v = this.newTerm.trim(); if (v.length < 2) return; this.newTerm = ''; this.savePrivacy([...this.extraTerms(), v], this.ignoredTerms()); }
  removeTerm(v: string) { this.savePrivacy(this.extraTerms().filter((x: string) => x !== v), this.ignoredTerms()); }

  // ---------- step 4: review ----------
  toggle(k: string) { this.open = this.open === k ? '' : k; this.editing = ''; this.sectionInstr = ''; }
  startEdit(k: string) { this.editing = k; this.editText = this.text(k); this.sectionInstr = ''; }
  async saveEdit(k: string) {
    if (!this.editText.trim()) { this.api.notify('O texto não pode ficar vazio.'); return; }
    try { await this.api.req('PUT', `/evaluations/${this.evaluationId}/sections/${k}`, {content: this.editText}); this.editing = ''; await this.load(); this.changed.emit(); this.api.notify('Texto salvo. A seção voltou para revisão.'); } catch {}
  }
  openInstr(k: string) { this.sectionInstr = this.sectionInstr === k ? '' : k; this.editing = ''; }
  async regenerate(k: string, withInstruction = false) {
    if (!this.aiReady) { this.api.notify('Geração pela API desligada. Ative em Configurações.'); return; }
    if (withInstruction) await this.saveInstruction(k);
    this.gen = {[k]: 'running'}; this.generating = true; this.generatingChange.emit(true);
    try { await this.api.req('POST', `/evaluations/${this.evaluationId}/generate/${k}`, {notes: ''}); this.gen[k] = 'done'; await this.load(); this.sectionInstr = ''; this.api.notify('Seção regenerada. Revise o texto.'); }
    catch { this.gen[k] = 'error'; }
    finally { this.generating = false; this.generatingChange.emit(false); this.changed.emit(); }
  }
  async generateConclusion() {
    const text = (this.instrDraft[MANUAL_KEY] || '').trim();
    if (text.length < 10) { this.api.notify('Escreva suas orientações para a conclusão (o que você concluiu e quer destacar).'); return; }
    if (this.state(MANUAL_KEY) !== 'pend' && !confirm('Gerar a conclusão de novo com estas orientações? O texto atual vai para o histórico.')) return;
    await this.regenerate(MANUAL_KEY, true);
  }
  async approveAndNext(k: string) {
    try {
      await this.api.req('PUT', `/evaluations/${this.evaluationId}/sections/${k}`, {content: this.text(k), approve: true});
      await this.load(); this.changed.emit();
      const list = this.available(), i = list.findIndex(s => s.id === k);
      const next = [...list.slice(i + 1), ...list.slice(0, i)].find(s => this.state(s.id) !== 'ap');
      this.open = next?.id || ''; this.editing = ''; this.sectionInstr = '';
      if (!next && this.allApproved()) this.api.notify('Todas as seções aprovadas. Já dá para baixar o Word.');
    } catch {}
  }
  async approveAll() {
    const pending = this.available().filter(s => this.state(s.id) === 'pend');
    if (pending.length) { this.api.notify('Gere ou escreva todas as seções antes de aprovar: ' + pending.map(s => s.name).join(', ')); return; }
    if (!confirm('Aprovar todas as seções? Confirme que você revisou o laudo. Depois de aprovado, os textos ficam travados.')) return;
    try { await this.api.req('POST', `/evaluations/${this.evaluationId}/approve`, {approveSections: true}); await this.load(); this.changed.emit(); this.api.notify('Todas as seções aprovadas. Já dá para baixar o Word.'); } catch {}
  }
  async download() {
    if (!this.allApproved()) { this.api.notify('Aprove todas as seções para baixar o Word.'); return; }
    try {
      if (!this.locked()) { await this.api.req('POST', `/evaluations/${this.evaluationId}/approve`, {approveSections: true}); await this.load(); this.changed.emit(); }
      const data = await this.api.blob(`/evaluations/${this.evaluationId}/export`);
      const url = URL.createObjectURL(data), a = document.createElement('a');
      a.href = url; a.download = 'laudo-' + (this.current?.patient_name || 'revisado').replace(/[^\p{L}\p{N}]+/gu, '-') + '.docx'; a.click(); URL.revokeObjectURL(url);
      this.api.notify('Word baixado.');
    } catch {}
  }
  showDocument() { this.step = 3; this.mode = 'documento'; setTimeout(() => this.renderPreview()); }
  async renderPreview() {
    const box = this.previewBox?.nativeElement; if (!box) return;
    if (!this.docName('base')) { box.innerHTML = ''; return; }
    this.previewLoading = true;
    try { const data = await this.api.blob(`/evaluations/${this.evaluationId}/preview`); box.innerHTML = ''; await renderAsync(data, box, undefined, {className: 'docx', inWrapper: true, ignoreLastRenderedPageBreak: true}); }
    catch {} finally { this.previewLoading = false; }
  }
  // manual mode (ChatGPT web)
  async copyPrompt(k: string) {
    try { const r = await this.api.req('POST', `/evaluations/${this.evaluationId}/prompt/${k}`, {}); await navigator.clipboard.writeText(r.text); window.open('https://chatgpt.com/', 'chatgpt'); this.api.notify(`Pedido copiado (${r.hidden} dados ocultados). Cole no ChatGPT.`); } catch {}
  }
  async pasteAnswer() { try { this.editText = (await navigator.clipboard.readText()).trim(); } catch { this.api.notify('Use Ctrl+V dentro do campo.'); } }

  async remove() {
    if (this.generating) return;
    if (!confirm(`Excluir a avaliação de ${this.current?.patient_name}?\n\nOs documentos enviados e os textos serão apagados definitivamente.`)) return;
    try { await this.api.req('DELETE', '/evaluations/' + this.evaluationId); this.api.notify('Avaliação excluída.'); this.deleted.emit(); } catch {}
  }
  goStep(i: number) { this.step = i; if (i === 3 && this.mode === 'documento') setTimeout(() => this.renderPreview()); }
  setMode(m: 'secoes' | 'documento') { this.mode = m; if (m === 'documento') setTimeout(() => this.renderPreview()); }
}
