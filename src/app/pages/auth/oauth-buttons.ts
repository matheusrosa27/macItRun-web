import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { authErrorKey } from '../../core/auth/auth-errors';
import { AuthService, OAUTH_PROVIDERS, OAuthProvider } from '../../core/auth/auth.service';
import { Lang } from '../../core/i18n/langs';

/**
 * Guardado ao sair do cadastro já com os termos aceitos, para a página da conta marcar o
 * aceite sem perguntar de novo (a pessoa ainda confirma ao salvar o nome de usuário).
 */
export const TERMS_ACCEPTED_FLAG = 'macitrun.termsAccepted';

/** Botões "Continuar com Google/GitHub". Saem do site e voltam para `next`. */
@Component({
  selector: 'app-oauth-buttons',
  imports: [TranslocoPipe, ButtonModule, MessageModule],
  template: `
    <div class="flex flex-col gap-3">
      @for (provider of providers; track provider) {
        <p-button
          [label]="'auth.oauth.' + provider | transloco"
          [icon]="'pi pi-' + provider"
          severity="secondary"
          [outlined]="true"
          [fluid]="true"
          [disabled]="disabled() || !!leaving()"
          [loading]="leaving() === provider"
          (onClick)="go(provider)"
        />
      }
      @if (error()) {
        <p-message severity="error" [text]="error()! | transloco" />
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OAuthButtons {
  private readonly auth = inject(AuthService);

  readonly lang = input.required<Lang>();
  readonly next = input('account');
  readonly disabled = input(false);
  /** O cadastro já tem os termos aceitos. */
  readonly termsAccepted = input(false);

  protected readonly providers = OAUTH_PROVIDERS;
  protected readonly leaving = signal<OAuthProvider | null>(null);
  protected readonly error = signal<string | null>(null);

  protected async go(provider: OAuthProvider): Promise<void> {
    this.error.set(null);
    this.leaving.set(provider);
    if (this.termsAccepted()) {
      try {
        sessionStorage.setItem(TERMS_ACCEPTED_FLAG, '1');
      } catch {
        // Sem sessionStorage a conta só pergunta de novo.
      }
    }
    try {
      await this.auth.signInWithProvider(provider, this.lang(), this.next());
    } catch (error) {
      this.error.set(authErrorKey(error));
      this.leaving.set(null);
    }
  }
}
