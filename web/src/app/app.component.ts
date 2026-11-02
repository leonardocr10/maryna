import {Component,inject} from '@angular/core';import {CommonModule} from '@angular/common';import {FormsModule} from '@angular/forms';import {HttpClient,HttpHeaders} from '@angular/common/http';import {firstValueFrom} from 'rxjs';
@Component({selector:'app-root',standalone:true,imports:[CommonModule,FormsModule],template:`
<header><div><strong>🧠 NeuroLaudos IA</strong><div class="muted">Clínica • Elaboração assistida</div></div><span>{{loggedIn?'Ambiente autenticado':'Acesso restrito'}}</span></header>
<main>
 <section *ngIf="!loggedIn" class="card"><h1>Entrar</h1><p class="muted">Use um usuário do sistema ou configure o primeiro administrador.</p><label>E-mail</label><input [(ngModel)]="email" type="email"><label>Senha</label><input [(ngModel)]="password" type="password"><div class="row" style="margin-top:16px"><button (click)="login()">Entrar</button><button class="secondary" (click)="setup()">Primeiro acesso (setup)</button></div><p class="warning">{{message}}</p></section>
 <ng-container *ngIf="loggedIn">
  <div class="row tabs" style="margin-bottom:20px"><button [class.selected]="tab==='avaliacoes'" (click)="tab='avaliacoes';load()">Avaliações</button><button [class.selected]="tab==='documentos'" (click)="tab='documentos';load()">Documentos</button><button [class.selected]="tab==='editor'" (click)="tab='editor'">Montar laudo</button><button [class.selected]="tab==='config'" (click)="tab='config';settings()">Configurações IA</button><button class="secondary" (click)="logout()">Sair</button></div>
  <section *ngIf="tab==='avaliacoes'" class="split">
<div class="card"><h2>Nova avaliação</h2><label>Nome do paciente</label><input [(ngModel)]="patientName" (keyup.enter)="create()"><label>Data de nascimento</label><input type="date" [(ngModel)]="birthDate"><button style="margin-top:16px;width:100%" [disabled]="patientName.trim().length<2" (click)="create()">Cadastrar e iniciar avaliação</button></div>
<div class="card"><h2>Avaliações cadastradas <span class="muted count">{{evaluations.length}}</span></h2>
<p *ngIf="!evaluations.length" class="muted">Nenhuma avaliação ainda.</p>
<div *ngFor="let x of evaluations" class="eval-row">
<div class="eval-info"><strong>{{x.patient_name}}</strong><span class="muted">{{x.created_at | date:'dd/MM/yyyy HH:mm'}}</span></div>
<span class="badge" [class]="'badge '+x.status">{{statusLabel(x.status)}}</span>
<button class="secondary" (click)="select(x.id)">Abrir</button>
<button class="danger" title="Excluir avaliação" (click)="removeEvaluation(x)">Excluir</button>
</div></div>
</section>
  <section *ngIf="tab==='documentos'" class="card">
<h2>Arquivos da avaliação</h2>
<label>Avaliação</label>
<select [ngModel]="evaluationId" (ngModelChange)="select($event,'documentos')">
<option value="" disabled>Escolha a avaliação…</option>
<option *ngFor="let x of evaluations" [value]="x.id">{{x.patient_name}} — {{statusLabel(x.status)}}</option>
</select>
<p *ngIf="!evaluations.length" class="muted">Nenhuma avaliação ainda. Crie uma na aba Avaliações.</p>
<div class="grid" style="margin-top:18px">
<div *ngFor="let d of dropSlots" class="drop" [class.over]="dragOver===d.kind" [class.done]="docName(d.kind)" [class.disabled]="!evaluationId" [class.busy]="uploading===d.kind"
 (click)="evaluationId&&picker.click()" (dragover)="$event.preventDefault();dragOver=d.kind" (dragleave)="dragOver=''" (drop)="onDrop($event,d.kind)">
<input #picker type="file" accept=".docx" hidden (change)="onPick($event,d.kind)">
<div class="drop-icon">{{uploading===d.kind?'⏳':docName(d.kind)?'✅':'📄'}}</div>
<strong>{{d.title}}</strong>
<span class="muted">{{d.hint}}</span>
<span *ngIf="docName(d.kind) && uploading!==d.kind" class="filename">{{docName(d.kind)}}</span>
<span class="drop-cta">{{uploading===d.kind?'Enviando…':docName(d.kind)?'Arraste outro para substituir':'Arraste o DOCX aqui ou clique para escolher'}}</span>
</div>
</div>
<div *ngIf="inspection" class="found">
<h3>Pronto! Encontramos {{inspection.markers.length}} lugares para preencher no arquivo base</h3>
<div class="chips"><span *ngFor="let m of inspection.markers" class="chip">{{nameOf(m.key)}}</span></div>
<p *ngIf="missingMarkers().length" class="warning">Não encontrado no arquivo base: {{missingMarkers().join(', ')}}. Essas partes não entrarão no Word.</p>
<button style="margin-top:14px" (click)="tab='editor'">Continuar para Montar laudo →</button>
</div>
</section>
  <section *ngIf="tab==='editor'" class="card">
<h2>Montar o laudo</h2>
<p *ngIf="!evaluationId" class="warning">Abra uma avaliação na aba Avaliações primeiro.</p>
<ng-container *ngIf="evaluationId">
<p class="muted">Faça cada parte na ordem. Tudo é rascunho: revise antes de aprovar.</p>
<div class="steps">
<button *ngFor="let s of sectionKeys;let i=index" class="step" [class.selected]="s.id===sectionKey" (click)="pick(s.id)">
<span class="dot" [class.ok]="statusOf(s.id)==='approved'" [class.draft]="statusOf(s.id)==='edited'||statusOf(s.id)==='generated'">{{statusOf(s.id)==='approved'?'✓':i+1}}</span>{{s.name}}</button>
</div>
<h3>{{nameOf(sectionKey)}}</h3>
<div class="how">
<p><strong>1.</strong> Clique em copiar. O ChatGPT abre numa aba nova.</p>
<div class="row"><button (click)="copyPrompt()">📋 Copiar pedido e abrir ChatGPT</button><button *ngIf="aiReady" class="secondary" (click)="generate()">✨ Gerar pela API</button></div>
<p><strong>2.</strong> No ChatGPT, cole com <kbd>Ctrl</kbd>+<kbd>V</kbd>, envie e copie a resposta.</p>
<p><strong>3.</strong> Cole a resposta abaixo, revise e aprove.</p>
<button class="secondary" (click)="pasteAnswer()">📥 Colar resposta do ChatGPT</button>
</div>
<textarea style="min-height:320px;margin-top:12px" [(ngModel)]="editor" placeholder="Cole aqui a resposta do ChatGPT. Títulos de tópicos podem começar com ## ou estar em **negrito**."></textarea>
<details style="margin-top:10px"><summary class="muted">Observações extras para este pedido (opcional)</summary><textarea [(ngModel)]="notes" style="min-height:75px"></textarea></details>
<div class="row" style="margin:15px 0">
<button [disabled]="!editor.trim()" (click)="approveAndNext()">✓ Aprovar e ir para a próxima</button>
<button class="secondary" [disabled]="!editor.trim()" (click)="save(false)">Salvar sem aprovar</button>
</div>
<hr>
<p>{{approvedCount()}} de {{sectionKeys.length}} partes aprovadas. As partes sem texto ficam em branco no Word.</p>
<button [disabled]="!approvedCount()" (click)="finish()">📄 Gerar laudo em Word</button>
<p class="muted">O arquivo base original nunca é alterado. A Hipótese Diagnóstica continua sendo escrita pela psicóloga no Word.</p>
</ng-container>
</section>
  <section *ngIf="tab==='config'" class="card"><h2>Minha senha</h2><p class="muted">Troque a senha padrão antes de liberar o sistema para outras pessoas.</p><div class="grid"><div><label>Senha atual</label><input type="password" [(ngModel)]="pwCurrent" autocomplete="current-password"></div><div><label>Nova senha (mín. 10 caracteres)</label><input type="password" [(ngModel)]="pwNext" autocomplete="new-password"></div></div><button style="margin-top:14px" [disabled]="pwNext.length<10" (click)="changePassword()">Trocar senha</button></section>
<section *ngIf="tab==='config'" class="card"><h2>Configurações OpenAI</h2><p class="muted">A chave OPENAI_API_KEY é configurada no servidor, nunca no navegador.</p><label>Modelo disponível na sua conta API</label><input [(ngModel)]="model"><label><input style="width:auto" type="checkbox" [(ngModel)]="aiEnabled"> Habilitar geração (também requer AI_ENABLED e ALLOW_EXTERNAL_AI no backend)</label><button (click)="saveSettings()">Salvar configurações</button><p>Chave API configurada: {{apiConfigured?'Sim':'Não'}} • Ambiente autorizado para transmissão: {{privacyGate?'Sim':'Não'}}</p><h2>Editor de prompt</h2><select [(ngModel)]="promptKey" (change)="loadPrompt()"><option *ngFor="let s of sectionKeys" [value]="s.id">{{s.name}}</option></select><textarea [(ngModel)]="promptText" placeholder="Defina as regras do tópico..."></textarea><button (click)="savePrompt()">Salvar prompt deste tópico</button></section>
  <p class="muted">{{message}}</p>
 </ng-container>
</main>`})
export class AppComponent{private http=inject(HttpClient);base='/api';loggedIn=!!sessionStorage.getItem('token');email='';password='';message='';tab='avaliacoes';patientName='';birthDate='';evaluations:any[]=[];evaluationId='';files:any={};inspection:any;sectionKey='demanda';editor='';notes='';sections:any[]=[];model='gpt-4.1';aiEnabled=false;apiConfigured=false;privacyGate=false;promptKey='anamnesis';promptText='';sectionKeys=[{id:'demanda',name:'Descrição da demanda'},{id:'anamnesis',name:'Anamnese por tópicos'},{id:'inteligencia',name:'Habilidades intelectuais'},{id:'percepcao',name:'Percepção'},{id:'memoria',name:'Memória e aprendizagem'},{id:'atencao',name:'Processos atencionais'},{id:'funcoes_executivas',name:'Funções executivas'},{id:'comportamento',name:'Comportamento'},{id:'comportamento_diva',name:'Comportamento / DIVA'},{id:'conclusao',name:'Conclusão (rascunho)'},{id:'recomendacoes',name:'Indicações e recomendações'}];constructor(){if(this.loggedIn){this.load();this.settings()}}
 private opts(){return{headers:new HttpHeaders({Authorization:'Bearer '+sessionStorage.getItem('token')})}}private async req(method:string,url:string,body?:any):Promise<any>{try{return await firstValueFrom(this.http.request(method,this.base+url,{...this.opts(),body,responseType:'json'}))}catch(e:any){if(e?.status===401&&!url.startsWith('/login')){this.logout();this.message='Sessão expirada. Entre novamente.'}else this.message=e?.status===0?'API indisponível. Verifique se o backend está rodando.':e?.error?.error||e.message;throw e}}
 async login(){try{const x=await this.req('POST','/login',{email:this.email,password:this.password});sessionStorage.setItem('token',x.token);this.loggedIn=true;this.message='';await this.load();await this.settings()}catch{}}async setup(){try{await this.req('POST','/setup',{email:this.email,name:'Administrador',password:this.password});this.message='Administrador criado. Agora clique em Entrar.'}catch{}}logout(){sessionStorage.removeItem('token');this.loggedIn=false;this.evaluationId='';this.sections=[];this.documents=[];this.inspection=null}
 async load(){try{this.evaluations=await this.req('GET','/evaluations')}catch{}}async create(){try{const p=await this.req('POST','/patients',{name:this.patientName,birth_date:this.birthDate||null});const e=await this.req('POST','/evaluations',{patient_id:p.id});await this.select(e.id);await this.load();this.message='Avaliação criada'}catch{}}async select(id:string,tab='documentos'){this.evaluationId=id;this.tab=tab;this.inspection=null;try{await this.refresh();this.syncEditor();if(this.docName('base')&&this.docName('anamnesis'))await this.inspect()}catch{}}
 dropSlots=[{kind:'base',title:'1. Arquivo base',hint:'Preenchido pela estagiária, com tabelas e escores'},{kind:'anamnesis',title:'2. Anamnese',hint:'Anotações da psicóloga'}];documents:any[]=[];dragOver='';uploading='';
 statusLabel(s:string){return({draft:'rascunho',review:'em revisão',approved:'aprovada'} as any)[s]||s}
 docName(kind:string){return this.documents.find(d=>d.kind===kind)?.filename||''}
 missingMarkers(){const found=new Set((this.inspection?.markers||[]).map((m:any)=>m.key));return this.sectionKeys.filter(s=>!found.has(s.id)).map(s=>s.name)}
 onDrop(e:DragEvent,kind:string){e.preventDefault();this.dragOver='';if(this.evaluationId)this.upload(kind,e.dataTransfer?.files?.[0])}
 onPick(e:Event,kind:string){const input=e.target as HTMLInputElement;this.upload(kind,input.files?.[0]);input.value=''}
 async upload(kind:string,file?:File|null){if(!file)return;if(!file.name.toLowerCase().endsWith('.docx')){this.message='Envie um arquivo .docx (Word).';return}this.uploading=kind;try{const fd=new FormData();fd.append('file',file);await this.req('POST',`/evaluations/${this.evaluationId}/upload/${kind}`,fd);await this.refresh();this.message='';if(this.docName('base')&&this.docName('anamnesis'))await this.inspect()}catch{}finally{this.uploading=''}}
 async inspect(){try{this.inspection=await this.req('POST',`/evaluations/${this.evaluationId}/inspect`)}catch{}}syncEditor(){this.editor=this.sections.find(s=>s.section_key===this.sectionKey)?.content||''}
 aiReady=false;statusOf(k:string){return this.sections.find(s=>s.section_key===k)?.status||''}nameOf(k:string){return this.sectionKeys.find(s=>s.id===k)?.name||k}approvedCount(){return this.sections.filter(s=>s.status==='approved').length}
 pick(k:string){this.sectionKey=k;this.notes='';this.syncEditor()}
 async copyPrompt(){try{const r=await this.req('POST',`/evaluations/${this.evaluationId}/prompt/${this.sectionKey}`,{notes:this.notes});await navigator.clipboard.writeText(r.text);window.open('https://chatgpt.com/','chatgpt');this.message='Pedido copiado. Cole no ChatGPT com Ctrl+V.'}catch{}}
 async pasteAnswer(){try{this.editor=(await navigator.clipboard.readText()).trim();this.message='Resposta colada. Revise antes de aprovar.'}catch{this.message='Não consegui ler a área de transferência. Clique no campo e use Ctrl+V.'}}
 async approveAndNext(){await this.save(true);if(this.statusOf(this.sectionKey)!=='approved')return;const i=this.sectionKeys.findIndex(s=>s.id===this.sectionKey);const next=this.sectionKeys.slice(i+1).find(s=>this.statusOf(s.id)!=='approved');if(next)this.pick(next.id);else this.message='Todas as partes aprovadas. Clique em Gerar laudo em Word.'}
 async finish(){try{const r=await this.req('GET','/evaluations/'+this.evaluationId);if(r.evaluation.status!=='approved')await this.req('POST',`/evaluations/${this.evaluationId}/approve`);await this.exportDocx();this.message='Laudo gerado.'}catch{}}async generate(){try{const r=await this.req('POST',`/evaluations/${this.evaluationId}/generate/${this.sectionKey}`,{notes:this.notes});this.editor=r.text;this.message='Texto gerado. Confira e aprove.';await this.refresh()}catch{}}async save(approve:boolean){try{await this.req('PUT',`/evaluations/${this.evaluationId}/sections/${this.sectionKey}`,{content:this.editor,approve});await this.refresh();this.message=approve?'Tópico aprovado':'Edição salva'}catch{}}async refresh(){const r=await this.req('GET','/evaluations/'+this.evaluationId);this.sections=r.sections||[];this.documents=r.documents||[]}
 async approveEvaluation(){try{await this.req('POST',`/evaluations/${this.evaluationId}/approve`);this.message='Avaliação aprovada'}catch{}}async exportDocx(){try{const response:any=await firstValueFrom(this.http.post(this.base+`/evaluations/${this.evaluationId}/export`,{},{...this.opts(),responseType:'blob'}));const url=URL.createObjectURL(response);const a=document.createElement('a');a.href=url;a.download='laudo-'+(this.evaluations.find(x=>x.id===this.evaluationId)?.patient_name||'revisado').replace(/[^\p{L}\p{N}]+/gu,'-')+'.docx';a.click();URL.revokeObjectURL(url)}catch(e:any){this.message='Falha na exportação. Confira se as seções estão aprovadas.'}}
 async settings(){try{const s=await this.req('GET','/ai/settings');this.model=s.model;this.aiEnabled=s.enabled;this.apiConfigured=s.configured;this.privacyGate=s.privacy_gate;this.aiReady=s.enabled&&s.configured&&s.privacy_gate;this.defaults=s.defaults||{};this.saved=Object.fromEntries((s.prompts||[]).map((x:any)=>[x.id,x.prompt]));this.loadPrompt()}catch{}}defaults:any={};saved:any={};loadPrompt(){this.promptText=this.saved[this.promptKey]||this.defaults[this.promptKey]||''}async saveSettings(){try{await this.req('PUT','/ai/settings',{model:this.model,enabled:this.aiEnabled});this.message='Configuração salva'}catch{}}async removeEvaluation(x:any){if(!confirm(`Excluir a avaliação de ${x.patient_name}?\n\nOs documentos enviados e os textos serão apagados definitivamente.`))return;try{await this.req('DELETE','/evaluations/'+x.id);if(this.evaluationId===x.id){this.evaluationId='';this.sections=[];this.documents=[];this.inspection=null}await this.load();this.message='Avaliação excluída.'}catch{}}pwCurrent='';pwNext='';async changePassword(){try{await this.req('PUT','/me/password',{current:this.pwCurrent,next:this.pwNext});this.pwCurrent='';this.pwNext='';this.message='Senha alterada.'}catch{}}async savePrompt(){try{await this.req('PUT','/ai/prompts/'+this.promptKey,{prompt:this.promptText});this.message='Prompt salvo'}catch{}}
}
