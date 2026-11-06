import {SelectOption} from './ui/filter-select.component';

export const SECTIONS = [
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

export const SEX_OPTIONS: SelectOption[] = ['Feminino', 'Masculino', 'Não informar'];
export const SCHOOLING_OPTIONS: SelectOption[] = [
  ...['Maternal', 'Pré I', 'Pré II'].map(label => ({label, group: 'Educação infantil'})),
  ...['1º ano', '2º ano', '3º ano', '4º ano', '5º ano'].map(label => ({label, group: 'Fundamental I'})),
  ...['6º ano', '7º ano', '8º ano', '9º ano'].map(label => ({label, group: 'Fundamental II'})),
  ...['1ª série', '2ª série', '3ª série', 'Ensino médio completo'].map(label => ({label, group: 'Ensino médio'})),
  ...['Superior incompleto', 'Superior completo'].map(label => ({label, group: 'Ensino superior'})),
];
export const MODEL_OPTIONS: SelectOption[] = ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini'];

/** Option list that also keeps a value typed before (e.g. read from an old base document). */
export function withCurrent(options: SelectOption[], current: string): SelectOption[] {
  const has = options.some(o => (typeof o === 'string' ? o : o.value ?? o.label) === current);
  return current && !has ? [...options, {label: current, group: 'Do arquivo base'}] : options;
}

export const fold = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const brDate = (v: string) => { const s = String(v || '').slice(0, 10); return ISO.test(s) ? s.split('-').reverse().join('/') : ''; };

export function ageText(birth: string, at?: string) {
  if (!ISO.test(birth || '')) return '';
  const ref = ISO.test(at || '') ? at! : todayISO();
  const [by, bm, bd] = birth.split('-').map(Number), [ry, rm, rd] = ref.split('-').map(Number);
  const months = (ry - by) * 12 + rm - bm - (rd < bd ? 1 : 0);
  if (months < 0) return '';
  if (months < 12) return months === 1 ? '1 mês' : `${months} meses`;
  return `${Math.floor(months / 12)} anos`;
}

/** Whole years at the reference date (today when empty); null when the birth date is unknown. */
export function ageYears(birth: string, at?: string): number | null {
  if (!ISO.test(birth || '')) return null;
  const ref = ISO.test(at || '') ? at! : todayISO();
  const [by, bm, bd] = birth.split('-').map(Number), [ry, rm, rd] = ref.split('-').map(Number);
  const months = (ry - by) * 12 + rm - bm - (rd < bd ? 1 : 0);
  return months < 0 ? null : Math.floor(months / 12);
}
/** Percepção is only for people under this age. */
export const PERCEPTION_MAX_AGE = 17;

export type EvalStatus = 'rs' | 'rv' | 'ap';
export const STATUS: Record<EvalStatus, {label: string; css: string}> = {rs: {label: 'Rascunho', css: 'idle'}, rv: {label: 'Em revisão', css: 'warn'}, ap: {label: 'Aprovada', css: 'ok'}};
/** Derived status: all sections approved → Aprovada; some drafted → Em revisão; none → Rascunho. */
export function listStatus(e: any): EvalStatus {
  if (e.status === 'approved') return 'ap';
  if (e.drafted_count > 0 && e.approved_count >= e.drafted_count && e.drafted_count >= e.section_total) return 'ap';
  return e.generated_count > 0 ? 'rv' : 'rs';  // demand copied from the file alone is still a draft
}

export type SectionState = 'pend' | 'gen' | 'ap';
export const SECTION_STATE: Record<SectionState, {label: string; css: string}> = {pend: {label: 'Pendente', css: 'idle'}, gen: {label: 'Revisar', css: 'warn'}, ap: {label: 'Aprovada', css: 'ok'}};

export const words = (t: string) => (t || '').trim().split(/\s+/).filter(Boolean).length;
export const brl = (v: number) => (v || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: (v || 0) < 1 ? 3 : 2});
export const int = (v: number) => (v || 0).toLocaleString('pt-BR');
