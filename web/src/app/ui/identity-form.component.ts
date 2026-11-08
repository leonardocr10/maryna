import {Component, ElementRef, EventEmitter, Input, Output, ViewChild, AfterViewInit} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {FilterSelectComponent} from './filter-select.component';
import {SCHOOLING_OPTIONS, SEX_OPTIONS, ageText, todayISO, withCurrent} from '../shared';

export interface Identity {name: string; birth_date: string; sex: string; schooling: string; start_date: string; end_date: string}
/** Required to create an evaluation: name, birth date, sex and schooling. */
export const identityMissing = (v: Identity) => [v.name.trim().length < 2 ? 'nome' : '', !v.birth_date ? 'data de nascimento' : '', !v.sex ? 'sexo' : '', !v.schooling ? 'escolaridade' : ''].filter(Boolean);
export const emptyIdentity = (): Identity => ({name: '', birth_date: '', sex: '', schooling: '', start_date: '', end_date: ''});

/** Patient identification fields; emits on every change (parent decides when to save). */
@Component({
  selector: 'nl-identity-form',
  standalone: true,
  imports: [CommonModule, FormsModule, FilterSelectComponent],
  template: `
<div class="field full"><label>Nome do paciente *</label>
  <input #nameBox class="input" [class.big]="big" [(ngModel)]="model.name" (ngModelChange)="emit()" placeholder="Nome completo" [disabled]="disabled"></div>
<div class="grid">
  <div class="field"><label>Data de nascimento *</label>
    <input class="input" type="date" [class.warn]="model.birth_date===today" [class.need]="showRequired && !model.birth_date" [(ngModel)]="model.birth_date" (ngModelChange)="emit()" [disabled]="disabled">
    <span *ngIf="model.birth_date===today" class="field-hint-warn">É a data de hoje. Confira o ano.</span>
    <span *ngIf="showRequired && !model.birth_date" class="need-hint">Obrigatório</span></div>
  <div class="field"><label>Idade <small>(automática)</small></label><input class="input" [value]="age()||'—'" readonly tabindex="-1"></div>
  <div class="field"><label>Sexo *</label>
    <nl-filter-select [class.need]="showRequired && !model.sex" [options]="sexOptions()" [value]="model.sex" (valueChange)="model.sex=$event;emit()" placeholder="Selecione" [disabled]="disabled"></nl-filter-select>
    <span *ngIf="showRequired && !model.sex" class="need-hint">Obrigatório</span></div>
  <div class="field"><label>Escolaridade *</label>
    <nl-filter-select [class.need]="showRequired && !model.schooling" [options]="schoolingOptions()" [value]="model.schooling" (valueChange)="model.schooling=$event;emit()" placeholder="Buscar: 6º ano, Ensino médio…" [disabled]="disabled"></nl-filter-select>
    <span *ngIf="showRequired && !model.schooling" class="need-hint">Obrigatório</span></div>
  <div class="field"><label>Início da avaliação</label><input class="input" type="date" [(ngModel)]="model.start_date" (ngModelChange)="emit()" [disabled]="disabled"></div>
  <div class="field"><label>Finalização do laudo</label><input class="input" type="date" [(ngModel)]="model.end_date" (ngModelChange)="emit()" [disabled]="disabled"></div>
</div>`,
  styles: [`
:host{display:flex;flex-direction:column;gap:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px}
.input.big{height:44px}
.input.need,.need ::ng-deep button{border-color:var(--danger,#c0392b)}
.need-hint{font-size:12px;color:var(--danger,#c0392b)}
`],
})
export class IdentityFormComponent implements AfterViewInit {
  @ViewChild('nameBox') nameBox?: ElementRef<HTMLInputElement>;
  @Input() model: Identity = emptyIdentity();
  @Input() disabled = false;
  @Input() big = false;
  @Input() autofocus = false;
  /** Marks empty required fields (birth date, sex, schooling) in red. */
  @Input() showRequired = false;
  @Output() modelChange = new EventEmitter<Identity>();
  today = todayISO();
  age() { return ageText(this.model.birth_date); }
  sexOptions() { return withCurrent(SEX_OPTIONS, this.model.sex); }
  schoolingOptions() { return withCurrent(SCHOOLING_OPTIONS, this.model.schooling); }
  emit() { this.modelChange.emit({...this.model}); }
  ngAfterViewInit() { if (this.autofocus) setTimeout(() => this.nameBox?.nativeElement.focus()); }
}
