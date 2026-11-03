import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, firstValueFrom, of, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import {
  API_BASE,
  ListParams,
  Page,
  ProfileComment,
  ProfileDetail,
  ProfileSummary,
} from './community';

/**
 * Comunidade: as leituras vão pela API pública (com HttpClient, então o que o servidor
 * buscou vem junto com a página e o navegador não pede de novo); curtir e comentar vão
 * pelas funções do banco com a sessão da pessoa, que validam tudo no servidor.
 */
@Injectable({ providedIn: 'root' })
export class CommunityService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  list(params: ListParams): Promise<Page<ProfileSummary>> {
    let query = new HttpParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') query = query.set(key, String(value));
    }
    return firstValueFrom(this.http.get<Page<ProfileSummary>>(`${API_BASE}/profiles`, { params: query }));
  }

  /** O perfil, ou null se não existe ou não está publicado. */
  get(id: string): Promise<ProfileDetail | null> {
    return firstValueFrom(
      this.http
        .get<ProfileDetail>(`${API_BASE}/profiles/${encodeURIComponent(id)}`)
        .pipe(catchError(notFoundAsNull)),
    );
  }

  comments(id: string, page = 1): Promise<Page<ProfileComment> | null> {
    return firstValueFrom(
      this.http
        .get<Page<ProfileComment>>(`${API_BASE}/profiles/${encodeURIComponent(id)}/comments`, {
          params: { page },
        })
        .pipe(catchError(notFoundAsNull)),
    );
  }

  /** Valores para os filtros (Macs em que há perfis testados). */
  filters(): Promise<{ macs: string[] }> {
    return firstValueFrom(
      this.http
        .get<{ macs: string[] }>(`${API_BASE}/profile-filters`)
        .pipe(catchError(() => of({ macs: [] }))),
    );
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
