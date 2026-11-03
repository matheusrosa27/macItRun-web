import { isPlatformServer } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable, makeStateKey, PendingTasks, PLATFORM_ID, TransferState } from '@angular/core';
import { catchError, firstValueFrom, of, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import {
  API_BASE,
  ListParams,
  MyProfile,
  PublishError,
  ReportReason,
  ReportTarget,
  Page,
  ProfileComment,
  ProfileDetail,
  ProfileSummary,
} from './community';

/**
 * Comunidade: as leituras vão pela API pública; curtir e comentar vão pelas funções do banco
 * com a sessão da pessoa, que validam tudo no servidor.
 *
 * O que o servidor leu vem junto com a página (TransferState), e o navegador não pede de novo.
 * É feito aqui, não pelo cache automático do HttpClient, porque as respostas do Supabase trazem
 * um cookie da Cloudflare (__cf_bm), e o Angular não repassa respostas com Set-Cookie.
 */
@Injectable({ providedIn: 'root' })
export class CommunityService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly transferState = inject(TransferState);
  private readonly pendingTasks = inject(PendingTasks);
  private readonly server = isPlatformServer(inject(PLATFORM_ID));

  list(params: ListParams): Promise<Page<ProfileSummary>> {
    let query = new HttpParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') query = query.set(key, String(value));
    }
    return this.read(`list?${query.toString()}`, () =>
      firstValueFrom(this.http.get<Page<ProfileSummary>>(`${API_BASE}/profiles`, { params: query })),
    );
  }

  /**
   * O perfil, ou null se não existe ou não está publicado. `fresh`: ignora o que veio junto
   * com a página (renderizada no servidor e guardada pela CDN por até 1 minuto).
   */
  get(id: string, fresh = false): Promise<ProfileDetail | null> {
    const load = () =>
      firstValueFrom(
        this.http
          .get<ProfileDetail>(`${API_BASE}/profiles/${encodeURIComponent(id)}`)
          .pipe(catchError(notFoundAsNull)),
      );
    return fresh ? load() : this.read(`profile:${id}`, load);
  }

  comments(id: string, page = 1, fresh = false): Promise<Page<ProfileComment> | null> {
    const load = () =>
      firstValueFrom(
        this.http
          .get<Page<ProfileComment>>(`${API_BASE}/profiles/${encodeURIComponent(id)}/comments`, {
            params: { page },
          })
          .pipe(catchError(notFoundAsNull)),
      );
    return fresh ? load() : this.read(`comments:${id}:${page}`, load);
  }

  /** Valores para os filtros (Macs em que há perfis testados). */
  filters(): Promise<{ macs: string[] }> {
    return this.read('filters', () =>
      firstValueFrom(
        this.http
          .get<{ macs: string[] }>(`${API_BASE}/profile-filters`)
          .pipe(catchError(() => of({ macs: [] }))),
      ),
    );
  }

  /**
   * No servidor, busca e guarda na página; no navegador, usa uma vez o que veio com ela.
   * PendingTasks faz o servidor esperar a resposta antes de entregar a página.
   */
  private async read<T>(key: string, load: () => Promise<T>): Promise<T> {
    const stateKey = makeStateKey<T>(`community:${key}`);
    if (!this.server && this.transferState.hasKey(stateKey)) {
      const value = this.transferState.get(stateKey, null) as T;
      this.transferState.remove(stateKey);
      return value;
    }
    const done = this.pendingTasks.add();
    try {
      const value = await load();
      if (this.server) this.transferState.set(stateKey, value);
      return value;
    } finally {
      done();
    }
  }

  /**
   * Publica pela API, que valida o arquivo com o schema do perfil antes de gravar.
   * Erros vêm como PublishError (com os problemas do arquivo, se for o caso).
   */
  async publish(file: string, notes: string): Promise<{ id: string; slug: string }> {
    const token = await this.auth.accessToken();
    try {
      return await firstValueFrom(
        this.http.post<{ id: string; slug: string }>(
          `${API_BASE}/profiles`,
          { file, notes },
          { headers: { Authorization: `Bearer ${token}` } },
        ),
      );
    } catch (error) {
      const body = error instanceof HttpErrorResponse ? error.error : null;
      throw new PublishError(typeof body?.error === 'string' ? body.error : 'generic', body?.issues ?? []);
    }
  }

  myProfiles(): Promise<MyProfile[]> {
    return this.auth.rpc('my_profiles');
  }

  updateNotes(profileId: string, notes: string): Promise<void> {
    return this.auth.rpc('update_profile_notes', { profile_id: profileId, notes });
  }

  unpublish(profileId: string): Promise<void> {
    return this.auth.rpc('unpublish_profile', { profile_id: profileId });
  }

  report(target: ReportTarget, reason: ReportReason, detail: string): Promise<{ reported: boolean; hidden: boolean }> {
    return this.auth.rpc('report', { target_type: target.type, target_id: target.id, reason, detail });
  }

  /** Se a pessoa conectada já curtiu o perfil (cada um só lê as próprias curtidas). */
  async liked(profileId: string): Promise<boolean> {
    return this.auth.hasLiked(profileId);
  }

  like(profileId: string, liked: boolean): Promise<{ liked: boolean; likes: number }> {
    return this.auth.rpc('like_profile', { profile_id: profileId, liked });
  }

  addComment(profileId: string, body: string): Promise<ProfileComment> {
    return this.auth.rpc('add_comment', { profile_id: profileId, body });
  }

  deleteComment(commentId: number): Promise<void> {
    return this.auth.rpc('delete_comment', { comment_id: commentId });
  }
}

function notFoundAsNull(error: unknown) {
  return error instanceof HttpErrorResponse && error.status === 404 ? of(null) : throwError(() => error);
}
