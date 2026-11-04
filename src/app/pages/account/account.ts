import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { RadioButtonModule } from 'primeng/radiobutton';
import { TagModule } from 'primeng/tag';
import { authErrorKey } from '../../core/auth/auth-errors';
import { AuthService } from '../../core/auth/auth.service';
import { isValidUsername, normalizeUsername, suggestUsername, USERNAME_MAX } from '../../core/auth/username';
import { HTML_LANG, Lang } from '../../core/i18n/langs';
import { TERMS_ACCEPTED_FLAG } from '../auth/oauth-buttons';
import { BADGE_STYLE, BADGES } from '../../core/community/badges';
import { AuthorName } from '../community/author';
import { MyProfiles } from './my-profiles';

type Action = 'setup' | 'username' | 'export' | 'delete' | 'signOut';

@Component({
  selector: 'app-account',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslocoPipe,
    ButtonModule,
    CheckboxModule,
    DialogModule,
    InputTextModule,
    MessageModule,
    ProgressSpinnerModule,
    RadioButtonModule,
    TagModule,
    MyProfiles,
    AuthorName,
  ],
  templateUrl: './account.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Account {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly messages = inject(MessageService);
  private readonly transloco = inject(TranslocoService);
  private readonly document = inject(DOCUMENT);
  private readonly fb = inject(FormBuilder).nonNullable;

  readonly lang = input.required<Lang>();

  protected readonly account = this.auth.account;
  protected readonly usernameMax = USERNAME_MAX;
  protected readonly allBadges = BADGES;
  protected readonly badgeStyle = BADGE_STYLE;

  protected readonly memberSince = computed(() => {
    const date = this.account()?.createdAt;
    return date
      ? new Intl.DateTimeFormat(HTML_LANG[this.lang()], { dateStyle: 'long' }).format(new Date(date))
      : '';
  });

  // Completar o cadastro (quem entrou pelo Google ou GitHub).
  protected readonly setupForm = this.fb.group({
    username: ['', [Validators.required]],
    terms: [false, [Validators.requiredTrue]],
  });

  // Trocar o nome de usuário.
  protected readonly editingUsername = signal(false);
  protected readonly usernameForm = this.fb.group({ username: ['', [Validators.required]] });

  // Apagar a conta: escolher o destino dos perfis e digitar o nome de usuário para confirmar.
  protected readonly deleteOpen = signal(false);
  protected readonly deleteForm = this.fb.group({ confirm: [''], keepProfiles: [true] });

  protected readonly busy = signal<Action | null>(null);
  protected readonly error = signal<string | null>(null);
  /** Saindo ou apagando: a conta some antes da navegação e não é erro. */
  protected readonly leaving = computed(() => this.busy() === 'delete' || this.busy() === 'signOut');

  constructor() {
    // Preenche o cadastro com o login do GitHub ou o começo do e-mail do Google.
    effect(() => {
      const account = this.account();
      if (!account || !this.auth.needsSetup() || this.setupForm.dirty) return;
      const meta = this.auth.user()?.user_metadata ?? {};
      const suggestion =
        account.username ??
        (suggestUsername(meta['user_name'] ?? meta['preferred_username']) ||
          suggestUsername(account.email.split('@')[0]));
      this.setupForm.reset({
        username: suggestion,
        terms: !!account.termsAcceptedAt || this.readTermsFlag(),
      });
    });
  }

  protected async completeSetup(): Promise<void> {
    this.setupForm.markAllAsTouched();
    const account = this.account();
    const username = normalizeUsername(this.setupForm.controls.username.value);
    if (!account || this.setupForm.invalid) return;
    if (!isValidUsername(username)) {
      this.error.set('auth.errors.username_invalid');
      return;
    }
    await this.run('setup', async () => {
      if (username !== account.username) await this.auth.setUsername(username);
      if (!account.termsAcceptedAt) await this.auth.acceptTerms();
      this.clearTermsFlag();
      this.toast('account.setup.done');
    });
  }

  protected startEditingUsername(): void {
    this.usernameForm.reset({ username: this.account()?.username ?? '' });
    this.error.set(null);
    this.editingUsername.set(true);
  }

  protected async saveUsername(): Promise<void> {
    const username = normalizeUsername(this.usernameForm.controls.username.value);
    if (username === this.account()?.username) {
      this.editingUsername.set(false);
      return;
    }
    if (!isValidUsername(username)) {
      this.error.set('auth.errors.username_invalid');
      return;
    }
    await this.run('username', async () => {
      await this.auth.setUsername(username);
      this.editingUsername.set(false);
      this.toast('account.profile.usernameSaved');
    });
  }

  /** Baixa um .json com tudo o que o site guarda sobre a pessoa. */
  protected async exportData(): Promise<void> {
    await this.run('export', async () => {
      const data = await this.auth.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = this.document.createElement('a');
      link.href = url;
      link.download = `macitrun-${this.account()?.username ?? 'conta'}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url));
    });
  }

  protected openDelete(): void {
    this.deleteForm.reset({ confirm: '', keepProfiles: true });
    this.error.set(null);
    this.deleteOpen.set(true);
  }

  /** Só libera o botão quando o nome digitado confere (ou o e-mail, se ainda não há nome). */
  protected deleteConfirmed(): boolean {
    const account = this.account();
    const typed = this.deleteForm.controls.confirm.value.trim().toLowerCase();
    return !!account && typed === (account.username ?? account.email).toLowerCase();
  }

  protected async deleteAccount(): Promise<void> {
    if (!this.deleteConfirmed()) return;
    await this.run('delete', async () => {
      await this.auth.deleteAccount(this.deleteForm.controls.keepProfiles.value);
      this.deleteOpen.set(false);
      this.toast('account.delete.done');
      await this.router.navigate(['/', this.lang()]);
    });
  }

  protected async signOut(): Promise<void> {
    await this.run('signOut', async () => {
      await this.auth.signOut();
      await this.router.navigate(['/', this.lang()]);
    });
  }

  protected providerLabel(provider: string): string {
    return ['email', 'google', 'github'].includes(provider) ? `account.providers.${provider}` : provider;
  }

  private async run(action: Action, fn: () => Promise<void>): Promise<void> {
    this.error.set(null);
    this.busy.set(action);
    try {
      await fn();
    } catch (error) {
      this.error.set(authErrorKey(error));
    } finally {
      this.busy.set(null);
    }
  }

  private toast(key: string): void {
    this.messages.add({ severity: 'success', summary: this.transloco.translate(key), life: 3000 });
  }

  private readTermsFlag(): boolean {
    try {
      return sessionStorage.getItem(TERMS_ACCEPTED_FLAG) === '1';
    } catch {
      return false;
    }
  }

  private clearTermsFlag(): void {
    try {
      sessionStorage.removeItem(TERMS_ACCEPTED_FLAG);
    } catch {
      // Nada a limpar.
    }
  }
}
