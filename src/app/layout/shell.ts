import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';
import { SelectModule } from 'primeng/select';
import { filter, map } from 'rxjs';
import { AuthService } from '../core/auth/auth.service';
import { Lang, LANG_LABEL, LANGS } from '../core/i18n/langs';
import { KOFI_URL, RELEASES_URL } from '../core/site';
import { ThemeService } from '../core/theme.service';

interface NavItem {
  path: string;
  label: string;
}

@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    FormsModule,
    TranslocoPipe,
    ButtonModule,
    DrawerModule,
    SelectModule,
  ],
  templateUrl: './shell.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Shell {
  private readonly router = inject(Router);
  protected readonly theme = inject(ThemeService);
  protected readonly auth = inject(AuthService);

  private readonly route = inject(ActivatedRoute);

  /** Idioma da URL (/pt, /en, /es); a rota já garantiu que é válido. */
  protected readonly lang = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('lang') as Lang)),
    { initialValue: this.route.snapshot.paramMap.get('lang') as Lang },
  );
  protected readonly langOptions = LANGS.map((value) => ({ value, label: LANG_LABEL[value] }));
  protected readonly nav: NavItem[] = [
    { path: 'community', label: 'nav.community' },
    { path: 'forum', label: 'nav.forum' },
    { path: 'download', label: 'nav.download' },
  ];
  protected readonly kofiUrl = KOFI_URL;
  protected readonly releasesUrl = RELEASES_URL;
  protected readonly year = new Date().getFullYear();
  protected readonly menuOpen = signal(false);

  /** Caminho atual sem o idioma, para trocar de idioma na mesma página. */
  private readonly pathAfterLang = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.stripLang(this.router.url)),
    ),
    { initialValue: this.stripLang(this.router.url) },
  );

  protected readonly home = computed(() => ['/', this.lang()]);

  protected link(path: string): string[] {
    return path ? ['/', this.lang(), path] : ['/', this.lang()];
  }

  protected changeLang(lang: Lang): void {
    if (lang === this.lang()) return;
    this.router.navigateByUrl(`/${lang}${this.pathAfterLang()}`);
  }

  private stripLang(url: string): string {
    return url.replace(/^\/[a-z]{2}(?=\/|$|\?|#)/, '');
  }
}
