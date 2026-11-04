import { Routes } from '@angular/router';
import { guestOnly, requireAdmin, requireAuth } from './core/auth/auth.guards';
import { langMatch, langResolver, redirectToLang } from './core/i18n/lang.routing';
import { Shell } from './layout/shell';

/**
 * Todas as páginas ficam sob o idioma (/pt, /en, /es). `data.page` escolhe o
 * título e a descrição em `seo.<page>` nas traduções; `data.noindex` tira a página dos
 * buscadores.
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
        path: 'community',
        data: { page: 'community' },
        loadComponent: () => import('./pages/community/community').then((m) => m.Community),
      },
      {
        // Antes de community/:id, senão "publish" viraria um id.
        path: 'community/publish',
        data: { page: 'publish', noindex: true },
        loadComponent: () => import('./pages/community/publish').then((m) => m.Publish),
      },
      {
        // O slug é só para ler; o id basta para achar o perfil.
        path: 'community/:id/:slug',
        data: { page: 'communityProfile' },
        loadComponent: () => import('./pages/community/profile').then((m) => m.ProfilePage),
      },
      {
        path: 'community/:id',
        data: { page: 'communityProfile' },
        loadComponent: () => import('./pages/community/profile').then((m) => m.ProfilePage),
      },
      {
        path: 'forum',
        data: { page: 'forum' },
        loadComponent: () => import('./pages/forum/forum').then((m) => m.Forum),
      },
      {
        // Antes de forum/:id, senão "new" viraria um id.
        path: 'forum/new',
        canActivate: [requireAuth],
        data: { page: 'newTopic', noindex: true },
        loadComponent: () => import('./pages/forum/new-topic').then((m) => m.NewTopic),
      },
      {
        // O slug é só para ler; o id basta para achar o tópico.
        path: 'forum/:id/:slug',
        data: { page: 'topic' },
        loadComponent: () => import('./pages/forum/topic').then((m) => m.TopicPage),
      },
      {
        path: 'forum/:id',
        data: { page: 'topic' },
        loadComponent: () => import('./pages/forum/topic').then((m) => m.TopicPage),
      },
      {
        path: 'signup',
        canActivate: [guestOnly],
        data: { page: 'signup' },
        loadComponent: () => import('./pages/auth/signup').then((m) => m.Signup),
      },
      {
        path: 'login',
        canActivate: [guestOnly],
        data: { page: 'login' },
        loadComponent: () => import('./pages/auth/login').then((m) => m.Login),
      },
      {
        path: 'reset-password',
        data: { page: 'resetPassword', noindex: true },
        loadComponent: () => import('./pages/auth/reset-password').then((m) => m.ResetPassword),
      },
      {
        path: 'account',
        canActivate: [requireAuth],
        data: { page: 'account', noindex: true },
        loadComponent: () => import('./pages/account/account').then((m) => m.Account),
      },
      {
        // O app de Mac abre esta página para a pessoa autorizar o login dele.
        path: 'app-login',
        canActivate: [requireAuth],
        data: { page: 'appLogin', noindex: true },
        loadComponent: () => import('./pages/account/app-login').then((m) => m.AppLogin),
      },
      {
        path: 'admin',
        canActivate: [requireAdmin],
        data: { page: 'admin', noindex: true },
        loadComponent: () => import('./pages/admin/admin').then((m) => m.Admin),
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
