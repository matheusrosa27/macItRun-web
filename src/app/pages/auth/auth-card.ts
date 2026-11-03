import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { MessageModule } from 'primeng/message';
import { ACCOUNTS_ENABLED } from '../../core/auth/auth.service';

/**
 * Moldura das páginas de conta: título, subtítulo e um cartão. Sem Supabase configurado,
 * mostra o aviso de contas indisponíveis no lugar do formulário.
 */
@Component({
  selector: 'app-auth-card',
  imports: [TranslocoPipe, MessageModule],
  template: `
    <section class="mx-auto px-4 py-12 md:py-16" [class]="wide() ? 'max-w-2xl' : 'max-w-md'">
      <h1 class="m-0 text-3xl font-bold">{{ title() }}</h1>
      @if (subtitle()) {
        <p class="mt-2 mb-0 text-surface-600 dark:text-surface-400">{{ subtitle() }}</p>
      }
      <div class="mt-8 flex flex-col gap-6">
        @if (enabled) {
          <ng-content />
        } @else {
          <p-message severity="warn" [text]="'auth.unavailable' | transloco" />
        }
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthCard {
  readonly title = input.required<string>();
  readonly subtitle = input<string>();
  readonly wide = input(false);
  protected readonly enabled = ACCOUNTS_ENABLED;
}
