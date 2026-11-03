import { ChangeDetectionStrategy, Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { PasswordModule } from 'primeng/password';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { authErrorKey } from '../../core/auth/auth-errors';
import { AuthService } from '../../core/auth/auth.service';
import { Lang } from '../../core/i18n/langs';
import { CAPTCHA_ENABLED, Turnstile } from '../../shared/turnstile';
import { AuthCard } from './auth-card';
import { PASSWORD_MIN, passwordsMatch } from './password';

/**
 * Duas etapas na mesma rota: pedir o link por e-mail e, ao voltar pelo link (que abre
 * uma sessão de recuperação), escolher a nova senha.
 */
@Component({
  selector: 'app-reset-password',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslocoPipe,
    ButtonModule,
    InputTextModule,
    MessageModule,
    PasswordModule,
    ProgressSpinnerModule,
    AuthCard,
    Turnstile,
  ],
  templateUrl: './reset-password.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResetPassword {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly messages = inject(MessageService);
  private readonly transloco = inject(TranslocoService);

  readonly lang = input.required<Lang>();

  /** Veio pelo link do e-mail e a sessão de recuperação abriu. */
  protected readonly choosing = computed(
    () => this.auth.arrivedForRecovery && this.auth.ready() && !!this.auth.session(),
  );
  /** Veio pelo link, mas ele venceu ou já foi usado. */
  protected readonly linkFailed = computed(
    () =>
      !!this.auth.arrivalError ||
      (this.auth.arrivedForRecovery && this.auth.ready() && !this.auth.session()),
  );

  private readonly captcha = viewChild(Turnstile);
  protected readonly captchaEnabled = CAPTCHA_ENABLED;
  protected readonly captchaToken = signal<string | null>(null);
  protected readonly passwordMin = PASSWORD_MIN;

  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly requestForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });
  protected readonly passwordForm = this.fb.group(
    {
      password: ['', [Validators.required, Validators.minLength(PASSWORD_MIN)]],
      confirm: ['', [Validators.required]],
    },
    { validators: passwordsMatch },
  );

  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly sentTo = signal<string | null>(null);

  protected async request(): Promise<void> {
    this.requestForm.markAllAsTouched();
    if (this.requestForm.invalid || (this.captchaEnabled && !this.captchaToken())) return;

    this.error.set(null);
    this.submitting.set(true);
    const { email } = this.requestForm.getRawValue();
    try {
      await this.auth.sendPasswordReset({
        email,
        lang: this.lang(),
        captchaToken: this.captchaToken() ?? undefined,
      });
      // Mesma resposta exista ou não a conta, para não revelar quem tem cadastro.
      this.sentTo.set(email);
    } catch (error) {
      this.error.set(authErrorKey(error));
      this.captcha()?.reset();
    } finally {
      this.submitting.set(false);
    }
  }

  protected async save(): Promise<void> {
    this.passwordForm.markAllAsTouched();
    if (this.passwordForm.invalid) return;

    this.error.set(null);
    this.submitting.set(true);
    try {
      await this.auth.updatePassword(this.passwordForm.getRawValue().password);
      this.messages.add({
        severity: 'success',
        summary: this.transloco.translate('auth.reset.saved'),
        life: 3000,
      });
      await this.router.navigate(['/', this.lang(), 'account']);
    } catch (error) {
      this.error.set(authErrorKey(error));
    } finally {
      this.submitting.set(false);
    }
  }
}
