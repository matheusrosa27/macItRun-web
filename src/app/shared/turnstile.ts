import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { PUBLIC_ENV } from '../../environments/public-env';
import { Lang } from '../core/i18n/langs';
import { ThemeService } from '../core/theme.service';

interface TurnstileApi {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptLoad: Promise<TurnstileApi> | undefined;

function loadScript(): Promise<TurnstileApi> {
  scriptLoad ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject());
    script.onerror = () => {
      scriptLoad = undefined;
      reject();
    };
    document.head.appendChild(script);
  });
  return scriptLoad;
}

/** O captcha está ligado quando o build recebeu a chave de site do Turnstile. */
export const CAPTCHA_ENABLED = Boolean(PUBLIC_ENV.turnstileSiteKey);

/**
 * Captcha Cloudflare Turnstile (cadastro, login e nova senha). O Supabase confere o token.
 * Emite o token quando a pessoa passa e null quando ele vence ou falha.
 */
@Component({
  selector: 'app-turnstile',
  template: `<div #box class="min-h-[65px]"></div>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Turnstile {
  readonly lang = input.required<Lang>();
  readonly token = output<string | null>();

  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');
  private readonly theme = inject(ThemeService);
  private api?: TurnstileApi;
  private widgetId?: string;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(async () => {
      if (!CAPTCHA_ENABLED) return;
      try {
        this.api = await loadScript();
      } catch {
        this.token.emit(null);
        return;
      }
      if (destroyRef.destroyed) return;
      this.widgetId = this.api.render(this.box().nativeElement, {
        sitekey: PUBLIC_ENV.turnstileSiteKey,
        theme: this.theme.dark() ? 'dark' : 'light',
        language: this.lang() === 'pt' ? 'pt-br' : this.lang(),
        callback: (token: string) => this.token.emit(token),
        'expired-callback': () => this.token.emit(null),
        'error-callback': () => this.token.emit(null),
      });
    });
    destroyRef.onDestroy(() => {
      if (this.widgetId) this.api?.remove(this.widgetId);
    });
  }

  /** Um token só vale uma vez: depois de cada envio, pede outro. */
  reset(): void {
    this.token.emit(null);
    if (this.widgetId) this.api?.reset(this.widgetId);
  }
}
