import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * Esqueleto das páginas legais: título, data, introdução e seções vindas de
 * `legal.<page>.*` nas traduções. Conteúdo extra entra depois das seções.
 */
@Component({
  selector: 'app-legal-page',
  imports: [TranslocoPipe],
  template: `
    <article class="mx-auto max-w-3xl px-4 py-12 md:py-16">
      <h1 class="m-0 text-4xl font-bold">{{ 'legal.' + page() + '.title' | transloco }}</h1>
      <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
        {{ 'legal.updated' | transloco: { date: ('legal.updatedDate' | transloco) } }}
      </p>
      <p class="plain-text mt-6 text-lg text-surface-700 dark:text-surface-200">{{
        'legal.' + page() + '.intro' | transloco
      }}</p>
      @for (section of sections(); track section) {
        <section class="mt-8">
          <h2 class="m-0 text-xl font-semibold">
            {{ 'legal.' + page() + '.' + section + '.title' | transloco }}
          </h2>
          <p class="plain-text mt-2 mb-0 leading-relaxed text-surface-700 dark:text-surface-300">{{
            'legal.' + page() + '.' + section + '.body' | transloco
          }}</p>
        </section>
      }
      <ng-content />
    </article>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LegalPage {
  readonly page = input.required<string>();
  readonly sections = input.required<string[]>();
}
