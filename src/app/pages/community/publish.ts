import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { parseProfileText } from '@macitrun/profile-schema';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { TextareaModule } from 'primeng/textarea';
import { authErrorKey } from '../../core/auth/auth-errors';
import { AuthService } from '../../core/auth/auth.service';
import { COMMUNITY_ENABLED, ProfileIssue, PublishError } from '../../core/community/community';
import { CommunityService } from '../../core/community/community.service';
import { decodeProfileData, PENDING_PROFILE_KEY } from '../../core/community/publish-data';
import { Lang } from '../../core/i18n/langs';
import { ProfileChanges } from './profile-changes';

const NOTES_MAX = 2000;
const PENDING_NOTES_KEY = 'macitrun.pendingNotes';

/** Problemas do arquivo que têm mensagem própria; os outros usam a genérica. */
const ISSUE_CODES = new Set([
  'invalid_json',
  'too_large',
  'id_invalid',
  'name_invalid',
  'executables_empty',
  'executable_invalid',
  'executable_reserved',
  'invalid_value',
  'invalid_type',
  'unrecognized_keys',
  'dll_invalid',
  'load_order_invalid',
  'environment_bottle_wide',
  'environment_not_allowed',
  'environment_path',
  'environment_value_invalid',
  'arguments_too_many',
  'argument_invalid',
  'notes_too_long',
  'tested_on_invalid',
]);

/**
 * Publicar um perfil de configuração. Ele chega pelo botão Publicar do app (#data= na URL),
 * por arquivo ou colado. A página valida com as mesmas regras do app, mostra a prévia e envia
 * para a API, que valida de novo. O perfil espera no sessionStorage enquanto a pessoa entra.
 */
@Component({
  selector: 'app-publish',
  imports: [ReactiveFormsModule, RouterLink, TranslocoPipe, ButtonModule, MessageModule, TextareaModule, ProfileChanges],
  templateUrl: './publish.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Publish {
  protected readonly auth = inject(AuthService);
  private readonly community = inject(CommunityService);
  private readonly router = inject(Router);
  private readonly messages = inject(MessageService);
  private readonly transloco = inject(TranslocoService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly lang = input.required<Lang>();

  protected readonly enabled = COMMUNITY_ENABLED;
  protected readonly notesMax = NOTES_MAX;

  /** O texto do arquivo .macitrun-profile em análise. */
  protected readonly text = signal('');
  protected readonly fromApp = signal(false);
  protected readonly result = computed(() => (this.text() ? parseProfileText(this.text()) : null));
  protected readonly file = computed(() => {
    const result = this.result();
    return result?.ok ? result.file : null;
  });
  protected readonly issues = computed(() => {
    const result = this.result();
    return result && !result.ok ? result.issues : [];
  });

  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly pasteForm = this.fb.group({ text: ['', Validators.required] });
  protected readonly notesForm = this.fb.group({ notes: ['', Validators.maxLength(NOTES_MAX)] });

  protected readonly publishing = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Problemas apontados pela API (se a validação do servidor discordar da daqui). */
  protected readonly serverIssues = signal<ProfileIssue[]>([]);

  constructor() {
    if (!this.browser) return;
    if (!this.readHash()) this.setText(this.storage('get', PENDING_PROFILE_KEY) ?? '', false);
    // Outro link do app com a página já aberta: só o fragmento muda.
    const onHashChange = () => this.readHash();
    window.addEventListener('hashchange', onHashChange);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('hashchange', onHashChange));
    this.notesForm.reset({ notes: this.storage('get', PENDING_NOTES_KEY) ?? '' });
    this.notesForm.controls.notes.valueChanges.subscribe((notes) => this.storage('set', PENDING_NOTES_KEY, notes));
  }

  /** Lê o perfil de #data= (vindo do app); false se não há. */
  private readHash(): boolean {
    const data = /(?:^#|&)data=([^&]*)/.exec(window.location.hash)?.[1];
    if (data === undefined) return false;
    // Tira o perfil da barra de endereço (e do histórico) e guarda para depois do login.
    history.replaceState(history.state, '', window.location.pathname + window.location.search);
    // Dado que não decodifica cai na validação como "não é um arquivo válido".
    this.setText(decodeProfileData(data) ?? '{', true);
    return true;
  }

  protected issueKey(issue: ProfileIssue): string {
    return `publish.issues.${ISSUE_CODES.has(issue.code) ? issue.code : 'generic'}`;
  }

  protected async readFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    // Mais de 16 KB nem é lido: o arquivo é recusado do mesmo jeito.
    this.setText(file.size > 64 * 1024 ? 'x'.repeat(17 * 1024) : await file.text(), false);
  }

  protected checkPasted(): void {
    this.setText(this.pasteForm.getRawValue().text, false);
  }

  protected reset(): void {
    this.setText('', false);
    this.pasteForm.reset();
  }

  protected async goToLogin(): Promise<void> {
    await this.router.navigate(['/', this.lang(), 'login'], {
      queryParams: { next: `/${this.lang()}/community/publish` },
    });
  }

  protected async publish(): Promise<void> {
    if (!this.file() || this.notesForm.invalid) return;
    this.error.set(null);
    this.serverIssues.set([]);
    this.publishing.set(true);
    try {
      const { id, slug } = await this.community.publish(this.text(), this.notesForm.getRawValue().notes);
      this.storage('remove', PENDING_PROFILE_KEY);
      this.storage('remove', PENDING_NOTES_KEY);
      this.messages.add({ severity: 'success', summary: this.transloco.translate('publish.published'), life: 3000 });
      await this.router.navigate(['/', this.lang(), 'community', id, slug]);
    } catch (error) {
      if (error instanceof PublishError && error.code === 'invalid_profile') {
        this.serverIssues.set(error.issues);
      } else {
        this.error.set(authErrorKey(error instanceof PublishError ? { code: error.code } : error));
      }
    } finally {
      this.publishing.set(false);
    }
  }

  private setText(text: string, fromApp: boolean): void {
    this.text.set(text);
    this.fromApp.set(fromApp && !!text);
    this.error.set(null);
    this.serverIssues.set([]);
    if (text) this.storage('set', PENDING_PROFILE_KEY, text);
    else this.storage('remove', PENDING_PROFILE_KEY);
  }

  /** sessionStorage pode faltar (navegação privada antiga): aí o perfil só não espera o login. */
  private storage(action: 'get' | 'set' | 'remove', key: string, value = ''): string | null {
    try {
      if (action === 'get') return sessionStorage.getItem(key);
      if (action === 'set') sessionStorage.setItem(key, value);
      else sessionStorage.removeItem(key);
    } catch {
      // Sem armazenamento.
    }
    return null;
  }
}
