import { Routes } from '@angular/router';
import { langMatch, langResolver, redirectToLang } from './core/i18n/lang.routing';
import { Shell } from './layout/shell';

/**
 * Todas as páginas ficam sob o idioma (/pt, /en, /es). `data.page` escolhe o
 * título e a descrição em `seo.<page>` nas traduções.
 */
export const routes: Routes = [
  {
    path: ':lang',
    canMatch: [langMatch],
    resolve: { lang: langResolver },
    component: Shell,
    children: [
      {
        path: '',
        pathMatch: 'full',
        data: { page: 'home' },
        loadComponent: () => import('./pages/home/home').then((m) => m.Home),
      },
      {
        path: 'download',
        data: { page: 'download' },
        loadComponent: () => import('./pages/download/download').then((m) => m.Download),
      },
      {
        path: 'privacy',
        data: { page: 'privacy' },
        loadComponent: () => import('./pages/legal/privacy').then((m) => m.Privacy),
      },
      {
        path: 'terms',
        data: { page: 'terms' },
        loadComponent: () => import('./pages/legal/terms').then((m) => m.Terms),
      },
      {
        path: 'licenses',
        data: { page: 'licenses' },
        loadComponent: () => import('./pages/legal/licenses').then((m) => m.Licenses),
      },
      {
        path: '**',
        data: { page: 'notFound' },
        loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFound),
      },
    ],
  },
  // Sem idioma na URL: vai para o idioma preferido, mantendo o resto do caminho.
  { path: '**', redirectTo: redirectToLang },
];
