import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { TagModule } from 'primeng/tag';
import { ProfileSummary } from '../../core/community/community';
import { macName } from '../../core/community/macs';
import { Lang } from '../../core/i18n/langs';

/** Um perfil na lista da Comunidade. Todo texto vindo de usuário sai como texto puro. */
@Component({
  selector: 'app-profile-card',
  imports: [RouterLink, TranslocoPipe, TagModule],
  template: `
    @let p = profile();
    <a
      [routerLink]="['/', lang(), 'community', p.id, p.slug]"
      class="flex h-full flex-col gap-3 rounded-2xl border border-surface-200 bg-surface-0 p-5 text-inherit no-underline transition-colors hover:border-primary-400 focus-visible:border-primary-400 dark:border-surface-800 dark:bg-surface-900 dark:hover:border-primary-500"
    >
      <div>
        <h2 class="m-0 text-lg font-semibold break-words">{{ p.name }}</h2>
        <p class="m-0 mt-1 truncate font-mono text-xs text-surface-500 dark:text-surface-400">
          {{ p.executables.join(', ') }}
        </p>
      </div>

      <div class="flex flex-wrap gap-2">
        @if (p.graphics) {
          <p-tag [value]="'community.graphics.' + p.graphics | transloco" />
        }
        @if (p.windowsVersion) {
          <p-tag [value]="'community.windows.' + p.windowsVersion | transloco" severity="secondary" />
        }
        @if (p.testedOn.mac) {
          <p-tag
            [value]="'community.card.testedOn' | transloco: { mac: macName(p.testedOn.mac) }"
            severity="secondary"
            icon="pi pi-apple"
          />
        }
      </div>

      <div class="mt-auto flex flex-wrap items-center justify-between gap-3 text-sm text-surface-600 dark:text-surface-300">
        <span class="truncate">
          @if (p.author?.username; as username) {
            {{ 'community.card.by' | transloco: { username: '@' + username } }}
          } @else {
            <span class="italic">{{ 'community.card.deletedAuthor' | transloco }}</span>
          }
        </span>
        <span class="flex items-center gap-3">
          <span [title]="'community.card.likes' | transloco">
            <i class="pi pi-heart text-xs" aria-hidden="true"></i>
            <span class="sr-only">{{ 'community.card.likes' | transloco }}:</span> {{ p.likes }}
          </span>
          <span [title]="'community.card.comments' | transloco">
            <i class="pi pi-comment text-xs" aria-hidden="true"></i>
            <span class="sr-only">{{ 'community.card.comments' | transloco }}:</span> {{ p.comments }}
          </span>
          <span [title]="'community.card.downloads' | transloco">
            <i class="pi pi-download text-xs" aria-hidden="true"></i>
            <span class="sr-only">{{ 'community.card.downloads' | transloco }}:</span> {{ p.downloads }}
          </span>
        </span>
      </div>
    </a>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileCard {
  readonly profile = input.required<ProfileSummary>();
  readonly lang = input.required<Lang>();

  protected readonly macName = macName;
}
