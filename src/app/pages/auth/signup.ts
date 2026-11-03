import { ChangeDetectionStrategy, Component, inject, input, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DividerModule } from 'primeng/divider';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { PasswordModule } from 'primeng/password';
import { debounceTime, distinctUntilChanged, map, startWith, switchMap } from 'rxjs';
import { authErrorKey } from '../../core/auth/auth-errors';
import { AuthService } from '../../core/auth/auth.service';
import { isValidUsername, normalizeUsername, USERNAME_MAX } from '../../core/auth/username';
import { Lang } from '../../core/i18n/langs';
import { CAPTCHA_ENABLED, Turnstile } from '../../shared/turnstile';
import { AuthCard } from './auth-card';
import { OAuthButtons } from './oauth-buttons';
import { PASSWORD_MIN } from './password';

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

@Component({
  selector: 'app-signup',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslocoPipe,
    ButtonModule,
    CheckboxModule,
    DividerModule,
    InputTextModule,
    MessageModule,
    PasswordModule,
    AuthCard,
    OAuthButtons,
    Turnstile,
  ],
  templateUrl: './signup.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Signup {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly lang = input.required<Lang>();

  private readonly captcha = viewChild(Turnstile);
  protected readonly captchaEnabled = CAPTCHA_ENABLED;
  protected readonly captchaToken = signal<string | null>(null);

  protected readonly usernameMax = USERNAME_MAX;
  protected readonly passwordMin = PASSWORD_MIN;

  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    username: ['', [Validators.required]],
    password: ['', [Validators.required, Validators.minLength(PASSWORD_MIN)]],
    terms: [false, [Validators.requiredTrue]],
  });

  /** O aceite dos termos também vale para os botões do Google e do GitHub. */
  protected readonly termsAccepted = toSignal(
    this.form.controls.terms.valueChanges.pipe(startWith(this.form.controls.terms.value)),
    { requireSync: true },
  );

  /** Confere o nome no banco enquanto a pessoa digita. */
  protected readonly usernameStatus = signal<UsernameStatus>('idle');

  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  /** E-mail para onde foi o link de confirmação. */
  protected readonly sentTo = signal<string | null>(null);

  constructor() {
    this.form.controls.username.valueChanges
      .pipe(
        map(normalizeUsername),
        distinctUntilChanged(),
        debounceTime(400),
        switchMap(async (name): Promise<UsernameStatus> => {
          if (!name) return 'idle';
          if (!isValidUsername(name)) return 'invalid';
          this.usernameStatus.set('checking');
          try {
            return (await this.auth.usernameAvailable(name)) ? 'available' : 'taken';
          } catch {
            // Sem resposta, o banco confere de novo no cadastro.
            return 'idle';
          }
        }),
        takeUntilDestroyed(),
      )
      .subscribe((status) => this.usernameStatus.set(status));
  }

  protected async submit(): Promise<void> {
    this.form.markAllAsTouched();
    const username = normalizeUsername(this.form.controls.username.value);
    if (!isValidUsername(username)) this.usernameStatus.set('invalid');
    if (
      this.form.invalid ||
      ['invalid', 'taken'].includes(this.usernameStatus()) ||
      (this.captchaEnabled && !this.captchaToken())
    ) {
      return;
    }

    this.error.set(null);
    this.submitting.set(true);
    const { email, password } = this.form.getRawValue();
    try {
      await this.auth.signUp({
        email,
        password,
        username,
        lang: this.lang(),
        captchaToken: this.captchaToken() ?? undefined,
      });
      // Com a confirmação de e-mail desligada no Supabase, a sessão já vem pronta.
      if (this.auth.session()) {
        await this.router.navigate(['/', this.lang(), 'account']);
      } else {
        this.sentTo.set(email);
      }
    } catch (error) {
      this.error.set(authErrorKey(error));
      this.captcha()?.reset();
    } finally {
      this.submitting.set(false);
    }
  }
}
