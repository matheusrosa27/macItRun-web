import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { fetchLatestRelease } from './core/release/release';
import { RELEASE_FETCHER } from './core/release/release.service';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    // No servidor a release vem direto do GitHub (com cache), sem passar pela própria API.
    {
      provide: RELEASE_FETCHER,
      useValue: () => fetchLatestRelease(process.env['GITHUB_TOKEN']),
    },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
