import {Injectable, NgZone, computed, inject, signal} from '@angular/core';
import {Api} from '../api.service';
import {TranscriptAssembler, TurnDetector, rms, dictationFailure, dictationMessage} from './dictation-text';

export type DictationState = 'idle' | 'requesting' | 'recording' | 'paused' | 'processing' | 'error';

/** Where the dictated text goes: the field that started the dictation, whatever has the focus later. */
export interface DictationSink { insert(text: string): void }

export interface DictationStatus { enabled: boolean; allowed: boolean; reason: string | null; max_seconds: number }

const REALTIME_CALLS = 'https://api.openai.com/v1/realtime/calls';
const FINISH_WAIT_MS = 5000;

/** Resources of one open transcription session. */
interface Session {
  owner: object; sink: DictationSink; evaluationId?: string;
  ctx: AudioContext; analyser?: AnalyserNode; source?: MediaStreamAudioSourceNode;
  stream?: MediaStream; sender?: RTCRtpSender; pc?: RTCPeerConnection; dc?: RTCDataChannel;
  assembler: TranscriptAssembler; turns: TurnDetector;
  loop?: any; tick?: any; dropTimer?: any; finishing?: () => void;
  maxSeconds: number; closed: boolean;
}

/**
 * Voice dictation (Speech-to-Text) for text fields: one session at a time for the whole app.
 * Microphone -> WebRTC -> OpenAI Realtime transcription, with a 60-second client secret minted by our API
 * (the OpenAI key stays on the server). Nothing is recorded or stored; resources are released on stop/leave.
 */
@Injectable({providedIn: 'root'})
export class Dictation {
  private api = inject(Api);
  private zone = inject(NgZone);
  readonly state = signal<DictationState>('idle');
  readonly owner = signal<object | null>(null);
  readonly preview = signal('');
  readonly error = signal('');
  /** Text that was heard but never confirmed (connection drop, failed turn): offered to the user, never inserted alone. */
  readonly leftover = signal('');
  readonly seconds = signal(0);
  readonly maxSeconds = signal(0);
  readonly status = signal<DictationStatus | null>(null);
  readonly available = computed(() => !!this.status()?.enabled && !!this.status()?.allowed);
  private s: Session | null = null;
  private statusLoad?: Promise<void>;

  constructor() {
    // Leaving or reloading the page always releases the microphone and closes the session.
    addEventListener('pagehide', () => this.cancel());
  }

  /** Loads (once) whether dictation is enabled on the server for this user. */
  loadStatus(): Promise<void> {
    if (!this.statusLoad) this.statusLoad = this.api.req<DictationStatus>('GET', '/dictation/status')
      .then(s => this.status.set(s)).catch(() => { this.statusLoad = undefined; });
    return this.statusLoad;
  }

  isMine(owner: object) { return this.owner() === owner; }

  /** Starts dictating into `sink`. Any dictation in another field is finished first (its text stays there). */
  async start(owner: object, sink: DictationSink, evaluationId?: string) {
    if (this.s && this.s.owner !== owner) await this.stop();
    if (this.s) return;
    this.reset();
    this.owner.set(owner);
    this.state.set('requesting');
    // Created inside the click so Safari lets it run.
    const Ctx: typeof AudioContext | undefined = (window as any).AudioContext || (window as any).webkitAudioContext;
    let s: Session | null = null;
    try {
      if (!isSecureContext) throw dictationFailure('insecure');
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined' || !Ctx) throw dictationFailure('unsupported');
      if (!navigator.onLine) throw dictationFailure('offline');
      s = this.s = {owner, sink, evaluationId, ctx: new Ctx(), assembler: new TranscriptAssembler(), turns: new TurnDetector(), maxSeconds: 0, closed: false};
      s.ctx.resume().catch(() => {});
      await this.openMic(s);
      const token = await this.mintSecret(evaluationId);
      if (s.closed) return;
      s.maxSeconds = token.max_seconds; this.maxSeconds.set(token.max_seconds);
      await this.connect(s, token.client_secret);
      if (s.closed) return;
      this.zone.runOutsideAngular(() => {
        const buf = new Float32Array(1024);
        s!.loop = setInterval(() => {
          if (!s!.analyser || this.state() !== 'recording') return;
          s!.analyser.getFloatTimeDomainData(buf);
          if (s!.turns.feed(rms(buf), performance.now())) this.sendCommit(s!);
        }, 50);
      });
      s.tick = setInterval(() => {
        if (this.state() !== 'recording') return;
        this.seconds.update(v => v + 1);
        if (s!.maxSeconds && this.seconds() >= s!.maxSeconds) { this.api.notify('Tempo máximo do ditado atingido. O texto foi mantido.'); this.stop(); }
      }, 1000);
      this.state.set('recording');
    } catch (e) {
      if (s?.closed) return;
      this.fail(e);
    }
  }

  /** Pauses: the turn spoken so far is confirmed and the microphone is turned off (no audio is sent). */
  pause() {
    const s = this.s; if (!s || this.state() !== 'recording') return;
    this.commit(s);
    this.closeMic(s);
    s.sender?.replaceTrack(null).catch(() => {});
    this.state.set('paused');
  }

  async resume() {
    const s = this.s; if (!s || this.state() !== 'paused') return;
    this.state.set('requesting');
    try {
      await this.openMic(s);
      await s.sender?.replaceTrack(s.stream!.getAudioTracks()[0]);
      if (!s.closed) this.state.set('recording');
    } catch (e) { this.fail(e); }
  }

  /** Finishes: confirms the last turn, waits briefly for its transcript, then closes everything. */
  async stop() {
    const s = this.s; if (!s) return;
    if (this.state() === 'requesting') { this.cancel(); return; }
    if (this.state() === 'error') { this.cancel(); return; }
    this.commit(s);
    this.closeMic(s);
    s.sender?.replaceTrack(null).catch(() => {});
    if (s.assembler.pending()) {
      this.state.set('processing');
      await new Promise<void>(done => { s.finishing = done; setTimeout(done, FINISH_WAIT_MS); });
    }
    if (s.closed) return;
    const rest = s.assembler.takeUnconfirmed();
    this.teardown(s);
    if (rest) { this.leftover.set(rest); this.error.set(dictationMessage({code: 'unconfirmed'})); this.state.set('error'); return; }
    this.reset();
  }

  /** Closes at once, without waiting for transcripts (component destroyed, page left, cancel while connecting). */
  cancel() {
    if (this.s) this.teardown(this.s);
    this.reset();
  }

  /** Clears an error/leftover panel. */
  dismiss() { if (!this.s) this.reset(); }

  /** Gives the leftover text to the caller (it decides to insert it) and clears it. */
  takeLeftover(): string { const t = this.leftover(); this.leftover.set(''); return t; }

  // ---- internals ----

  private reset() {
    this.owner.set(null); this.state.set('idle'); this.preview.set(''); this.error.set(''); this.leftover.set('');
    this.seconds.set(0); this.maxSeconds.set(0);
  }

  private async openMic(s: Session) {
    const stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1}});
    if (s.closed) { stream.getTracks().forEach(t => t.stop()); return; }
    s.stream = stream;
    const track = stream.getAudioTracks()[0];
    if (!track) throw Object.assign(new Error('no track'), {name: 'NotFoundError'});
    track.onended = () => { if (!s.closed && this.state() === 'recording') this.fail(dictationFailure('mic-ended')); };
    s.source = s.ctx.createMediaStreamSource(stream);
    s.analyser ??= Object.assign(s.ctx.createAnalyser(), {fftSize: 1024});
    s.source.connect(s.analyser);
    s.turns.reset();
  }

  private closeMic(s: Session) {
    try { s.source?.disconnect(); } catch {}
    s.stream?.getTracks().forEach(t => { t.onended = null; t.stop(); });
    s.stream = undefined; s.source = undefined;
  }

  private async mintSecret(evaluationId?: string): Promise<{client_secret: string; max_seconds: number}> {
    let r: Response;
    try {
      r = await fetch('/api/dictation/session', {method: 'POST', cache: 'no-store', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + sessionStorage.getItem('token')}, body: JSON.stringify({evaluation_id: evaluationId || null})});
    } catch { throw dictationFailure('server', 'API indisponível. Abra o iniciar.bat.'); }
    const body = await r.json().catch(() => ({}));
    if (r.status === 401) { this.api.logout(); throw dictationFailure('server', 'Sessão expirada. Entre novamente.'); }
    if (!r.ok || !body.client_secret) throw dictationFailure('server', body.error);
    return body;
  }

  private async connect(s: Session, secret: string) {
    const pc = s.pc = new RTCPeerConnection();
    s.sender = pc.addTrack(s.stream!.getAudioTracks()[0], s.stream!);
    const dc = s.dc = pc.createDataChannel('oai-events');
    dc.onmessage = e => this.zone.run(() => this.onEvent(s, e.data));
    dc.onclose = () => { if (!s.closed) this.zone.run(() => this.fail(dictationFailure('connection'))); };
    pc.onconnectionstatechange = () => this.zone.run(() => {
      if (s.closed) return;
      const st = pc.connectionState;
      if (st === 'failed') this.fail(dictationFailure('connection'));
      else if (st === 'disconnected') { clearTimeout(s.dropTimer); s.dropTimer = setTimeout(() => { if (pc.connectionState !== 'connected' && !s.closed) this.fail(dictationFailure('connection')); }, 4000); }
      else if (st === 'connected') clearTimeout(s.dropTimer);
    });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    let r: Response;
    try {
      r = await fetch(REALTIME_CALLS, {method: 'POST', body: offer.sdp, headers: {Authorization: 'Bearer ' + secret, 'Content-Type': 'application/sdp'}, signal: AbortSignal.timeout(15000)});
    } catch (e: any) { throw dictationFailure(e?.name === 'TimeoutError' ? 'timeout' : navigator.onLine ? 'connection' : 'offline'); }
    if (!r.ok) {
      let msg = ''; try { msg = (await r.json())?.error?.message || ''; } catch {}
      throw dictationFailure('api', r.status === 401 ? 'A credencial temporária do ditado expirou. Tente de novo.' : 'O serviço de transcrição recusou a conexão' + (msg ? ': ' + msg : '.'));
    }
    if (s.closed) return;
    await pc.setRemoteDescription({type: 'answer', sdp: await r.text()});
    if (dc.readyState !== 'open') await new Promise<void>((ok, bad) => {
      const t = setTimeout(() => bad(dictationFailure('timeout')), 10000);
      dc.addEventListener('open', () => { clearTimeout(t); ok(); }, {once: true});
    });
  }

  /** Closes the current turn if something was said in it (pause/stop). */
  private commit(s: Session) {
    if (!s.turns.hasSpeech()) return;
    s.turns.reset();
    this.sendCommit(s);
  }

  private sendCommit(s: Session) {
    if (s.dc?.readyState === 'open') s.dc.send(JSON.stringify({type: 'input_audio_buffer.commit'}));
  }

  private onEvent(s: Session, raw: string) {
    if (s.closed) return;
    let ev: any; try { ev = JSON.parse(raw); } catch { return; }
    const a = s.assembler;
    let confirmed: string[] = [];
    switch (ev.type) {
      case 'input_audio_buffer.committed': a.committed(ev.item_id, ev.previous_item_id); break;
      case 'conversation.item.input_audio_transcription.delta': a.delta(ev.item_id, ev.delta || ''); break;
      case 'conversation.item.input_audio_transcription.completed': confirmed = a.completed(ev.item_id, ev.transcript || ''); break;
      case 'conversation.item.input_audio_transcription.failed': confirmed = a.failed(ev.item_id); break;
      case 'error':
        // A commit right after a pause can find an empty buffer: harmless.
        if (/buffer.*(empty|too small)|commit_empty/i.test((ev.error?.code || '') + ' ' + (ev.error?.message || ''))) return;
        this.fail(dictationFailure('api', 'Erro do serviço de transcrição' + (ev.error?.message ? ': ' + ev.error.message : '.')));
        return;
      default: return;
    }
    for (const text of confirmed) s.sink.insert(text);
    this.preview.set(a.preview());
    if (s.finishing && !a.pending()) s.finishing();
  }

  private fail(err: any) {
    const s = this.s;
    const rest = s ? s.assembler.takeUnconfirmed() : '';
    if (s) this.teardown(s);
    this.preview.set('');
    this.leftover.set(rest);
    this.error.set(dictationMessage(err));
    this.state.set('error');
  }

  private teardown(s: Session) {
    s.closed = true;
    clearInterval(s.loop); clearInterval(s.tick); clearTimeout(s.dropTimer);
    s.finishing?.();
    this.closeMic(s);
    if (s.dc) { s.dc.onclose = null; s.dc.onmessage = null; try { s.dc.close(); } catch {} }
    if (s.pc) { s.pc.onconnectionstatechange = null; try { s.pc.close(); } catch {} }
    s.ctx.close().catch(() => {});
    if (this.s === s) this.s = null;
  }
}
