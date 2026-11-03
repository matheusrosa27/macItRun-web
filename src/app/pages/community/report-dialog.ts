import { ChangeDetectionStrategy, Component, inject, input, model, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';
import { RadioButtonModule } from 'primeng/radiobutton';
import { TextareaModule } from 'primeng/textarea';
import { authErrorKey } from '../../core/auth/auth-errors';
import { REPORT_REASONS, ReportReason, ReportTarget } from '../../core/community/community';
import { CommunityService } from '../../core/community/community.service';

const DETAIL_MAX = 500;

/** Denunciar um perfil de configuração ou um comentário. Quem abre já conferiu o login. */
@Component({
  selector: 'app-report-dialog',
  imports: [ReactiveFormsModule, TranslocoPipe, ButtonModule, DialogModule, MessageModule, RadioButtonModule, TextareaModule],
  template: `
    <p-dialog
      [header]="'report.title' | transloco"
      [visible]="visible()"
      (visibleChange)="visible.set($event)"
      [modal]="true"
      [dismissableMask]="true"
      [style]="{ width: 'min(30rem, calc(100vw - 2rem))' }"
      (onShow)="form.reset({ reason: null, detail: '' }); error.set(null)"
    >
      <form [formGroup]="form" (ngSubmit)="send()" class="flex flex-col gap-4" novalidate>
        <fieldset class="m-0 flex flex-col gap-3 border-0 p-0">
          <legend class="mb-3 p-0 text-sm font-medium">{{ 'report.reasonLabel' | transloco }}</legend>
          @for (reason of reasons; track reason) {
            <div class="flex items-start gap-2">
              <p-radiobutton [inputId]="'report-' + reason" formControlName="reason" [value]="reason" />
              <label [for]="'report-' + reason" class="text-sm">{{ 'report.reasons.' + reason | transloco }}</label>
            </div>
          }
        </fieldset>
        <div class="flex flex-col gap-2">
          <label for="report-detail" class="text-sm font-medium">{{ 'report.detail' | transloco }}</label>
          <textarea pTextarea id="report-detail" formControlName="detail" rows="3" [maxlength]="detailMax" fluid></textarea>
        </div>
        @if (error(); as error) {
          <p-message severity="error" [text]="error | transloco" />
        }
        <div class="flex justify-end gap-2">
          <p-button [label]="'account.cancel' | transloco" severity="secondary" [text]="true" (onClick)="visible.set(false)" />
          <p-button type="submit" [label]="'report.submit' | transloco" severity="danger" [disabled]="form.invalid" [loading]="sending()" />
        </div>
      </form>
    </p-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportDialog {
  private readonly community = inject(CommunityService);
  private readonly messages = inject(MessageService);
  private readonly transloco = inject(TranslocoService);

  readonly target = input.required<ReportTarget | null>();
  readonly visible = model(false);

  protected readonly reasons = REPORT_REASONS;
  protected readonly detailMax = DETAIL_MAX;
  protected readonly form = inject(FormBuilder).group({
    reason: [null as ReportReason | null, Validators.required],
    detail: ['', Validators.maxLength(DETAIL_MAX)],
  });
  protected readonly sending = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async send(): Promise<void> {
    const target = this.target();
    const { reason, detail } = this.form.getRawValue();
    if (!target || !reason) return;
    this.sending.set(true);
    this.error.set(null);
    try {
      await this.community.report(target, reason, detail ?? '');
      this.visible.set(false);
      this.messages.add({ severity: 'success', summary: this.transloco.translate('report.done'), life: 3000 });
    } catch (error) {
      this.error.set(authErrorKey(error));
    } finally {
      this.sending.set(false);
    }
  }
}
