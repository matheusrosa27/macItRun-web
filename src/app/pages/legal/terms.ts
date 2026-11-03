import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LegalPage } from './legal-page';

@Component({
  selector: 'app-terms',
  imports: [LegalPage],
  template: `<app-legal-page page="terms" [sections]="sections" />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Terms {
  protected readonly sections = [
    'service',
    'warranty',
    'antiCheat',
    'accounts',
    'content',
    'prohibited',
    'moderation',
    'thirdParty',
    'changes',
  ];
}
