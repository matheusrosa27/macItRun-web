import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { TagModule } from 'primeng/tag';
import { BADGE_STYLE, knownBadges } from '../../core/community/badges';
import { Author } from '../../core/community/community';

/** "@nome" com as tags da pessoa (Admin, Veterano...), ou "autor removido". */
@Component({
  selector: 'app-author',
  imports: [TranslocoPipe, TagModule],
  template: `
    @if (author()?.username; as username) {
      <span class="inline-flex flex-wrap items-center gap-1.5">
        <span [class]="strong() ? 'font-medium text-surface-800 dark:text-surface-100' : ''">{{ '@' + username }}</span>
        @for (badge of badges(); track badge) {
          <p-tag
            [value]="'badges.' + badge + '.label' | transloco"
            [icon]="style[badge].icon"
            [severity]="style[badge].severity"
            [title]="'badges.' + badge + '.description' | transloco"
            styleClass="!px-1.5 !py-0 !text-xs"
          />
        }
      </span>
    } @else {
      <span class="italic">{{ 'community.card.deletedAuthor' | transloco }}</span>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthorName {
  readonly author = input.required<Author | null | undefined>();
  /** Destaca o nome (comentários). */
  readonly strong = input(false);

  protected readonly style = BADGE_STYLE;
  protected readonly badges = computed(() => knownBadges(this.author()?.badges));
}
