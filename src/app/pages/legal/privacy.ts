import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LegalPage } from './legal-page';

@Component({
  selector: 'app-privacy',
  imports: [LegalPage],
  template: `<app-legal-page page="privacy" [sections]="sections" />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Privacy {
  protected readonly sections = [
    'controller',
    'data',
    'purpose',
    'legalBasis',
    'sharing',
    'retention',
    'cookies',
    'rights',
    'contact',
  ];
}
