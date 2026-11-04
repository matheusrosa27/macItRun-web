import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ButtonModule } from 'primeng/button';
import { Vote } from '../../core/community/community';

/**
 * Curtir e não curtir, com os totais. Clicar no voto que já está marcado tira o voto. Quem usa
 * trata o clique (login, atualização na hora e chamada ao banco).
 */
@Component({
  selector: 'app-vote-buttons',
  imports: [TranslocoPipe, ButtonModule],
  template: `
    <span class="inline-flex items-center gap-1" role="group" [attr.aria-label]="'forum.votes.label' | transloco">
      <p-button
        [icon]="vote() === 1 ? 'pi pi-thumbs-up-fill' : 'pi pi-thumbs-up'"
        [label]="likes() + ''"
        [severity]="vote() === 1 ? 'primary' : 'secondary'"
        [text]="vote() !== 1"
        [outlined]="vote() === 1"
        [size]="size()"
        [disabled]="busy()"
        [ariaLabel]="(vote() === 1 ? 'forum.votes.liked' : 'forum.votes.like') | transloco: { count: likes() }"
        [attr.aria-pressed]="vote() === 1"
        (onClick)="voted.emit(vote() === 1 ? 0 : 1)"
      />
      <p-button
        [icon]="vote() === -1 ? 'pi pi-thumbs-down-fill' : 'pi pi-thumbs-down'"
        [label]="dislikes() + ''"
        [severity]="vote() === -1 ? 'danger' : 'secondary'"
        [text]="vote() !== -1"
        [outlined]="vote() === -1"
        [size]="size()"
        [disabled]="busy()"
        [ariaLabel]="(vote() === -1 ? 'forum.votes.disliked' : 'forum.votes.dislike') | transloco: { count: dislikes() }"
        [attr.aria-pressed]="vote() === -1"
        (onClick)="voted.emit(vote() === -1 ? 0 : -1)"
      />
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VoteButtons {
  readonly likes = input.required<number>();
  readonly dislikes = input.required<number>();
  readonly vote = input<Vote>(0);
  readonly busy = input(false);
  readonly size = input<'small' | 'large' | undefined>('small');
  /** O voto novo: 1, -1 ou 0 (tirar). */
  readonly voted = output<Vote>();
}
