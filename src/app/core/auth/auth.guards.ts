import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Páginas que pedem login (/account). Sem sessão, vai para o login e volta depois.
 * No servidor deixa passar: essas páginas só renderizam no navegador.
 */
export const requireAuth: CanActivateFn = async (route, state) => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.whenReady();
  if (auth.session()) return true;
  return router.createUrlTree(['/', route.paramMap.get('lang'), 'login'], {
    queryParams: { next: state.url.split('#')[0] },
  });
};

/** Login e cadastro: quem já está conectado vai para a conta. */
export const guestOnly: CanActivateFn = async (route) => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;
  const auth = inject(AuthService);
  await auth.whenReady();
  if (!auth.session()) return true;
  return inject(Router).createUrlTree(['/', route.paramMap.get('lang'), 'account']);
};

/**
 * Destino depois do login, vindo de ?next=. Só aceita caminhos do próprio site no mesmo
 * idioma (nada de "//outro-site" nem "https://..."), senão volta para a conta.
 */
export function safeNext(next: string | null | undefined, lang: string): string {
  const fallback = `/${lang}/account`;
  if (!next || !next.startsWith(`/${lang}/`) || next.startsWith('//') || next.includes('\\')) {
    return fallback;
  }
  return next;
}
