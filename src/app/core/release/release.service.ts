import { isPlatformServer } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  inject,
  Injectable,
  InjectionToken,
  makeStateKey,
  PendingTasks,
  PLATFORM_ID,
  TransferState,
} from '@angular/core';
import { catchError, firstValueFrom, of } from 'rxjs';
import { RELEASE_ENDPOINT, ReleaseInfo } from './release';

/**
 * Como buscar a release. No navegador pergunta ao servidor do site; o servidor
 * troca isto por uma busca direta no GitHub (app.config.server.ts).
 */
export const RELEASE_FETCHER = new InjectionToken<() => Promise<ReleaseInfo | null>>(
  'RELEASE_FETCHER',
  {
    providedIn: 'root',
    factory: () => {
      const http = inject(HttpClient);
      return () =>
        firstValueFrom(http.get<ReleaseInfo | null>(RELEASE_ENDPOINT).pipe(catchError(() => of(null))));
    },
  },
);

const RELEASE_KEY = makeStateKey<ReleaseInfo | null>('latest-release');

@Injectable({ providedIn: 'root' })
export class ReleaseService {
  private readonly fetcher = inject(RELEASE_FETCHER);
  private readonly transferState = inject(TransferState);
  private readonly pendingTasks = inject(PendingTasks);
  private readonly server = isPlatformServer(inject(PLATFORM_ID));

  /** A release mais recente, ou null se o GitHub não respondeu. */
  latest(): Promise<ReleaseInfo | null> {
    // O que o servidor já buscou vem junto com a página: o navegador não pede de novo.
    if (this.transferState.hasKey(RELEASE_KEY)) {
      const value = this.transferState.get(RELEASE_KEY, null);
      this.transferState.remove(RELEASE_KEY);
      return Promise.resolve(value);
    }
    // PendingTasks faz o servidor esperar a resposta antes de entregar a página.
    return this.fetchTracked();
  }

  private async fetchTracked(): Promise<ReleaseInfo | null> {
    const done = this.pendingTasks.add();
    try {
      const value = await this.fetcher();
      if (this.server) this.transferState.set(RELEASE_KEY, value);
      return value;
    } finally {
      done();
    }
  }
}
