import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AutoCompleteCompleteEvent, AutoCompleteModule, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { PaginatorModule, PaginatorState } from 'primeng/paginator';
import { SelectModule } from 'primeng/select';
import { SkeletonModule } from 'primeng/skeleton';
import {
  COMMUNITY_ENABLED,
  GRAPHICS,
  ListParams,
  PAGE_SIZE,
  ProfileSummary,
  SORTS,
  WINDOWS_VERSIONS,
} from '../../core/community/community';
import { CommunityService } from '../../core/community/community.service';
import { macName } from '../../core/community/macs';
import { Lang } from '../../core/i18n/langs';
import { ProfileCard } from './profile-card';

/** Valor aceito de um parâmetro da URL, ou undefined. */
const oneOf = (value: string | undefined, allowed: readonly string[]) =>
  value && allowed.includes(value) ? value : undefined;

/**
 * Lista da Comunidade. Busca, filtros, ordem e página ficam na URL (?q=&graphics=…), então a
 * página renderiza no servidor e pode ser compartilhada.
 */
@Component({
  selector: 'app-community',
  imports: [
    FormsModule,
    RouterLink,
    TranslocoPipe,
    AutoCompleteModule,
    ButtonModule,
    MessageModule,
    PaginatorModule,
    SelectModule,
    SkeletonModule,
    ProfileCard,
  ],
  templateUrl: './community.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Community {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly community = inject(CommunityService);

  readonly lang = input.required<Lang>();
  // Parâmetros da URL (?q=&graphics=&windowsVersion=&mac=&sort=&page=).
  readonly q = input<string>();
  readonly graphics = input<string>();
  readonly windowsVersion = input<string>();
  readonly mac = input<string>();
  readonly sort = input<string>();
  readonly page = input<string>();

  protected readonly enabled = COMMUNITY_ENABLED;
  protected readonly pageSize = PAGE_SIZE;
  protected readonly graphicsOptions = [...GRAPHICS];
  protected readonly windowsOptions = [...WINDOWS_VERSIONS];
  protected readonly sortOptions = [...SORTS];

  protected readonly params = computed<ListParams>(() => ({
    q: this.q()?.trim().slice(0, 100) || undefined,
    graphics: oneOf(this.graphics(), GRAPHICS),
    windowsVersion: oneOf(this.windowsVersion(), WINDOWS_VERSIONS),
    mac: this.mac()?.slice(0, 64) || undefined,
    sort: oneOf(this.sort(), SORTS) ?? 'likes',
    page: Math.min(Math.max(Number.parseInt(this.page() ?? '1', 10) || 1, 1), 1000),
  }));

  protected readonly results = resource({
    params: () => (this.enabled ? this.params() : undefined),
    loader: ({ params }) => this.community.list(params),
  });

  protected readonly macs = resource({
    params: () => (this.enabled ? true : undefined),
    // Nome do Mac na lista, identificador na URL.
    loader: () =>
      this.community
        .filters()
        .then((f) =>
          f.macs.map((value) => ({ value, label: macName(value) })).sort((a, b) => a.label.localeCompare(b.label)),
        ),
  });

  protected readonly filtered = computed(() => {
    const { q, graphics, windowsVersion, mac } = this.params();
    return Boolean(q || graphics || windowsVersion || mac);
  });

  /** O texto da busca (ou o perfil escolhido nas sugestões); acompanha a URL. */
  protected readonly query = linkedSignal<string | ProfileSummary | null>(() => this.params().q ?? '');
  protected readonly suggestions = signal<ProfileSummary[]>([]);

  constructor() {
    // Página além da última (ex.: depois de filtrar): volta para a primeira.
    effect(() => {
      const page = this.results.value();
      if (page && page.items.length === 0 && page.total > 0 && page.page > 1) this.navigate({ page: undefined });
    });
  }

  protected async suggest(event: AutoCompleteCompleteEvent): Promise<void> {
    try {
      const page = await this.community.list({ q: event.query, sort: 'likes' });
      this.suggestions.set(page.items.slice(0, 8));
    } catch {
      this.suggestions.set([]);
    }
  }

  protected openSuggestion(event: AutoCompleteSelectEvent): void {
    const profile = event.value as ProfileSummary;
    void this.router.navigate(['/', this.lang(), 'community', profile.id, profile.slug]);
  }

  protected search(): void {
    // O AutoComplete devolve texto, o perfil escolhido ou null (campo limpo).
    const value = this.query();
    const q = typeof value === 'string' ? value.trim() : (value?.name ?? '');
    this.navigate({ q: q || undefined, page: undefined });
  }

  protected setFilter(key: 'graphics' | 'windowsVersion' | 'mac' | 'sort', value: string | null): void {
    this.navigate({ [key]: value || undefined, page: undefined });
  }

  protected clearFilters(): void {
    this.query.set('');
    this.navigate({ q: undefined, graphics: undefined, windowsVersion: undefined, mac: undefined, page: undefined });
  }

  protected changePage(event: PaginatorState): void {
    const page = (event.page ?? 0) + 1;
    this.navigate({ page: page > 1 ? page : undefined });
  }

  private navigate(changes: Record<string, string | number | undefined>): void {
    const queryParams = { ...this.params(), ...changes };
    // Os valores padrão (ordem por curtidas, página 1) ficam fora da URL.
    if (queryParams.sort === 'likes') queryParams.sort = undefined;
    if (queryParams.page === 1) queryParams.page = undefined;
    void this.router.navigate([], { relativeTo: this.route, queryParams });
  }
}
