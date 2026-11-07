import {Injectable, inject, signal} from '@angular/core';
import {HttpClient, HttpHeaders} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';

export type Role = 'admin' | 'psychologist' | 'assistant';
export interface Me {id: string; name: string; email: string; role: Role; active: boolean; must_change_password: boolean; last_login_at?: string | null}
export const ROLE_NAMES: Record<Role, string> = {admin: 'Administrador', psychologist: 'Psicóloga(o)', assistant: 'Estagiária(o) / assistente'};

/** HTTP access to /api (proxied to the Node backend) plus the shared toast. */
@Injectable({providedIn: 'root'})
export class Api {
  private http = inject(HttpClient);
  readonly toast = signal('');
  private toastTimer: any;
  readonly loggedIn = signal(!!sessionStorage.getItem('token'));
  /** The signed-in account (name, role, must_change_password); the server is the source of truth for the role. */
  readonly me = signal<Me | null>(null);

  notify(text: string) {
    this.toast.set(text);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(''), 2600);
  }

  private opts() { return {headers: new HttpHeaders({Authorization: 'Bearer ' + sessionStorage.getItem('token')})}; }

  async req<T = any>(method: string, url: string, body?: any): Promise<T> {
    try { return await firstValueFrom(this.http.request<T>(method, '/api' + url, {...this.opts(), body, responseType: 'json' as any})); }
    catch (e: any) {
      if (e?.status === 401 && !url.startsWith('/login')) { this.logout(); this.notify('Sessão encerrada. Entre novamente.'); }
      else if (e?.status === 403 && e?.error?.code === 'password_change_required') { const m = this.me(); if (m) this.me.set({...m, must_change_password: true}); }
      else this.notify(e?.status === 0 ? 'API indisponível. Abra o iniciar.bat.' : e?.error?.error || e.message);
      throw e;
    }
  }

  async blob(url: string): Promise<Blob> {
    try { return await firstValueFrom(this.http.post('/api' + url, {}, {...this.opts(), responseType: 'blob'})); }
    catch (e: any) {
      let msg = 'Falha ao montar o Word.';
      try { msg = JSON.parse(await (e.error as Blob).text()).error || msg; } catch {}
      this.notify(msg); throw e;
    }
  }

  /** GET a file (e.g. a model DOCX) with the session token. */
  async getBlob(url: string): Promise<Blob> {
    try { return await firstValueFrom(this.http.get('/api' + url, {...this.opts(), responseType: 'blob'})); }
    catch (e: any) {
      let msg = 'Não foi possível baixar o arquivo.';
      try { msg = JSON.parse(await (e.error as Blob).text()).error || msg; } catch {}
      this.notify(msg); throw e;
    }
  }

  async login(email: string, password: string) {
    const x = await this.req<any>('POST', '/login', {email, password});
    this.signedIn(x);
  }
  /** Stores a token the server handed back (login or password change) with the account it belongs to. */
  signedIn(x: {token: string} & Me) {
    const {token, ...me} = x;
    sessionStorage.setItem('token', token); this.me.set(me); this.loggedIn.set(true);
  }
  async loadMe() { try { this.me.set(await this.req<Me>('GET', '/me')); } catch {} }
  isAdmin() { return this.me()?.role === 'admin'; }
  logout() { sessionStorage.removeItem('token'); this.me.set(null); this.loggedIn.set(false); }

  async upload(evaluationId: string, kind: 'base' | 'anamnesis', file: File) {
    const fd = new FormData(); fd.append('file', file);
    return this.req('POST', `/evaluations/${evaluationId}/upload/${kind}`, fd);
  }
}
