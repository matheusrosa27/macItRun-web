import { ChangeDetectionStrategy, Component, inject, input, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';
import { authErrorKey } from '../../core/auth/auth-errors';
import { SavedProfile } from '../../core/community/community';
import { CommunityService } from '../../core/community/community.service';
import { macName } from '../../core/community/macs';
import { Lang } from '../../core/i18n/langs';

/** Os perfis de configuração que a pessoa salvou (lista particular, só ela vê). */
@Component({
  selector: 'app-saved-profiles',
  imports: [RouterLink, TranslocoPipe, ButtonModule, MessageModule, SkeletonModule, TagModule],
  template: `
    <h3 class="m-0 text-lg font-semibold">{{ 'saved.title' | transloco }}</h3>
    <p class="mt-2 mb-0 text-sm text-surface-600 dark:text-surface-400">{{ 'saved.hint' | transloco }}</p>

    @if (list.error()) {
      <p-message class="mt-4 block" severity="error" [text]="'auth.errors.generic' | transloco" />
    } @else if (list.value(); as items) {
      @if (items.length) {
        <ul class="m-0 mt-4 flex list-none flex-col gap-3 p-0">
          @for (p of items; track p.id) {
            <li class="flex flex-wrap items-center gap-3 rounded-xl border border-surface-200 p-4 dark:border-surface-800">
              <div class="min-w-0 flex-1">
                @if (p.available) {
                  <a [routerLink]="['/', lang(), 'community', p.id, p.slug]" class="font-medium text-primary break-words">{{ p.name }}</a>
                  <div class="mt-1 flex flex-wrap gap-2">
                    @if (p.graphics) {
                      <p-tag [value]="'community.graphics.' + p.graphics | transloco" />
                    }
                    @if (p.testedOn.mac) {
                      <p-tag [value]="macName(p.testedOn.mac)" severity="secondary" icon="pi pi-apple" />
                    }
                  </div>
                } @else {
                  <span class="font-medium break-words">{{ p.name }}</span>
                  <p-tag class="ml-2" [value]="'saved.unavailable' | transloco" severity="secondary" />
                }
              </div>
              <p-button
                icon="pi pi-bookmark-fill"
                [label]="'saved.remove' | transloco"
                severity="secondary"
                [text]="true"
                size="small"
                [loading]="removing() === p.id"
                (onClick)="remove(p)"
              />
            </li>
          }
        </ul>
      } @else {
        <p class="mt-4 mb-0 text-surface-600 dark:text-surface-400">
          {{ 'saved.empty' | transloco }}
          <a [routerLink]="['/', lang(), 'community']" class="text-primary underline underline-offset-2">{{ 'nav.community' | transloco }}</a>
        </p>
      }
    } @else {
      <p-skeleton class="mt-4 block" height="4rem" borderRadius="0.75rem" />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SavedProfiles {
  private readonly community = inject(CommunityService);
  private readonly messages = inject(MessageService);
  private readonly transloco = inject(TranslocoService);

  readonly lang = input.required<Lang>();

  protected readonly macName = macName;
  protected readonly list = resource({ loader: () => this.community.mySaved() });
  protected readonly removing = signal<string | null>(null);

  protected async remove(profile: SavedProfile): Promise<void> {
    this.removing.set(profile.id);
    try {
      await this.community.save(profile.id, false);
      this.list.update((items) => items?.filter((p) => p.id !== profile.id));
      this.messages.add({ severity: 'success', summary: this.transloco.translate('saved.removed'), life: 2500 });
    } catch (error) {
      this.messages.add({ severity: 'error', summary: this.transloco.translate(authErrorKey(error)), life: 4000 });
    } finally {
      this.removing.set(null);
    }
  }
}
