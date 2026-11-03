import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ButtonModule } from 'primeng/button';
import { Lang } from '../../core/i18n/langs';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink, TranslocoPipe, ButtonModule],
  template: `
    <div class="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <p class="m-0 text-6xl font-bold text-primary">404</p>
      <h1 class="mt-4 mb-0 text-3xl font-bold">{{ 'notFound.title' | transloco }}</h1>
      <p class="mt-3 text-surface-600 dark:text-surface-300">{{ 'notFound.body' | transloco }}</p>
      <a pButton [routerLink]="['/', lang()]" class="mt-6">
        <i class="pi pi-home" pButtonIcon></i>
        <span pButtonLabel>{{ 'notFound.home' | transloco }}</span>
      </a>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFound {
  readonly lang = input.required<Lang>();
}
