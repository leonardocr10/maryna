import {Injectable, inject, signal} from '@angular/core';
import {HttpClient, HttpHeaders} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';

/** HTTP access to /api (proxied to the Node backend) plus the shared toast. */
@Injectable({providedIn: 'root'})
export class Api {
  private http = inject(HttpClient);
  readonly toast = signal('');
  private toastTimer: any;
  readonly loggedIn = signal(!!sessionStorage.getItem('token'));

  notify(text: string) {
    this.toast.set(text);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(''), 2600);
  }

  private opts() { return {headers: new HttpHeaders({Authorization: 'Bearer ' + sessionStorage.getItem('token')})}; }

  async req<T = any>(method: string, url: string, body?: any): Promise<T> {
    try { return await firstValueFrom(this.http.request<T>(method, '/api' + url, {...this.opts(), body, responseType: 'json' as any})); }
    catch (e: any) {
      if (e?.status === 401 && !url.startsWith('/login')) { this.logout(); this.notify('Sessão expirada. Entre novamente.'); }
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
    sessionStorage.setItem('token', x.token); this.loggedIn.set(true);
  }
  logout() { sessionStorage.removeItem('token'); this.loggedIn.set(false); }

  async upload(evaluationId: string, kind: 'base' | 'anamnesis', file: File) {
    const fd = new FormData(); fd.append('file', file);
    return this.req('POST', `/evaluations/${evaluationId}/upload/${kind}`, fd);
  }
}
