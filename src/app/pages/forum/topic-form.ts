import { ChangeDetectionStrategy, Component, effect, inject, input, output, resource, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { AutoCompleteCompleteEvent, AutoCompleteModule, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { TextareaModule } from 'primeng/textarea';
import {
  cleanTag,
  ProfileSummary,
  TOPIC_BODY_MAX,
  TOPIC_PROFILES_MAX,
  TOPIC_TAG_MAX,
  TOPIC_TAGS_MAX,
  TOPIC_TITLE_MAX,
  TOPIC_TITLE_MIN,
  TopicInput,
} from '../../core/community/community';
import { CommunityService } from '../../core/community/community.service';

/** Um perfil de configuração escolhido para citar (só o que a tela precisa mostrar). */
export interface PickedProfile {
  id: string;
  name: string;
}

/** O que o formulário começa preenchido (editar, ou novo tópico vindo de um perfil). */
export interface TopicFormValue {
  title: string;
  body: string;
  tags: string[];
  profiles: PickedProfile[];
}

/**
 * Título, texto, tags e perfis citados de um tópico. Quem usa trata o envio (criar ou salvar)
 * e passa `busy` e `error`. As regras são as mesmas do banco, que confere tudo de novo.
 */
@Component({
  selector: 'app-topic-form',
  imports: [
    FormsModule,
    ReactiveFormsModule,
    TranslocoPipe,
    AutoCompleteModule,
    ButtonModule,
    InputTextModule,
    MessageModule,
    TextareaModule,
  ],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-6" novalidate>
      <div class="flex flex-col gap-2">
        <label for="topic-title" class="font-medium">{{ 'forum.form.titleLabel' | transloco }}</label>
        <input
          pInputText
          id="topic-title"
          formControlName="title"
          [maxlength]="titleMax"
          [placeholder]="'forum.form.titlePlaceholder' | transloco"
          fluid
        />
      </div>

      <div class="flex flex-col gap-2">
        <label for="topic-body" class="font-medium">{{ 'forum.form.bodyLabel' | transloco }}</label>
        <textarea
          pTextarea
          id="topic-body"
          formControlName="body"
          rows="8"
          [maxlength]="bodyMax"
          [autoResize]="true"
          [placeholder]="'forum.form.bodyPlaceholder' | transloco"
          fluid
        ></textarea>
        <small class="text-surface-500 dark:text-surface-400">
          {{ 'forum.form.bodyHelp' | transloco }} ·
          {{ 'community.comments.counter' | transloco: { count: form.controls.body.value.length, max: bodyMax } }}
        </small>
      </div>

      <div class="flex flex-col gap-2">
        <label for="topic-tags" class="font-medium">{{ 'forum.form.tagsLabel' | transloco }}</label>
        <p-autocomplete
          inputId="topic-tags"
          [(ngModel)]="tags"
          [ngModelOptions]="{ standalone: true }"
          (onSelect)="limitTags()"
          [multiple]="true"
          [autoOptionFocus]="true"
          [suggestions]="tagSuggestions()"
          (completeMethod)="suggestTags($event)"
          [minLength]="1"
          [delay]="150"
          [unique]="true"
          [fluid]="true"
          [showEmptyMessage]="false"
          [placeholder]="tags().length ? '' : ('forum.form.tagsPlaceholder' | transloco)"
        >
          <ng-template #selecteditem let-tag>#{{ tag }}</ng-template>
          <ng-template #item let-tag>#{{ tag }}</ng-template>
        </p-autocomplete>
        <small class="text-surface-500 dark:text-surface-400">
          {{ 'forum.form.tagsHelp' | transloco: { max: tagsMax } }}
        </small>
      </div>

      <div class="flex flex-col gap-2">
        <label for="topic-profiles" class="font-medium">{{ 'forum.form.profilesLabel' | transloco }}</label>
        @if (profiles().length) {
          <ul class="m-0 flex list-none flex-col gap-2 p-0">
            @for (profile of profiles(); track profile.id) {
              <li
                class="flex items-center justify-between gap-2 rounded-lg border border-surface-200 px-3 py-2 dark:border-surface-800"
              >
                <span class="min-w-0 truncate">{{ profile.name }}</span>
                <p-button
                  icon="pi pi-times"
                  severity="secondary"
                  [text]="true"
                  [rounded]="true"
                  size="small"
                  [ariaLabel]="'forum.form.removeProfile' | transloco: { name: profile.name }"
                  (onClick)="removeProfile(profile.id)"
                />
              </li>
            }
          </ul>
        }
        @if (profiles().length < profilesMax) {
          <p-autocomplete
            inputId="topic-profiles"
            [ngModel]="profileQuery()"
            (ngModelChange)="profileQuery.set($event)"
            [ngModelOptions]="{ standalone: true }"
            [suggestions]="profileSuggestions()"
            (completeMethod)="suggestProfiles($event)"
            (onSelect)="addProfile($event)"
            optionLabel="name"
            [autoOptionFocus]="true"
            [minLength]="2"
            [delay]="250"
            [fluid]="true"
            [showEmptyMessage]="false"
            [placeholder]="'forum.form.profilesPlaceholder' | transloco"
          >
            <ng-template #item let-profile>
              <div class="flex min-w-0 flex-col">
                <span class="truncate">{{ profile.name }}</span>
                <span class="truncate font-mono text-xs text-surface-500 dark:text-surface-400">{{
                  profile.executables.join(', ')
                }}</span>
              </div>
            </ng-template>
          </p-autocomplete>
        }
        <small class="text-surface-500 dark:text-surface-400">
          {{ 'forum.form.profilesHelp' | transloco: { max: profilesMax } }}
        </small>
      </div>

      @if (error(); as error) {
        <p-message severity="error" [text]="error | transloco" />
      }

      <div class="flex flex-wrap justify-end gap-2">
        @if (cancellable()) {
          <p-button [label]="'account.cancel' | transloco" severity="secondary" [text]="true" (onClick)="cancelled.emit()" />
        }
        <p-button type="submit" [label]="submitLabel() | transloco" icon="pi pi-send" [loading]="busy()" [disabled]="form.invalid" />
      </div>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopicForm {
  private readonly community = inject(CommunityService);

  readonly initial = input<TopicFormValue | null>(null);
  /** Chave de tradução do botão de envio. */
  readonly submitLabel = input('forum.form.submit');
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  readonly cancellable = input(false);
  readonly submitted = output<TopicInput>();
  readonly cancelled = output<void>();

  protected readonly titleMax = TOPIC_TITLE_MAX;
  protected readonly bodyMax = TOPIC_BODY_MAX;
  protected readonly tagsMax = TOPIC_TAGS_MAX;
  protected readonly profilesMax = TOPIC_PROFILES_MAX;

  protected readonly form = inject(FormBuilder).nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(TOPIC_TITLE_MIN), Validators.maxLength(TOPIC_TITLE_MAX), Validators.pattern(/\S/)]],
    body: ['', [Validators.required, Validators.maxLength(TOPIC_BODY_MAX), Validators.pattern(/\S/)]],
  });
  protected readonly tags = signal<string[]>([]);
  protected readonly profiles = signal<PickedProfile[]>([]);

  private readonly popularTags = resource({ loader: () => this.community.topicTags() });
  protected readonly tagSuggestions = signal<string[]>([]);
  protected readonly profileQuery = signal<string | ProfileSummary | null>('');
  protected readonly profileSuggestions = signal<ProfileSummary[]>([]);

  constructor() {
    // Preenche com o valor inicial quando ele chega (editar, ou ?profile= no novo tópico).
    effect(() => {
      const value = this.initial();
      if (!value) return;
      this.form.reset({ title: value.title, body: value.body });
      this.tags.set(value.tags.slice(0, TOPIC_TAGS_MAX));
      this.profiles.set(value.profiles.slice(0, TOPIC_PROFILES_MAX));
    });
  }

  /** O que foi digitado (já normalizado) vem primeiro, seguido das tags parecidas que já existem. */
  protected suggestTags(event: AutoCompleteCompleteEvent): void {
    const typed = cleanTag(event.query).slice(0, TOPIC_TAG_MAX);
    const chosen = new Set(this.tags());
    const known = (this.popularTags.value() ?? []).map((t) => t.tag).filter((tag) => !typed || tag.includes(typed));
    this.tagSuggestions.set([...new Set([typed, ...known])].filter((tag) => tag && !chosen.has(tag)).slice(0, 8));
  }

  /** As sugestões já vêm normalizadas; aqui só o limite de 5. */
  protected limitTags(): void {
    if (this.tags().length > TOPIC_TAGS_MAX) this.tags.update((list) => list.slice(0, TOPIC_TAGS_MAX));
  }

  protected async suggestProfiles(event: AutoCompleteCompleteEvent): Promise<void> {
    try {
      const page = await this.community.list({ q: event.query, sort: 'likes' });
      const chosen = new Set(this.profiles().map((p) => p.id));
      this.profileSuggestions.set(page.items.filter((p) => !chosen.has(p.id)).slice(0, 8));
    } catch {
      this.profileSuggestions.set([]);
    }
  }

  protected addProfile(event: AutoCompleteSelectEvent): void {
    const profile = event.value as ProfileSummary;
    this.profiles.update((list) =>
      list.some((p) => p.id === profile.id) || list.length >= TOPIC_PROFILES_MAX
        ? list
        : [...list, { id: profile.id, name: profile.name }],
    );
    this.profileQuery.set('');
  }

  protected removeProfile(id: string): void {
    this.profiles.update((list) => list.filter((p) => p.id !== id));
  }

  protected submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy()) return;
    const { title, body } = this.form.getRawValue();
    this.submitted.emit({ title, body, tags: this.tags(), profileIds: this.profiles().map((p) => p.id) });
  }
}
