import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CONTACT_EMAIL } from '../../core/site';
import { LegalPage } from './legal-page';

@Component({
  selector: 'app-privacy',
  imports: [LegalPage],
  // O e-mail fica logo abaixo da seção "Contato", a última.
  template: `
    <app-legal-page page="privacy" [sections]="sections">
      <p class="mt-2 mb-0">
        <a [href]="'mailto:' + contactEmail" class="text-primary underline underline-offset-2">{{ contactEmail }}</a>
      </p>
    </app-legal-page>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Privacy {
  protected readonly contactEmail = CONTACT_EMAIL;
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
