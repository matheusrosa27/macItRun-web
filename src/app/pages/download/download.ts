import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, resource } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { SkeletonModule } from 'primeng/skeleton';
import { HTML_LANG, Lang } from '../../core/i18n/langs';
import { ReleaseService } from '../../core/release/release.service';
import { INSTALL_COMMAND, LATEST_ZIP_URL, RELEASES_URL } from '../../core/site';

@Component({
  selector: 'app-download',
  imports: [TranslocoPipe, ButtonModule, MessageModule, SkeletonModule],
  templateUrl: './download.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Download {
  private readonly messages = inject(MessageService);
  private readonly transloco = inject(TranslocoService);
  private readonly releases = inject(ReleaseService);
  private readonly document = inject(DOCUMENT);

  /** Vem do parâmetro :lang da rota pai, já validado. */
  readonly lang = input.required<Lang>();

  protected readonly installCommand = INSTALL_COMMAND;
  protected readonly releasesUrl = RELEASES_URL;
  protected readonly requirements = ['appleSilicon', 'macos', 'rosetta'];
  protected readonly openAnywaySteps = ['unzip', 'drag', 'open', 'settings', 'confirm'];

  protected readonly release = resource({ loader: () => this.releases.latest() });

  /** Sem resposta do GitHub, o botão ainda baixa a release mais recente. */
  protected readonly zipUrl = computed(() => this.release.value()?.zipUrl ?? LATEST_ZIP_URL);

  private readonly locale = computed(() => HTML_LANG[this.lang()]);

  protected readonly publishedAt = computed(() => {
    const date = this.release.value()?.publishedAt;
    return date ? new Intl.DateTimeFormat(this.locale(), { dateStyle: 'long' }).format(new Date(date)) : '';
  });

  protected readonly zipSize = computed(() => {
    const bytes = this.release.value()?.zipSize;
    if (!bytes) return '';
    return new Intl.NumberFormat(this.locale(), {
      style: 'unit',
      unit: 'megabyte',
      maximumFractionDigits: 1,
    }).format(bytes / 1_000_000);
  });

  protected async copyCommand(): Promise<void> {
    const copied = await this.copy(this.installCommand);
    this.messages.add(
      copied
        ? { severity: 'success', summary: this.transloco.translate('download.install.copied'), life: 2500 }
        : { severity: 'warn', summary: this.transloco.translate('download.install.copyFailed'), life: 4000 },
    );
  }

  /** API de área de transferência; sem permissão, tenta o jeito antigo com um campo oculto. */
  private async copy(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const field = this.document.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      this.document.body.appendChild(field);
      field.select();
      const copied = this.document.execCommand('copy');
      field.remove();
      return copied;
    }
  }
}
