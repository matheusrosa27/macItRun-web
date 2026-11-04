import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { TopicSummary } from '../../core/community/community';
import { Lang } from '../../core/i18n/langs';
import { AuthorName } from '../community/author';
import { forumDate } from './dates';

/** Um tópico na lista do fórum. Todo texto vindo de usuário sai como texto puro. */
@Component({
  selector: 'app-topic-card',
  imports: [RouterLink, TranslocoPipe, AuthorName],
  template: `
    @let t = topic();
    <article
      class="flex flex-col gap-2 rounded-2xl border border-surface-200 bg-surface-0 p-5 dark:border-surface-800 dark:bg-surface-900"
    >
      <h2 class="m-0 text-lg font-semibold break-words">
        <a
          [routerLink]="['/', lang(), 'forum', t.id, t.slug]"
          class="text-inherit no-underline hover:text-primary focus-visible:text-primary"
          >{{ t.title }}</a
        >
      </h2>
      @if (t.excerpt) {
        <p class="m-0 line-clamp-2 break-words text-surface-600 dark:text-surface-300">{{ t.excerpt }}</p>
      }
      @if (t.tags.length) {
        <ul class="m-0 flex list-none flex-wrap gap-2 p-0">
          @for (tag of t.tags; track tag) {
            <li>
              <a
                [routerLink]="['/', lang(), 'forum']"
                [queryParams]="{ tag }"
                class="rounded-full bg-surface-100 px-2.5 py-0.5 text-xs text-surface-700 no-underline hover:bg-primary-100 hover:text-primary-700 dark:bg-surface-800 dark:text-surface-200 dark:hover:bg-primary-900 dark:hover:text-primary-200"
                >#{{ tag }}</a
              >
            </li>
          }
        </ul>
      }
      <div class="mt-1 flex flex-wrap items-center justify-between gap-3 text-sm text-surface-600 dark:text-surface-300">
        <span class="min-w-0">
          <app-author [author]="t.author" />
          ·
          <time [attr.datetime]="t.activityAt" [title]="'forum.card.activity' | transloco">{{ date(t.activityAt) }}</time>
        </span>
        <span class="flex items-center gap-3">
          @if (t.profiles) {
            <span [title]="'forum.card.profiles' | transloco">
              <i class="pi pi-sliders-h text-xs" aria-hidden="true"></i>
              <span class="sr-only">{{ 'forum.card.profiles' | transloco }}:</span> {{ t.profiles }}
            </span>
          }
          <span [title]="'forum.card.replies' | transloco">
            <i class="pi pi-comments text-xs" aria-hidden="true"></i>
            <span class="sr-only">{{ 'forum.card.replies' | transloco }}:</span> {{ t.replies }}
          </span>
        </span>
      </div>
    </article>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopicCard {
  readonly topic = input.required<TopicSummary>();
  readonly lang = input.required<Lang>();

  protected date(value: string): string {
    return forumDate(this.lang(), value);
  }
}
