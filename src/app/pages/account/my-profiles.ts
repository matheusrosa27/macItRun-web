import { ChangeDetectionStrategy, Component, inject, input, resource, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { authErrorKey } from '../../core/auth/auth-errors';
import { MyProfile } from '../../core/community/community';
import { CommunityService } from '../../core/community/community.service';
import { Lang } from '../../core/i18n/langs';

const NOTES_MAX = 2000;

/** Os perfis de configuração da pessoa: editar as notas ("Como foi") e despublicar. */
@Component({
  selector: 'app-my-profiles',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslocoPipe,
    ButtonModule,
    DialogModule,
    MessageModule,
    SkeletonModule,
    TagModule,
    TextareaModule,
  ],
  template: `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3 class="m-0 text-lg font-semibold">{{ 'account.profiles.title' | transloco }}</h3>
      <a pButton [routerLink]="['/', lang(), 'community', 'publish']" size="small" [outlined]="true">
        <i class="pi pi-plus" pButtonIcon></i>
        <span pButtonLabel>{{ 'publish.title' | transloco }}</span>
      </a>
    </div>

    @if (profiles.error()) {
      <p-message class="mt-4 block" severity="error" [text]="'auth.errors.generic' | transloco" />
    } @else if (profiles.value(); as list) {
      @if (list.length) {
        <ul class="m-0 mt-4 flex list-none flex-col gap-3 p-0">
          @for (p of list; track p.id) {
            <li class="flex flex-wrap items-center gap-3 rounded-xl border border-surface-200 p-4 dark:border-surface-800">
              <div class="min-w-0 flex-1">
                @if (p.status === 'published') {
                  <a [routerLink]="['/', lang(), 'community', p.id, p.slug]" class="font-medium text-primary break-words">{{ p.name }}</a>
                } @else {
                  <span class="font-medium break-words">{{ p.name }}</span>
                }
                <div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-surface-500 dark:text-surface-400">
                  <p-tag
                    [value]="'account.profiles.status.' + p.status | transloco"
                    [severity]="p.status === 'published' ? 'success' : p.status === 'hidden' ? 'warn' : 'secondary'"
                  />
                  <span><i class="pi pi-heart text-xs" aria-hidden="true"></i> {{ p.likes }}</span>
                  <span><i class="pi pi-comment text-xs" aria-hidden="true"></i> {{ p.comments }}</span>
                  <span><i class="pi pi-download text-xs" aria-hidden="true"></i> {{ p.downloads }}</span>
                </div>
              </div>
              @if (p.status !== 'removed') {
                <div class="flex gap-1">
                  <p-button
                    icon="pi pi-pencil"
                    [label]="'account.profiles.editNotes' | transloco"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="editNotes(p)"
                  />
                  <p-button
                    icon="pi pi-eye-slash"
                    [label]="'account.profiles.unpublish' | transloco"
                    severity="danger"
                    [text]="true"
                    size="small"
                    (onClick)="confirmUnpublish.set(p)"
                  />
                </div>
              }
            </li>
          }
        </ul>
      } @else {
        <p class="mt-4 mb-0 text-surface-600 dark:text-surface-400">{{ 'account.profiles.empty' | transloco }}</p>
      }
    } @else {
      <p-skeleton class="mt-4 block" height="4rem" borderRadius="0.75rem" />
    }

    <!-- Editar notas -->
    <p-dialog
      [header]="'account.profiles.editNotes' | transloco"
      [visible]="!!editing()"
      (visibleChange)="$event || editing.set(null)"
      [modal]="true"
      [dismissableMask]="true"
      [style]="{ width: 'min(36rem, calc(100vw - 2rem))' }"
    >
      <form [formGroup]="notesForm" (ngSubmit)="saveNotes()" class="flex flex-col gap-3" novalidate>
        <label for="my-notes" class="text-sm font-medium">{{ 'community.profile.notes.title' | transloco }}</label>
        <textarea pTextarea id="my-notes" formControlName="notes" rows="6" [maxlength]="notesMax" fluid></textarea>
        <small class="text-surface-500 dark:text-surface-400">
          {{ 'community.comments.counter' | transloco: { count: notesForm.controls.notes.value.length, max: notesMax } }}
        </small>
        @if (error(); as error) {
          <p-message severity="error" [text]="error | transloco" />
        }
        <div class="flex justify-end gap-2">
          <p-button [label]="'account.cancel' | transloco" severity="secondary" [text]="true" (onClick)="editing.set(null)" />
          <p-button type="submit" [label]="'account.save' | transloco" [loading]="busy()" [disabled]="notesForm.invalid" />
        </div>
      </form>
    </p-dialog>

    <!-- Despublicar -->
    <p-dialog
      [header]="'account.profiles.unpublish' | transloco"
      [visible]="!!confirmUnpublish()"
      (visibleChange)="$event || confirmUnpublish.set(null)"
      [modal]="true"
      [dismissableMask]="true"
      [style]="{ width: 'min(28rem, calc(100vw - 2rem))' }"
    >
      <p class="mt-0">{{ 'account.profiles.unpublishConfirm' | transloco }}</p>
      @if (error(); as error) {
        <p-message severity="error" [text]="error | transloco" />
      }
      <div class="mt-4 flex justify-end gap-2">
        <p-button [label]="'account.cancel' | transloco" severity="secondary" [text]="true" (onClick)="confirmUnpublish.set(null)" />
        <p-button [label]="'account.profiles.unpublish' | transloco" severity="danger" [loading]="busy()" (onClick)="unpublish()" />
      </div>
    </p-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyProfiles {
  private readonly community = inject(CommunityService);
  private readonly messages = inject(MessageService);
  private readonly transloco = inject(TranslocoService);

  readonly lang = input.required<Lang>();

  protected readonly notesMax = NOTES_MAX;
  protected readonly profiles = resource({ loader: () => this.community.myProfiles() });
  protected readonly editing = signal<MyProfile | null>(null);
  protected readonly confirmUnpublish = signal<MyProfile | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notesForm = inject(FormBuilder).nonNullable.group({
    notes: ['', Validators.maxLength(NOTES_MAX)],
  });

  protected editNotes(profile: MyProfile): void {
    this.error.set(null);
    this.notesForm.reset({ notes: profile.notes });
    this.editing.set(profile);
  }

  protected async saveNotes(): Promise<void> {
    const profile = this.editing();
    if (!profile) return;
    await this.run(async () => {
      await this.community.updateNotes(profile.id, this.notesForm.getRawValue().notes);
      this.editing.set(null);
      this.toast('account.profiles.notesSaved');
    });
  }

  protected async unpublish(): Promise<void> {
    const profile = this.confirmUnpublish();
    if (!profile) return;
    await this.run(async () => {
      await this.community.unpublish(profile.id);
      this.confirmUnpublish.set(null);
      this.toast('account.profiles.unpublished');
    });
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await fn();
      this.profiles.reload();
    } catch (error) {
      this.error.set(authErrorKey(error));
    } finally {
      this.busy.set(false);
    }
  }

  private toast(key: string): void {
    this.messages.add({ severity: 'success', summary: this.transloco.translate(key), life: 3000 });
  }
}
