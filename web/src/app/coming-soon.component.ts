import {Component, Input} from '@angular/core';
import {CommonModule} from '@angular/common';
import {IconComponent} from './ui/icon.component';

/** Menu areas from the design that still have no backend (Modelos de laudo, Biblioteca de testes, Relatórios). */
@Component({
  selector: 'nl-coming-soon',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
<div class="pagehead"><span class="hicon"><nl-icon [name]="icon"/></span><div><h1>{{title}}</h1><p>{{subtitle}}</p></div></div>
<section class="card soon">
  <span class="badge warn">Em breve</span>
  <h2>Esta área ainda não está disponível</h2>
  <p>{{plan}}</p>
  <ul><li *ngFor="let i of items">{{i}}</li></ul>
</section>`,
  styles: [`
.soon{padding:32px;max-width:720px;display:flex;flex-direction:column;gap:12px;align-items:flex-start}
.soon h2{font-size:18px;font-weight:600}
.soon p{color:var(--text-2);line-height:1.55}
.soon ul{margin:0;padding-left:20px;color:var(--text-3);font-size:13.5px;line-height:1.7}
`],
})
export class ComingSoonComponent {
  @Input() title = '';
  @Input() subtitle = '';
  @Input() icon = 'doc';
  @Input() plan = '';
  @Input() items: string[] = [];
}
