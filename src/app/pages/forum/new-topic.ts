import { ChangeDetectionStrategy, Component, computed, inject, input, resource, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { MessageService } from 'primeng/api';
import { MessageModule } from 'primeng/message';
import { authErrorKey } from '../../core/auth/auth-errors';
import { AuthService } from '../../core/auth/auth.service';
import { COMMUNITY_ENABLED, TopicInput } from '../../core/community/community';
import { CommunityService } from '../../core/community/community.service';
import { Lang } from '../../core/i18n/langs';
import { TopicForm, TopicFormValue } from './topic-form';

/**
 * Novo tópico do fórum. Vindo da página de um perfil (?profile=<id>), já começa citando ele.
 * A rota pede login; aqui só falta conferir se a conta está completa.
 */
@Component({
  selector: 'app-new-topic',
  imports: [RouterLink, TranslocoPipe, MessageModule, TopicForm],
  template: `
    <section class="mx-auto max-w-3xl px-4 py-12 md:py-16">
      <a
        [routerLink]="['/', lang(), 'forum']"
        class="inline-flex items-center gap-2 text-sm text-surface-600 no-underline hover:text-primary dark:text-surface-300"
      >
        <i class="pi pi-arrow-left text-xs" aria-hidden="true"></i>
        {{ 'forum.topic.back' | transloco }}
      </a>
      <h1 class="mt-6 mb-0 text-3xl font-bold">{{ 'forum.form.newTitle' | transloco }}</h1>
      <p class="mt-3 mb-8 text-surface-600 dark:text-surface-300">{{ 'forum.form.newSubtitle' | transloco }}</p>

      @if (!enabled) {
        <p-message severity="info" [text]="'community.unavailable' | transloco" />
      } @else if (auth.ready() && auth.needsSetup()) {
        <p class="m-0 text-surface-600 dark:text-surface-300">
          {{ 'forum.form.setup' | transloco }}
          <a [routerLink]="['/', lang(), 'account']" class="text-primary underline underline-offset-2">{{
            'community.comments.setupLink' | transloco
          }}</a>
        </p>
      } @else {
        <app-topic-form [initial]="initial()" [busy]="busy()" [error]="error()" (submitted)="create($event)" />
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewTopic {
  protected readonly auth = inject(AuthService);
  private readonly community = inject(CommunityService);
  private readonly router = inject(Router);
  private readonly messages = inject(MessageService);
  private readonly transloco = inject(TranslocoService);

  readonly lang = input.required<Lang>();
  /** ?profile=<id>: o perfil de onde a pessoa veio. */
  readonly profile = input<string>();

  protected readonly enabled = COMMUNITY_ENABLED;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly fromProfile = resource({
    params: () => {
      const id = this.profile();
      return this.enabled && id && /^[a-z0-9-]{1,32}$/.test(id) ? id : undefined;
    },
    loader: ({ params }) => this.community.get(params),
  });

  protected readonly initial = computed<TopicFormValue | null>(() => {
    const detail = this.fromProfile.value();
    return detail
      ? { title: '', body: '', tags: [], profiles: [{ id: detail.community.id, name: detail.profile.name }] }
      : null;
  });

  protected async create(input: TopicInput): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const { id, slug } = await this.community.createTopic(input);
      this.messages.add({ severity: 'success', summary: this.transloco.translate('forum.form.created'), life: 2500 });
      await this.router.navigate(['/', this.lang(), 'forum', id, slug]);
    } catch (error) {
      this.error.set(authErrorKey(error));
    } finally {
      this.busy.set(false);
    }
  }
}
