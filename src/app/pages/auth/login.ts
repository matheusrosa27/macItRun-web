import { ChangeDetectionStrategy, Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ButtonModule } from 'primeng/button';
import { DividerModule } from 'primeng/divider';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { PasswordModule } from 'primeng/password';
import { authErrorKey } from '../../core/auth/auth-errors';
import { safeNext } from '../../core/auth/auth.guards';
import { AuthService } from '../../core/auth/auth.service';
import { Lang } from '../../core/i18n/langs';
import { CAPTCHA_ENABLED, Turnstile } from '../../shared/turnstile';
import { AuthCard } from './auth-card';
import { OAuthButtons } from './oauth-buttons';

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslocoPipe,
    ButtonModule,
    DividerModule,
    InputTextModule,
    MessageModule,
    PasswordModule,
    AuthCard,
    OAuthButtons,
    Turnstile,
  ],
  templateUrl: './login.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly lang = input.required<Lang>();
  /** ?next=: para onde voltar depois de entrar. */
  readonly next = input<string>();

  /** Destino depois de entrar, sem o idioma (os botões do Google e do GitHub usam assim). */
  protected readonly target = computed(() => safeNext(this.next(), this.lang()));
  protected readonly oauthNext = computed(() => this.target().slice(this.lang().length + 2));

  private readonly captcha = viewChild(Turnstile);
  protected readonly captchaEnabled = CAPTCHA_ENABLED;
  protected readonly captchaToken = signal<string | null>(null);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  protected readonly submitting = signal(false);
  /** Link de e-mail vencido ou já usado: a pessoa chega aqui vinda de /account. */
  protected readonly error = signal<string | null>(
    this.auth.arrivalError ? 'auth.errors.link_expired' : null,
  );

  protected async submit(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid || (this.captchaEnabled && !this.captchaToken())) return;

    this.error.set(null);
    this.submitting.set(true);
    try {
      await this.auth.signIn({
        ...this.form.getRawValue(),
        captchaToken: this.captchaToken() ?? undefined,
      });
      await this.router.navigateByUrl(this.target());
    } catch (error) {
      this.error.set(authErrorKey(error));
      this.captcha()?.reset();
    } finally {
      this.submitting.set(false);
    }
  }
}
