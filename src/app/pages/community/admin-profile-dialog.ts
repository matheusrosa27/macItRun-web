import { ChangeDetectionStrategy, Component, inject, input, model, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { SkeletonModule } from 'primeng/skeleton';
import { TextareaModule } from 'primeng/textarea';
import { authErrorKey } from '../../core/auth/auth-errors';
import { AdminChanges, ProfileIssue, PublishError } from '../../core/community/community';
import { CommunityService } from '../../core/community/community.service';
import { issueKey } from '../../core/community/issues';

const STATUSES = ['published', 'hidden', 'removed'] as const;
type Status = (typeof STATUSES)[number];

/**
 * Admin edita um perfil de configuração (o arquivo, as notas, a situação e o autor) ou o
 * apaga de vez. A API valida o arquivo com as mesmas regras da publicação.
 */
@Component({
  selector: 'app-admin-profile-dialog',
  imports: [
    ReactiveFormsModule,
    TranslocoPipe,
    ButtonModule,
    DialogModule,
    InputTextModule,
    MessageModule,
    SelectModule,
    SkeletonModule,
    TextareaModule,
  ],
  template: `
    <p-dialog
      [header]="'adminEdit.title' | transloco"
      [visible]="visible()"
      (visibleChange)="visible.set($event)"
      [modal]="true"
      [style]="{ width: 'min(44rem, calc(100vw - 2rem))' }"
      (onShow)="load()"
    >
      @if (loading()) {
        <p-skeleton height="16rem" />
      } @else if (confirmDelete()) {
        <p class="mt-0">{{ 'adminEdit.deleteConfirm' | transloco }}</p>
        @if (error(); as error) {
          <p-message severity="error" [text]="error | transloco" />
        }
        <div class="mt-4 flex justify-end gap-2">
          <p-button [label]="'account.cancel' | transloco" severity="secondary" [text]="true" (onClick)="confirmDelete.set(false)" />
          <p-button [label]="'adminEdit.delete' | transloco" icon="pi pi-trash" severity="danger" [loading]="busy()" (onClick)="remove()" />
        </div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="save()" class="flex flex-col gap-4" novalidate>
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="flex flex-col gap-2">
              <label for="admin-author" class="text-sm font-medium">{{ 'adminEdit.author' | transloco }}</label>
              <input pInputText id="admin-author" formControlName="author" autocapitalize="none" spellcheck="false" fluid />
              <small class="text-surface-500">{{ 'adminEdit.authorHint' | transloco }}</small>
            </div>
            <div class="flex flex-col gap-2">
              <label for="admin-status" class="text-sm font-medium">{{ 'adminEdit.status' | transloco }}</label>
              <p-select inputId="admin-status" formControlName="status" [options]="statuses" [fluid]="true">
                <ng-template #selectedItem let-value>{{ 'admin.status.' + value | transloco }}</ng-template>
                <ng-template #item let-value>{{ 'admin.status.' + value | transloco }}</ng-template>
              </p-select>
            </div>
          </div>
          <div class="flex flex-col gap-2">
            <label for="admin-notes" class="text-sm font-medium">{{ 'community.profile.notes.title' | transloco }}</label>
            <textarea pTextarea id="admin-notes" formControlName="notes" rows="3" [maxlength]="2000" fluid></textarea>
          </div>
          <div class="flex flex-col gap-2">
            <label for="admin-file" class="text-sm font-medium">{{ 'adminEdit.file' | transloco }}</label>
            <textarea pTextarea id="admin-file" formControlName="file" rows="12" class="font-mono text-xs" spellcheck="false" fluid></textarea>
          </div>

          @if (issues().length) {
            <ul class="m-0 flex flex-col gap-1 rounded-lg border border-red-300 p-3 pl-7 text-sm dark:border-red-900" role="alert">
              @for (issue of issues(); track $index) {
                <li>{{ issueKey(issue) | transloco }} <code class="text-xs text-surface-500">{{ issue.path }}</code></li>
              }
            </ul>
          }
          @if (error(); as error) {
            <p-message severity="error" [text]="error | transloco" />
          }

          <div class="flex flex-wrap justify-between gap-2">
            <p-button [label]="'adminEdit.delete' | transloco" icon="pi pi-trash" severity="danger" [text]="true" (onClick)="confirmDelete.set(true)" />
            <div class="flex gap-2">
              <p-button [label]="'account.cancel' | transloco" severity="secondary" [text]="true" (onClick)="visible.set(false)" />
              <p-button type="submit" [label]="'account.save' | transloco" [loading]="busy()" [disabled]="form.invalid" />
            </div>
          </div>
        </form>
      }
    </p-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminProfileDialog {
  private readonly community = inject(CommunityService);
  private readonly messages = inject(MessageService);
  private readonly transloco = inject(TranslocoService);

  readonly profileId = input.required<string | null>();
  readonly visible = model(false);
  /** Depois de salvar: o slug e a situação novos. */
  readonly saved = output<{ id: string; slug: string; status: string }>();
  readonly deleted = output<string>();

  protected readonly statuses = [...STATUSES];
  protected readonly issueKey = issueKey;
  protected readonly form = inject(FormBuilder).nonNullable.group({
    author: [''],
    status: ['published' as Status],
    notes: ['', Validators.maxLength(2000)],
    file: ['', Validators.required],
  });
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly confirmDelete = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly issues = signal<ProfileIssue[]>([]);
  /** Como estava ao abrir, para mandar só o que mudou. */
  private original = this.form.getRawValue();

  protected async load(): Promise<void> {
    const id = this.profileId();
    if (!id) return;
    this.reset();
    this.loading.set(true);
    try {
      const current = await this.community.adminGet(id);
      if (!current) throw new PublishError('not_found', []);
      const file = { format: current.format, version: current.version, profile: current.profile, testedOn: current.testedOn };
      this.form.reset({
        author: current.author ?? '',
        status: current.status,
        notes: current.notes,
        file: JSON.stringify(file, null, 2),
      });
      this.original = this.form.getRawValue();
    } catch (error) {
      this.error.set(this.errorKey(error));
    } finally {
      this.loading.set(false);
    }
  }

  protected async save(): Promise<void> {
    const id = this.profileId();
    if (!id) return;
    const value = this.form.getRawValue();
    const changes: AdminChanges = {};
    if (value.file !== this.original.file) changes['file'] = value.file;
    if (value.notes !== this.original.notes) changes['notes'] = value.notes;
    if (value.status !== this.original.status) changes['status'] = value.status;
    if (value.author.trim() !== this.original.author) changes['author'] = value.author.trim() || null;
    await this.run(async () => {
      const result = await this.community.adminUpdate(id, changes);
      this.visible.set(false);
      this.toast('adminEdit.saved');
      this.saved.emit(result);
    });
  }

  protected async remove(): Promise<void> {
    const id = this.profileId();
    if (!id) return;
    await this.run(async () => {
      await this.community.adminDelete(id);
      this.visible.set(false);
      this.toast('adminEdit.deleted');
      this.deleted.emit(id);
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set(null);
    this.issues.set([]);
    this.busy.set(true);
    try {
      await action();
    } catch (error) {
      if (error instanceof PublishError && error.issues.length) this.issues.set(error.issues);
      this.error.set(this.errorKey(error));
    } finally {
      this.busy.set(false);
    }
  }

  private reset(): void {
    this.confirmDelete.set(false);
    this.error.set(null);
    this.issues.set([]);
  }

  private errorKey(error: unknown): string {
    if (error instanceof PublishError) {
      return error.code === 'invalid_profile' ? 'publish.invalid.title' : authErrorKey({ code: error.code });
    }
    return authErrorKey(error);
  }

  private toast(key: string): void {
    this.messages.add({ severity: 'success', summary: this.transloco.translate(key), life: 3000 });
  }
}
