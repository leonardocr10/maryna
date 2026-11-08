import {bootstrapApplication} from '@angular/platform-browser';
import {provideZoneChangeDetection} from '@angular/core';
import {provideHttpClient} from '@angular/common/http';
import {AppComponent} from './app/app.component';
// Coalescing: one change detection per browser event (a key press reaches several document listeners), not one per listener.
bootstrapApplication(AppComponent,{providers:[provideZoneChangeDetection({eventCoalescing:true,runCoalescing:true}),provideHttpClient()]}).catch(console.error);
