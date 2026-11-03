import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { ToastModule } from 'primeng/toast';
import { filter } from 'rxjs';
import { isLang } from './core/i18n/langs';
import { SeoService } from './core/seo.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastModule],
  template: `
    <router-outlet />
    <p-toast position="bottom-center" />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  constructor() {
    const router = inject(Router);
    const seo = inject(SeoService);
    // Atualiza título, descrição e links de idioma a cada página (inclusive ao trocar o idioma).
    router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe(() => {
        let route: ActivatedRouteSnapshot = router.routerState.snapshot.root;
        while (route.firstChild) route = route.firstChild;
        const lang = route.paramMap.get('lang') ?? route.parent?.paramMap.get('lang');
        const page = route.data['page'];
        if (!isLang(lang) || typeof page !== 'string') return;
        const path = router.url.split(/[?#]/)[0].split('/').slice(2).join('/');
        seo.update(page, lang, page === 'notFound' ? '' : path, route.data['noindex'] === true);
      });
  }
}
