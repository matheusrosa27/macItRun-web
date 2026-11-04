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
  Author,
  COMMUNITY_ENABLED,
  REPLY_MAX,
  ReportTarget,
  TopicDetail,
  TopicInput,
  TopicReply,
} from '../../core/community/community';
import { CommunityService } from '../../core/community/community.service';
import { Lang } from '../../core/i18n/langs';
import { SeoService } from '../../core/seo.service';
import { SITE_URL } from '../../core/site';
import { AuthorName } from '../community/author';
import { ReportDialog } from '../community/report-dialog';
import { forumDate, forumDateTime } from './dates';
import { TopicForm, TopicFormValue } from './topic-form';

/**
 * Um tópico do fórum: o texto, os perfis de configuração citados e as respostas, em ordem.
 * O autor edita e apaga; os outros respondem e denunciam. Todo texto vindo de usuário sai como
 * texto puro.
 */
@Component({
  selector: 'app-topic-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslocoPipe,
    ButtonModule,
    MessageModule,
    SkeletonModule,
    TagModule,
    TextareaModule,
    AuthorName,
    ReportDialog,
    TopicForm,
  ],
  templateUrl: './topic.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopicPage {
  protected readonly auth = inject(AuthService);
  private readonly community = inject(CommunityService);
  private readonly router = inject(Router);
  private readonly seo = inject(SeoService);
  private readonly transloco = inject(TranslocoService);
  private readonly messages = inject(MessageService);
  private readonly responseInit = inject(RESPONSE_INIT, { optional: true });
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly lang = input.required<Lang>();
  readonly id = input.required<string>();

  protected readonly enabled = COMMUNITY_ENABLED;
  protected readonly replyMax = REPLY_MAX;

  protected readonly data = resource({
    params: () => (this.enabled ? this.id() : undefined),
    loader: ({ params }) => this.community.topic(params),
  });
  /** O tópico, já com o que a pessoa editou (sem esperar a CDN). */
  protected readonly topic = linkedSignal<TopicDetail | null | undefined>(() => this.data.value());

  /** O primeiro lote de respostas vem com a página; os seguintes, ao pedir mais. */
  private readonly firstReplies = resource({
    params: () => (this.enabled ? this.id() : undefined),
    loader: ({ params }) => this.community.replies(params, 1),
  });
  protected readonly repliesError = computed(() => !!this.firstReplies.error());
  protected readonly replies = linkedSignal<TopicReply[]>(() => this.firstReplies.value()?.items ?? []);
  protected readonly repliesTotal = linkedSignal(() => this.firstReplies.value()?.total ?? 0);
  private readonly repliesPage = linkedSignal<number>(() => (this.firstReplies.value() ? 1 : 0));
  protected readonly loadingMore = signal(false);
  /** Respostas lidas de novo no navegador (a página pode ter vindo da CDN, até 1 minuto atrás). */
  protected readonly repliesReady = signal(false);

  protected readonly replyForm = inject(FormBuilder).nonNullable.group({
    body: ['', [Validators.required, Validators.maxLength(REPLY_MAX), Validators.pattern(/\S/)]],
  });
  protected readonly replyLength = signal(0);
  protected readonly posting = signal(false);
  protected readonly replyError = signal<string | null>(null);
  protected readonly deleting = signal<number | null>(null);

  protected readonly isAdmin = computed(() => this.auth.account()?.role === 'admin');
  protected readonly isMine = computed(() => this.ownedBy(this.topic()?.author));

  protected readonly editing = signal(false);
  protected readonly saving = signal(false);
  protected readonly editError = signal<string | null>(null);
  protected readonly editValue = computed<TopicFormValue | null>(() => {
    const t = this.topic();
    return t
      ? { title: t.title, body: t.body, tags: t.tags, profiles: t.profiles.map((p) => ({ id: p.id, name: p.name })) }
      : null;
  });
  /** Apagar pede um segundo clique. */
  protected readonly confirmDelete = signal(false);
  protected readonly removing = signal(false);

  protected readonly reportTarget = signal<ReportTarget | null>(null);
  protected readonly reportOpen = signal(false);

  constructor() {
    // Título, descrição e dados estruturados de discussão; 404 se o tópico não existe.
    effect(() => {
      if (this.data.isLoading()) return;
      const topic = this.topic();
      const lang = this.lang();
      if (topic) {
        const excerpt = topic.body.replace(/\s+/g, ' ').trim();
        this.seo.setPageText(topic.title, excerpt.length > 160 ? `${excerpt.slice(0, 157)}…` : excerpt);
        this.seo.setJsonLd([
          this.seo.breadcrumbs(lang, [
            { name: this.transloco.translate('app.name', {}, lang), path: '' },
            { name: this.transloco.translate('forum.title', {}, lang), path: 'forum' },
            { name: topic.title },
          ]),
          this.postingJsonLd(topic, lang, this.firstReplies.value()?.items ?? []),
        ]);
      } else if (this.data.value() === null) {
        this.seo.setNoindex();
        this.seo.setJsonLd(null);
        if (this.responseInit) this.responseInit.status = 404;
      }
    });

    effect(() => {
      const id = this.topic()?.id;
      if (this.browser && id) untracked(() => void this.refreshLive(id));
    });

    this.replyForm.controls.body.valueChanges.subscribe((value) => this.replyLength.set(value.length));
  }

  private async refreshLive(id: string): Promise<void> {
    this.repliesReady.set(false);
    try {
      const fresh = await this.community.replies(id, 1, true);
      if (fresh && id === this.topic()?.id) {
        const known = new Set(fresh.items.map((r) => r.id));
        const later = this.repliesPage() > 1 ? this.replies().filter((r) => !known.has(r.id)) : [];
        this.replies.set([...fresh.items, ...later]);
        this.repliesTotal.set(fresh.total);
      }
    } catch {
      // Fica o que veio com a página.
    } finally {
      if (id === this.topic()?.id) this.repliesReady.set(true);
    }
  }

  /** schema.org DiscussionForumPosting: como o Google reconhece uma discussão de fórum. */
  private postingJsonLd(topic: TopicDetail, lang: Lang, replies: TopicReply[]): object {
    const person = (author: Author | null) => ({
      '@type': 'Person',
      name: author?.username ?? this.transloco.translate('community.card.deletedAuthor', {}, lang),
    });
    return {
      '@context': 'https://schema.org',
      '@type': 'DiscussionForumPosting',
      headline: topic.title,
      text: topic.body,
      url: `${SITE_URL}/${lang}/forum/${topic.id}/${topic.slug}`,
      datePublished: topic.createdAt,
      ...(topic.editedAt ? { dateModified: topic.editedAt } : {}),
      author: person(topic.author),
      ...(topic.tags.length ? { keywords: topic.tags.join(', ') } : {}),
      interactionStatistic: {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/CommentAction',
        userInteractionCount: topic.replies,
      },
      comment: replies.map((reply) => ({
        '@type': 'Comment',
        text: reply.body,
        datePublished: reply.createdAt,
        author: person(reply.author),
      })),
    };
  }

  protected date(value: string): string {
    return forumDate(this.lang(), value);
  }

  protected dateTime(value: string): string {
    return forumDateTime(this.lang(), value);
  }

  protected ownedBy(author: Author | null | undefined): boolean {
    const me = this.auth.account()?.username;
    return !!me && author?.username === me;
  }

  protected async goToLogin(): Promise<void> {
    await this.router.navigate(['/', this.lang(), 'login'], { queryParams: { next: this.router.url } });
  }

  /** Denunciar pede login e conta completa. */
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

  protected async save(input: TopicInput): Promise<void> {
    const current = this.topic();
    if (!current) return;
    this.saving.set(true);
    this.editError.set(null);
    try {
      const { slug } = await this.community.updateTopic(current.id, input);
      const fresh = await this.community.topic(current.id, true);
      if (fresh) this.topic.set(fresh);
      this.editing.set(false);
      this.messages.add({ severity: 'success', summary: this.transloco.translate('forum.topic.saved'), life: 2500 });
      if (slug !== current.slug) {
        await this.router.navigate(['/', this.lang(), 'forum', current.id, slug], { replaceUrl: true });
      }
    } catch (error) {
      this.editError.set(authErrorKey(error));
    } finally {
      this.saving.set(false);
    }
  }

  /** O autor apaga o próprio tópico; o admin, qualquer um. */
  protected async remove(): Promise<void> {
    const current = this.topic();
    if (!current) return;
    if (!this.confirmDelete()) {
      this.confirmDelete.set(true);
      return;
    }
    this.removing.set(true);
    try {
      await (this.isMine() ? this.community.deleteTopic(current.id) : this.community.adminDeleteTopic(current.id));
      this.messages.add({ severity: 'success', summary: this.transloco.translate('forum.topic.deleted'), life: 2500 });
      await this.router.navigate(['/', this.lang(), 'forum']);
    } catch (error) {
      this.toastError(error);
    } finally {
      this.removing.set(false);
      this.confirmDelete.set(false);
    }
  }

  protected async postReply(): Promise<void> {
    this.replyForm.markAllAsTouched();
    if (this.replyForm.invalid) return;
    this.replyError.set(null);
    this.posting.set(true);
    try {
      const created = await this.community.addReply(this.id(), this.replyForm.getRawValue().body);
      this.replies.update((list) => [...list, created]);
      this.repliesTotal.update((n) => n + 1);
      this.replyForm.reset();
      this.messages.add({ severity: 'success', summary: this.transloco.translate('forum.replies.posted'), life: 2500 });
    } catch (error) {
      this.replyError.set(authErrorKey(error));
    } finally {
      this.posting.set(false);
    }
  }

  /** O autor apaga a própria resposta; o admin, a de qualquer pessoa. */
  protected async deleteReply(reply: TopicReply): Promise<void> {
    this.deleting.set(reply.id);
    try {
      await (this.ownedBy(reply.author)
        ? this.community.deleteReply(reply.id)
        : this.community.adminDeleteReply(reply.id));
      this.replies.update((list) => list.filter((r) => r.id !== reply.id));
      this.repliesTotal.update((n) => Math.max(0, n - 1));
      this.messages.add({ severity: 'success', summary: this.transloco.translate('forum.replies.deleted'), life: 2500 });
    } catch (error) {
      this.toastError(error);
    } finally {
      this.deleting.set(null);
    }
  }

  protected async loadMore(): Promise<void> {
    this.loadingMore.set(true);
    try {
      const next = await this.community.replies(this.id(), this.repliesPage() + 1);
      if (next) {
        const known = new Set(this.replies().map((r) => r.id));
        this.replies.update((list) => [...list, ...next.items.filter((r) => !known.has(r.id))]);
        this.repliesTotal.set(next.total);
        this.repliesPage.set(next.page);
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
