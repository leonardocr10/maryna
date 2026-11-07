// Framework-free pieces of the voice dictation (unit-tested in web/test/dictation.test.mjs).
// Only erasable TypeScript syntax here, so Node runs this file directly in the tests.

interface Item { text: string; final: boolean }

/**
 * Puts the Realtime transcription events back in speaking order.
 * Deltas are provisional; a "completed" transcript replaces them for its item (so nothing is repeated), and confirmed
 * text is released only in commit order, because completions of different turns may arrive out of order.
 */
export class TranscriptAssembler {
  private order: string[] = [];
  private items = new Map<string, Item>();
  private done = new Set<string>();
  private unconfirmed: string[] = [];

  private ensure(id: string, after?: string | null): Item | null {
    if (!id || this.done.has(id)) return null;
    let it = this.items.get(id);
    if (!it) {
      it = {text: '', final: false};
      this.items.set(id, it);
      const at = after ? this.order.indexOf(after) : -1;
      if (at >= 0) this.order.splice(at + 1, 0, id); else this.order.push(id);
    }
    return it;
  }

  /** input_audio_buffer.committed */
  committed(id: string, previousId?: string | null) { this.ensure(id, previousId); }

  /** conversation.item.input_audio_transcription.delta */
  delta(id: string, delta: string) { const it = this.ensure(id); if (it && !it.final && delta) it.text += delta; }

  /** conversation.item.input_audio_transcription.completed: returns the confirmed texts ready to insert, in order. */
  completed(id: string, transcript: string): string[] {
    const it = this.ensure(id);
    if (it) { it.text = String(transcript || '').trim(); it.final = true; }
    return this.drain();
  }

  /** conversation.item.input_audio_transcription.failed: the partial text is kept apart, never inserted on its own. */
  failed(id: string): string[] {
    const it = this.ensure(id);
    if (it) { if (it.text.trim()) this.unconfirmed.push(it.text.trim()); it.text = ''; it.final = true; }
    return this.drain();
  }

  private drain(): string[] {
    const out: string[] = [];
    while (this.order.length) {
      const id = this.order[0], it = this.items.get(id)!;
      if (!it.final) break;
      this.order.shift(); this.items.delete(id); this.done.add(id);
      if (it.text) out.push(it.text);
    }
    return out;
  }

  /** Provisional text still waiting for confirmation (shown apart from the field). */
  preview(): string { return this.order.map(id => this.items.get(id)!.text.trim()).filter(Boolean).join(' '); }

  /** Turns that have audio committed or text streaming but no final transcript yet. */
  pending(): number { return this.order.length; }

  /** Whether some turn failed and left text that was never confirmed. */
  hasUnconfirmed(): boolean { return this.unconfirmed.length > 0; }

  /** Everything not confirmed (provisional + failed turns), emptied after reading. Used when a connection drops. */
  takeUnconfirmed(): string {
    const parts = [...this.unconfirmed];
    for (const id of this.order) { const it = this.items.get(id)!; if (!it.final && it.text.trim()) parts.push(it.text.trim()); this.done.add(id); }
    this.order = []; this.items.clear(); this.unconfirmed = [];
    return parts.join(' ');
  }
}

const CLOSES = /^[,.;:!?…)\]}»”]/;

/**
 * The piece to insert between `before` and `after` so dictated text reads naturally: one space where words meet,
 * first letter upper-case at the start of a sentence. Words themselves are never changed.
 */
export function fitInsertion(before: string, after: string, text: string): string {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (!before.trim() || /([.!?…]\s*|\n\s*)$/.test(before)) t = t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1);
  if (before && !/\s$/.test(before) && !CLOSES.test(t) && !/[(\[{«“]$/.test(before)) t = ' ' + t;
  if (after && !/^\s/.test(after) && !CLOSES.test(after)) t += ' ';
  return t;
}

/**
 * Client-side end-of-turn detection (gpt-live-transcribe has no server VAD): after speech, a pause of `silenceMs`
 * closes the turn; very long turns are closed at `maxTurnMs` so confirmed text keeps flowing.
 */
export class TurnDetector {
  private noise = 0.004;
  private turnStart = 0;
  private lastVoice = 0;
  private speech = false;
  private silenceMs: number;
  private maxTurnMs: number;
  private floor: number;
  constructor(silenceMs = 700, maxTurnMs = 20000, floor = 0.012) { this.silenceMs = silenceMs; this.maxTurnMs = maxTurnMs; this.floor = floor; }

  /** `level` is the RMS of the latest audio frame (0..1); returns true when the turn should be committed now. */
  feed(level: number, now: number): boolean {
    const voiced = level > Math.max(this.floor, this.noise * 3);
    if (voiced) { if (!this.speech) this.turnStart = now; this.speech = true; this.lastVoice = now; }
    else this.noise = this.noise * 0.95 + level * 0.05;
    if (this.speech && (now - this.lastVoice >= this.silenceMs || now - this.turnStart >= this.maxTurnMs)) { this.speech = false; return true; }
    return false;
  }

  /** Whether there is speech since the last commit (committing an empty buffer is an API error). */
  hasSpeech(): boolean { return this.speech; }
  reset() { this.speech = false; }
}

/** Root-mean-square level of a block of time-domain samples (-1..1). */
export function rms(samples: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

/** Error carrying one of the dictation failure codes below. */
export function dictationFailure(code: string, message = ''): Error { return Object.assign(new Error(message || code), {code}); }

/** One place that turns any dictation failure into a message for the psychologist. */
export function dictationMessage(err: any): string {
  const name = err?.name || '', code = err?.code || '';
  if (code === 'insecure') return 'O ditado precisa de conexão segura (HTTPS) ou do endereço localhost.';
  if (code === 'unsupported') return 'Este navegador não permite ditado. Use Chrome, Edge ou Safari atualizados.';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'O acesso ao microfone foi negado. Libere o microfone no cadeado da barra de endereço e tente de novo.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Nenhum microfone foi encontrado. Conecte um microfone e tente de novo.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'O microfone está em uso por outro programa ou não respondeu.';
  if (code === 'mic-ended') return 'O microfone foi desconectado durante o ditado.';
  if (code === 'connection') return 'A conexão com o serviço de transcrição caiu. O texto já confirmado foi mantido no campo.';
  if (code === 'timeout') return 'O serviço de transcrição demorou para responder. Tente de novo.';
  if (code === 'offline') return 'Sem internet. O ditado precisa de conexão.';
  if (code === 'unconfirmed') return 'Uma parte do áudio não foi confirmada pela transcrição.';
  if (code === 'api' || code === 'server') return err.message && err.message !== code ? err.message : 'Não foi possível abrir o ditado.';
  return 'Falha no ditado. Tente de novo.';
}

/** mm:ss */
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
