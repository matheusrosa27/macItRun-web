import { ChangeDetectionStrategy, Component, computed, effect, inject, input, linkedSignal, resource } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { PaginatorModule, PaginatorState } from 'primeng/paginator';
import { SelectModule } from 'primeng/select';
import { SkeletonModule } from 'primeng/skeleton';
import {
  cleanTag,
  COMMUNITY_ENABLED,
  PAGE_SIZE,
  TOPIC_SORTS,
  TopicListParams,
} from '../../core/community/community';
import { CommunityService } from '../../core/community/community.service';
import { Lang } from '../../core/i18n/langs';
import { TopicCard } from './topic-card';

/**
 * Lista do fórum. Busca, tag, perfil citado, ordem e página ficam na URL (?q=&tag=…), então a
 * página renderiza no servidor, cada tag tem um endereço próprio e tudo pode ser compartilhado.
 */
@Component({
  selector: 'app-forum',
  imports: [
    FormsModule,
    RouterLink,
    TranslocoPipe,
    ButtonModule,
    InputTextModule,
    MessageModule,
    PaginatorModule,
    SelectModule,
    SkeletonModule,
    TopicCard,
  ],
  templateUrl: './forum.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Forum {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly community = inject(CommunityService);

  readonly lang = input.required<Lang>();
  // Parâmetros da URL (?q=&tag=&profile=&sort=&page=).
  readonly q = input<string>();
  readonly tag = input<string>();
  readonly profile = input<string>();
  readonly sort = input<string>();
  readonly page = input<string>();

  protected readonly enabled = COMMUNITY_ENABLED;
  protected readonly pageSize = PAGE_SIZE;
  protected readonly sortOptions = [...TOPIC_SORTS];

  protected readonly params = computed<TopicListParams>(() => {
    const sort = this.sort();
    const profile = this.profile();
    return {
      q: this.q()?.trim().slice(0, 100) || undefined,
      tag: cleanTag(this.tag()?.slice(0, 60) ?? '') || undefined,
      profile: profile && /^[a-z0-9-]{1,32}$/.test(profile) ? profile : undefined,
      sort: sort && (TOPIC_SORTS as readonly string[]).includes(sort) ? sort : 'activity',
      page: Math.min(Math.max(Number.parseInt(this.page() ?? '1', 10) || 1, 1), 1000),
    };
  });

  protected readonly results = resource({
    params: () => (this.enabled ? this.params() : undefined),
    loader: ({ params }) => this.community.topics(params),
  });

  protected readonly tags = resource({
    params: () => (this.enabled ? true : undefined),
    loader: () => this.community.topicTags(),
  });

  /** Nome do perfil filtrado (?profile=), para o aviso acima da lista. */
  protected readonly profileFilter = resource({
    params: () => (this.enabled ? this.params().profile : undefined),
    loader: ({ params }) => this.community.get(params),
  });

  /** A tag escolhida, quando ela não está entre as mais usadas (para aparecer mesmo assim). */
  protected readonly unlistedTag = computed(() => {
    const tag = this.params().tag;
    return tag && !(this.tags.value() ?? []).some((t) => t.tag === tag) ? tag : null;
  });

  protected readonly filtered = computed(() => {
    const { q, tag, profile } = this.params();
    return Boolean(q || tag || profile);
  });

  /** O texto da busca; acompanha a URL. */
  protected readonly query = linkedSignal(() => this.params().q ?? '');

  constructor() {
    // Página além da última (ex.: depois de filtrar): volta para a primeira.
    effect(() => {
      const page = this.results.value();
      if (page && page.items.length === 0 && page.total > 0 && page.page > 1) this.navigate({ page: undefined });
    });
  }

  protected search(): void {
    this.navigate({ q: this.query().trim() || undefined, page: undefined });
  }

  protected setSort(value: string | null): void {
    this.navigate({ sort: value || undefined, page: undefined });
  }

  /** Link de cada tag: liga se não está escolhida, desliga se está. */
  protected tagParams(tag: string): Record<string, string | number | undefined> {
    return this.cleanParams({ ...this.params(), tag: this.params().tag === tag ? undefined : tag, page: undefined });
  }

  protected clearFilters(): void {
    this.query.set('');
    this.navigate({ q: undefined, tag: undefined, profile: undefined, page: undefined });
  }

  protected clearProfile(): void {
    this.navigate({ profile: undefined, page: undefined });
  }

  protected changePage(event: PaginatorState): void {
    const page = (event.page ?? 0) + 1;
    this.navigate({ page: page > 1 ? page : undefined });
  }

  private navigate(changes: Record<string, string | number | undefined>): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: this.cleanParams({ ...this.params(), ...changes }) });
  }

  /** Os valores padrão (ordem por atividade, página 1) ficam fora da URL. */
  private cleanParams(params: Record<string, string | number | undefined>): Record<string, string | number | undefined> {
    return { ...params, sort: params['sort'] === 'activity' ? undefined : params['sort'], page: params['page'] === 1 ? undefined : params['page'] };
  }
}
