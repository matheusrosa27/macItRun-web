import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../../core/auth/auth.service';
import { CommunityService } from '../../core/community/community.service';
import { PublishError } from '../../core/community/community';
import { Lang } from '../../core/i18n/langs';
import { AuthCard } from '../auth/auth-card';

/** Desafio PKCE (SHA-256 em base64url) e estado que o app de Mac manda na URL. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const STATE = /^[A-Za-z0-9_-]{16,64}$/;

type Step = 'ask' | 'working' | 'done' | 'cancelled';

/**
 * /<idioma>/app-login?challenge=...&state=...: o app de Mac abre esta página no navegador
 * (com login, pelo requireAuth). Ao autorizar, a API dá um código de uso único e a página
 * devolve para o app em macitrun://auth-callback. O código só vale com o segredo que ficou
 * no app, então outro programa que capture o link não entra na conta.
 */
@Component({
  selector: 'app-app-login',
  imports: [RouterLink, TranslocoPipe, ButtonModule, MessageModule, AuthCard],
  template: `
    <app-auth-card [title]="'appLogin.title' | transloco">
      @if (!valid()) {
        <p-message severity="error" [text]="'appLogin.invalid' | transloco" />
      } @else if (incomplete()) {
        <p-message severity="warn" [text]="'appLogin.incomplete' | transloco" />
        <a pButton [routerLink]="['/', lang(), 'account']">
          <span pButtonLabel>{{ 'appLogin.finishAccount' | transloco }}</span>
        </a>
      } @else {
        @switch (step()) {
          @case ('done') {
            <p-message severity="success" [text]="'appLogin.done' | transloco" />
            <p class="m-0 text-surface-600 dark:text-surface-400">{{ 'appLogin.doneHint' | transloco }}</p>
            <a pButton [href]="callbackLink()" severity="secondary">
              <i class="pi pi-external-link" pButtonIcon></i>
              <span pButtonLabel>{{ 'appLogin.openApp' | transloco }}</span>
            </a>
          }
          @case ('cancelled') {
            <p-message severity="info" [text]="'appLogin.cancelled' | transloco" />
          }
          @default {
            <p class="m-0">{{ 'appLogin.body' | transloco: { username: '@' + (username() ?? '') } }}</p>
            @if (error()) {
              <p-message severity="error" [text]="error()! | transloco" />
            }
            <div class="flex gap-3">
              <p-button
                [label]="(step() === 'working' ? 'appLogin.working' : 'appLogin.authorize') | transloco"
                icon="pi pi-check"
                [loading]="step() === 'working'"
                (onClick)="authorize()"
              />
              <p-button
                [label]="'appLogin.cancel' | transloco"
                severity="secondary"
                [disabled]="step() === 'working'"
                (onClick)="step.set('cancelled')"
              />
            </div>
          }
        }
      }
    </app-auth-card>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppLogin implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly community = inject(CommunityService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly lang = input.required<Lang>();
  readonly challenge = input<string>();
  readonly state = input<string>();

  protected readonly valid = computed(
    () => CHALLENGE.test(this.challenge() ?? '') && STATE.test(this.state() ?? ''),
  );
  protected readonly username = computed(() => this.auth.account()?.username ?? null);
  /** Conta sem nome de usuário (ex.: entrou pelo Google e não terminou o cadastro). */
  protected readonly incomplete = computed(() => this.auth.account() !== undefined && !this.username());

  protected readonly step = signal<Step>('ask');
  protected readonly error = signal<string | null>(null);
  protected readonly callback = signal('');
  /** Link macitrun:// (o Angular bloqueia esquemas desconhecidos sem esta liberação). */
  protected readonly callbackLink = computed(() => this.sanitizer.bypassSecurityTrustUrl(this.callback()));

  async ngOnInit(): Promise<void> {
    if (this.auth.account() === undefined) await this.auth.refreshAccount();
  }

  protected async authorize(): Promise<void> {
    this.error.set(null);
    this.step.set('working');
    try {
      const { code } = await this.community.appLogin(this.challenge()!);
      const params = new URLSearchParams({ code, state: this.state()! });
      this.callback.set(`macitrun://auth-callback?${params}`);
      this.step.set('done');
      window.location.href = this.callback();
    } catch (error) {
      const code = error instanceof PublishError ? error.code : '';
      this.error.set(code === 'no_email' ? 'appLogin.noEmail' : 'appLogin.error');
      this.step.set('ask');
    }
  }
}
