import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID, signal } from '@angular/core';

const DARK_CLASS = 'app-dark';
const STORAGE_KEY = 'theme';

/** Tema escuro por padrão; a escolha clara fica guardada só neste navegador. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  /** O index.html já aplicou a escolha salva antes do Angular carregar. */
  readonly dark = signal(
    this.browser ? this.document.documentElement.classList.contains(DARK_CLASS) : true,
  );

  toggle(): void {
    const dark = !this.dark();
    this.dark.set(dark);
    this.document.documentElement.classList.toggle(DARK_CLASS, dark);
    try {
      localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
    } catch {
      // Navegação privada ou armazenamento bloqueado: vale só nesta visita.
    }
  }
}
