import {Injectable} from '@angular/core';

/** What a screen shows on the left of the top bar (the evaluation: patient name, status and summary). */
export interface TopInfo {title: string; badge?: {label: string; css: string}; sub?: string}

@Injectable({providedIn: 'root'})
export class TopbarService {
  /** Read on every change detection by the app shell; the screen that set it clears it when it closes. */
  info: (() => TopInfo | null) | null = null;
}
