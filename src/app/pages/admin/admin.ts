import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { SkeletonModule } from 'primeng/skeleton';
import { TabsModule } from 'primeng/tabs';
import { TagModule } from 'primeng/tag';
import { authErrorKey } from '../../core/auth/auth-errors';
import { AuthService } from '../../core/auth/auth.service';
import { CommunityService } from '../../core/community/community.service';
import { HTML_LANG, Lang } from '../../core/i18n/langs';
import { AdminProfileDialog } from '../community/admin-profile-dialog';

interface ModerationTarget {
  /** Perfis e comentários. */
  profileId?: string;
  /** Tópicos e respostas do fórum. */
  topicId?: string;
  slug: string;
  name: string;
  /** Só em comentários. */
  body?: string;
  status: string;
  author: { id: string; username: string | null; banned: boolean } | null;
}

type TargetType = 'profile' | 'comment' | 'topic' | 'reply';

interface OpenReport {
  targetType: TargetType;
  targetId: string;
  count: number;
  reports: { reason: string; detail: string; reporter: string | null; createdAt: string }[];
  target: ModerationTarget | null;
}

interface HiddenItem {
  targetType: TargetType;
  targetId: string;
  target: ModerationTarget | null;
}

/**
 * Moderação: denúncias abertas (esconder ou manter), itens escondidos (restaurar) e banir.
 * Cada ação passa por uma função do banco que confere se quem chama é admin.
 */
@Component({
  selector: 'app-admin',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    TranslocoPipe,
    ButtonModule,
    MessageModule,
    SkeletonModule,
    TabsModule,
    TagModule,
    AdminProfileDialog,
  ],
  templateUrl: './admin.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Admin {
  private readonly auth = inject(AuthService);
  private readonly community = inject(CommunityService);
  private readonly messages = inject(MessageService);
  private readonly transloco = inject(TranslocoService);

  readonly lang = input.required<Lang>();

  protected readonly reports = resource({ loader: () => this.auth.rpc<OpenReport[]>('admin_open_reports') });
  protected readonly hidden = resource({ loader: () => this.auth.rpc<HiddenItem[]>('admin_hidden_items') });
  protected readonly openCount = computed(() => this.reports.value()?.length ?? 0);
  /** Item em ação (para o "carregando" do botão certo). */
  protected readonly busy = signal<string | null>(null);
  /** Perfil aberto no diálogo de edição. */
  protected readonly editing = signal<string | null>(null);
  protected readonly editOpen = signal(false);

  protected edit(item: OpenReport | HiddenItem): void {
    const id = item.target?.profileId;
    if (!id) return;
    this.editing.set(id);
    this.editOpen.set(true);
  }

  protected reload(): void {
    this.reports.reload();
    this.hidden.reload();
  }

  /** Apaga de vez um comentário, tópico ou resposta (o perfil, pelo diálogo de edição). */
  protected async deleteItem(item: OpenReport | HiddenItem): Promise<void> {
    const id = item.targetId;
    const action =
      item.targetType === 'topic'
        ? () => this.community.adminDeleteTopic(id)
        : item.targetType === 'reply'
          ? () => this.community.adminDeleteReply(Number(id))
          : () => this.community.adminDeleteComment(Number(id));
    await this.run(this.key(item, 'delete'), 'adminEdit.deleted', action);
  }

  /** Rótulo do item ("Perfil de configuração", "Resposta em …"). */
  protected targetLabel(type: TargetType): string {
    return { profile: 'admin.profile', comment: 'admin.comment', topic: 'admin.topic', reply: 'admin.reply' }[type];
  }

  protected deleteLabel(type: TargetType): string {
    return type === 'topic' ? 'admin.deleteTopic' : type === 'reply' ? 'admin.deleteReply' : 'adminEdit.deleteComment';
  }

  /** Link para o item: o perfil, ou o tópico do fórum. */
  protected targetLink(target: ModerationTarget): string[] {
    return target.topicId
      ? ['/', this.lang(), 'forum', target.topicId, target.slug]
      : ['/', this.lang(), 'community', target.profileId ?? '', target.slug];
  }

  protected key(item: { targetType: string; targetId: string }, action: string): string {
    return `${item.targetType}:${item.targetId}:${action}`;
  }

  protected date(value: string): string {
    return new Intl.DateTimeFormat(HTML_LANG[this.lang()], { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(value),
    );
  }

  protected async moderate(item: OpenReport | HiddenItem, hide: boolean): Promise<void> {
    await this.run(this.key(item, hide ? 'hide' : 'keep'), 'admin.done', () =>
      this.auth.rpc('admin_moderate', { target_type: item.targetType, target_id: item.targetId, hide }),
    );
  }

  protected async setBanned(item: OpenReport | HiddenItem, banned: boolean): Promise<void> {
    const author = item.target?.author;
    if (!author) return;
    await this.run(this.key(item, 'ban'), banned ? 'admin.bannedDone' : 'admin.unbannedDone', () =>
      this.auth.rpc('admin_set_banned', { user_id: author.id, banned }),
    );
  }

  private async run(key: string, doneKey: string, action: () => Promise<unknown>): Promise<void> {
    this.busy.set(key);
    try {
      await action();
      this.messages.add({ severity: 'success', summary: this.transloco.translate(doneKey), life: 2500 });
      this.reports.reload();
      this.hidden.reload();
    } catch (error) {
      this.messages.add({ severity: 'error', summary: this.transloco.translate(authErrorKey(error)), life: 4000 });
    } finally {
      this.busy.set(null);
    }
  }
}
