import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  PLATFORM_ID,
  resource,
  RESPONSE_INIT,
  signal,
  untracked,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { authErrorKey } from '../../core/auth/auth-errors';
import { AuthService } from '../../core/auth/auth.service';
import {
  COMMUNITY_ENABLED,
  downloadUrl,
  importUrl,
  ProfileComment,
  ReportTarget,
} from '../../core/community/community';
import { CommunityService } from '../../core/community/community.service';
import { HTML_LANG, Lang } from '../../core/i18n/langs';
import { SeoService } from '../../core/seo.service';
import { SITE_URL } from '../../core/site';
import { AdminProfileDialog } from './admin-profile-dialog';
import { AuthorName } from './author';
import { ProfileChanges } from './profile-changes';
import { ReportDialog } from './report-dialog';
import { TopicCard } from '../forum/topic-card';

const COMMENT_MAX = 2000;

/**
 * Página de um perfil: o que ele muda, onde foi testado, abrir no app ou baixar, curtir e
 * comentar. Todo texto vindo de usuário (nome, notas, comentários) sai como texto puro.
 */
@Component({
  selector: 'app-profile-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslocoPipe,
    ButtonModule,
    MessageModule,
    SkeletonModule,
    TagModule,
    TextareaModule,
    ProfileChanges,
    ReportDialog,
    AuthorName,
    AdminProfileDialog,
    TopicCard,
  ],
  templateUrl: './profile.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePage {
  protected readonly auth = inject(AuthService);
  private readonly community = inject(CommunityService);
  private readonly router = inject(Router);
  private readonly seo = inject(SeoService);
  private readonly transloco = inject(TranslocoService);
  private readonly messages = inject(MessageService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly responseInit = inject(RESPONSE_INIT, { optional: true });
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly lang = input.required<Lang>();
  readonly id = input.required<string>();

  protected readonly enabled = COMMUNITY_ENABLED;
  protected readonly commentMax = COMMENT_MAX;

  protected readonly data = resource({
    params: () => (this.enabled ? this.id() : undefined),
    loader: ({ params }) => this.community.get(params),
  });
  protected readonly profile = computed(() => this.data.value()?.profile);
  protected readonly info = computed(() => this.data.value()?.community);

  /** Tópicos do fórum que citam este perfil (os 3 com atividade mais recente). */
  protected readonly discussions = resource({
    params: () => (this.enabled ? this.id() : undefined),
    loader: async ({ params }) => {
      const page = await this.community.topics({ profile: params, sort: 'activity' });
      return { items: page.items.slice(0, 3), total: page.total };
    },
  });

  /** O primeiro lote de comentários vem com a página; os seguintes, ao pedir mais. */
  private readonly firstComments = resource({
    params: () => (this.enabled ? this.id() : undefined),
    loader: ({ params }) => this.community.comments(params, 1),
  });
  protected readonly commentsError = computed(() => !!this.firstComments.error());
  protected readonly comments = linkedSignal<ProfileComment[]>(() => this.firstComments.value()?.items ?? []);
  protected readonly commentsTotal = linkedSignal(() => this.firstComments.value()?.total ?? 0);
  private readonly commentsPage = linkedSignal<number>(() => (this.firstComments.value() ? 1 : 0));
  protected readonly loadingMore = signal(false);

  protected readonly likes = linkedSignal(() => this.info()?.likes ?? 0);
  protected readonly liked = signal(false);
  /** Nos favoritos particulares da pessoa (separado da curtida). */
  protected readonly saved = signal(false);
  protected readonly saving = signal(false);
  protected readonly liking = signal(false);

  /**
   * Curtidas e comentários já lidos de novo no navegador. Até lá, o que veio com a página pode
   * estar atrasado (CDN), então o número e a lista ficam em "carregando" em vez de piscar.
   */
  private readonly fresh = signal(false);
  /** Já se sabe se a pessoa curtiu (ou que não há ninguém conectado). */
  private readonly likedKnown = signal(false);
  protected readonly likesReady = computed(() => this.fresh() && this.likedKnown());
  protected readonly commentsReady = this.fresh.asReadonly();

  protected readonly commentForm = inject(FormBuilder).nonNullable.group({
    body: ['', [Validators.required, Validators.maxLength(COMMENT_MAX), Validators.pattern(/\S/)]],
  });
  protected readonly commentLength = signal(0);
  protected readonly posting = signal(false);
  protected readonly commentError = signal<string | null>(null);
  protected readonly deleting = signal<number | null>(null);

  protected readonly isAdmin = computed(() => this.auth.account()?.role === 'admin');
  protected readonly adminEditOpen = signal(false);

  protected readonly reportTarget = signal<ReportTarget | null>(null);
  protected readonly reportOpen = signal(false);
  /** O perfil é da pessoa conectada (não tem por que denunciar). */
  protected readonly ownProfile = computed(() => {
    const me = this.auth.account()?.username;
    return !!me && this.info()?.author?.username === me;
  });

  /** Link macitrun:// (o Angular bloqueia esquemas desconhecidos sem esta liberação). */
  protected readonly openUrl = computed(() => this.sanitizer.bypassSecurityTrustUrl(importUrl(this.id())));
  protected readonly downloadUrl = computed(() => downloadUrl(this.id()));

  protected readonly published = computed(() => {
    const date = this.info()?.createdAt;
    return date ? new Intl.DateTimeFormat(HTML_LANG[this.lang()], { dateStyle: 'long' }).format(new Date(date)) : '';
  });

  constructor() {
    // Título e descrição com o nome do jogo; 404 se o perfil não existe.
    effect(() => {
      if (this.data.isLoading()) return;
      const profile = this.profile();
      if (profile) {
        const lang = this.lang();
        const t = (key: string) => this.transloco.translate(key, { name: profile.name }, lang);
        this.seo.setPageText(profile.name, t('community.profile.seoDescription'));
        this.seo.setJsonLd(
          this.seo.breadcrumbs(lang, [
            { name: t('app.name'), path: '' },
            { name: t('seo.community.title'), path: 'community' },
            { name: profile.name },
          ]),
        );
        // Imagem com o nome do jogo, gerada na Vercel (api/og.mjs).
        this.seo.setImage(`${SITE_URL}/og/profile/${encodeURIComponent(this.id())}?lang=${this.lang()}`, 1200, 630);
      } else if (this.data.value() === null) {
        this.seo.setNoindex();
        if (this.responseInit) this.responseInit.status = 404;
      }
    });

    // Se a pessoa conectada já curtiu (só no navegador, que é onde há sessão).
    effect(() => {
      const user = this.auth.user();
      const id = this.info()?.id;
      if (!this.browser || !id || !this.auth.ready()) return;
      if (!user) {
        this.liked.set(false);
        this.saved.set(false);
        this.likedKnown.set(true);
        return;
      }
      this.likedKnown.set(false);
      this.community
        .liked(id)
        .then(
          (liked) => this.liked.set(liked),
          () => this.liked.set(false),
        )
        .finally(() => this.likedKnown.set(true));
      this.community.saved(id).then(
        (saved) => this.saved.set(saved),
        () => this.saved.set(false),
      );
    });

    // A página pode ter vindo da CDN (até 1 minuto de atraso): no navegador, curtidas e
    // comentários são lidos de novo, para quem acabou de curtir ou comentar ver o que fez.
    effect(() => {
      const id = this.info()?.id;
      if (this.browser && id) untracked(() => void this.refreshLive(id));
    });

    this.commentForm.controls.body.valueChanges.subscribe((value) => this.commentLength.set(value.length));
  }

  private async refreshLive(id: string): Promise<void> {
    this.fresh.set(false);
    try {
      const [profile, comments] = await Promise.all([
        this.community.get(id, true),
        this.community.comments(id, 1, true),
      ]);
      if (id !== this.info()?.id) return;
      if (profile && !this.liking()) this.likes.set(profile.community.likes);
      if (comments) {
        // Mantém os comentários já carregados além da primeira página.
        const fresh = new Set(comments.items.map((c) => c.id));
        const later = this.comments().filter((c) => !fresh.has(c.id) && this.commentsPage() > 1);
        this.comments.set([...comments.items, ...later]);
        this.commentsTotal.set(comments.total);
      }
    } catch {
      // Fica o que veio com a página.
    } finally {
      if (id === this.info()?.id) this.fresh.set(true);
    }
  }

  protected commentDate(date: string): string {
    return new Intl.DateTimeFormat(HTML_LANG[this.lang()], { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(date),
    );
  }

  protected isMine(comment: ProfileComment): boolean {
    const me = this.auth.account()?.username;
    return !!me && comment.author?.username === me;
  }

  /** Para quem não está conectado, curtir leva ao login e volta para cá. */
  protected async toggleLike(): Promise<void> {
    if (!this.auth.user()) {
      await this.goToLogin();
      return;
    }
    if (this.auth.needsSetup()) {
      await this.router.navigate(['/', this.lang(), 'account']);
      return;
    }
    const next = !this.liked();
    this.liking.set(true);
    // Mostra na hora; o banco devolve o total certo.
    this.liked.set(next);
    this.likes.update((n) => Math.max(0, n + (next ? 1 : -1)));
    try {
      const result = await this.community.like(this.id(), next);
      this.liked.set(result.liked);
      this.likes.set(result.likes);
    } catch (error) {
      this.liked.set(!next);
      this.likes.update((n) => Math.max(0, n + (next ? -1 : 1)));
      this.toastError(error);
    } finally {
      this.liking.set(false);
    }
  }

  /** Depois da edição do admin: perfil publicado recarrega (o slug pode ter mudado). */
  protected async afterAdminSave(result: { id: string; slug: string; status: string }): Promise<void> {
    if (result.status !== 'published') {
      await this.router.navigate(['/', this.lang(), 'admin']);
      return;
    }
    await this.router.navigate(['/', this.lang(), 'community', result.id, result.slug], { replaceUrl: true });
    this.data.reload();
    void this.refreshLive(result.id);
  }

  protected async afterAdminDelete(): Promise<void> {
    await this.router.navigate(['/', this.lang(), 'community']);
  }

  protected async adminDeleteComment(comment: ProfileComment): Promise<void> {
    this.deleting.set(comment.id);
    try {
      await this.community.adminDeleteComment(comment.id);
      this.comments.update((list) => list.filter((c) => c.id !== comment.id));
      this.commentsTotal.update((n) => Math.max(0, n - 1));
      this.messages.add({ severity: 'success', summary: this.transloco.translate('community.comments.deleted'), life: 2500 });
    } catch (error) {
      this.toastError(error);
    } finally {
      this.deleting.set(null);
    }
  }

  /** Denunciar pede login e conta completa, como curtir e comentar. */
  protected async openReport(target: ReportTarget): Promise<void> {
    if (!this.auth.user()) {
      await this.goToLogin();
      return;
    }
    if (this.auth.needsSetup()) {
      await this.router.navigate(['/', this.lang(), 'account']);
      return;
    }
    this.reportTarget.set(target);
    this.reportOpen.set(true);
  }

  /** Salvar pede login e conta completa; tirar dos salvos, só login. */
  protected async toggleSave(): Promise<void> {
    if (!this.auth.user()) {
      await this.goToLogin();
      return;
    }
    const next = !this.saved();
    if (next && this.auth.needsSetup()) {
      await this.router.navigate(['/', this.lang(), 'account']);
      return;
    }
    this.saving.set(true);
    try {
      const result = await this.community.save(this.id(), next);
      this.saved.set(result.saved);
      this.messages.add({
        severity: 'success',
        summary: this.transloco.translate(result.saved ? 'saved.added' : 'saved.removed'),
        life: 2500,
      });
    } catch (error) {
      this.toastError(error);
    } finally {
      this.saving.set(false);
    }
  }

  protected async goToLogin(): Promise<void> {
    await this.router.navigate(['/', this.lang(), 'login'], { queryParams: { next: this.router.url } });
  }

  protected async postComment(): Promise<void> {
    this.commentForm.markAllAsTouched();
    if (this.commentForm.invalid) return;
    this.commentError.set(null);
    this.posting.set(true);
    try {
      const created = await this.community.addComment(this.id(), this.commentForm.getRawValue().body);
      this.comments.update((list) => [...list, created]);
      this.commentsTotal.update((n) => n + 1);
      this.commentForm.reset();
      this.messages.add({ severity: 'success', summary: this.transloco.translate('community.comments.posted'), life: 2500 });
    } catch (error) {
      this.commentError.set(authErrorKey(error));
    } finally {
      this.posting.set(false);
    }
  }

  protected async deleteComment(comment: ProfileComment): Promise<void> {
    this.deleting.set(comment.id);
    try {
      await this.community.deleteComment(comment.id);
      this.comments.update((list) => list.filter((c) => c.id !== comment.id));
      this.commentsTotal.update((n) => Math.max(0, n - 1));
      this.messages.add({ severity: 'success', summary: this.transloco.translate('community.comments.deleted'), life: 2500 });
    } catch (error) {
      this.toastError(error);
    } finally {
      this.deleting.set(null);
    }
  }

  protected async loadMore(): Promise<void> {
    this.loadingMore.set(true);
    try {
      const next = await this.community.comments(this.id(), this.commentsPage() + 1);
      if (next) {
        const known = new Set(this.comments().map((c) => c.id));
        this.comments.update((list) => [...list, ...next.items.filter((c) => !known.has(c.id))]);
        this.commentsTotal.set(next.total);
        this.commentsPage.set(next.page);
      }
    } catch (error) {
      this.toastError(error);
    } finally {
      this.loadingMore.set(false);
    }
  }

  private toastError(error: unknown): void {
    this.messages.add({ severity: 'error', summary: this.transloco.translate(authErrorKey(error)), life: 4000 });
  }
}
