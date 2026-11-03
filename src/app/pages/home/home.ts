import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { Lang } from '../../core/i18n/langs';
import { KOFI_URL } from '../../core/site';

interface Feature {
  key: string;
  icon: string;
}

interface TestedGame {
  key: string;
  name: string;
  graphics: string;
}

@Component({
  selector: 'app-home',
  imports: [RouterLink, TranslocoPipe, ButtonModule, TagModule],
  templateUrl: './home.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  /** Vem do parâmetro :lang da rota pai, já validado. */
  readonly lang = input.required<Lang>();

  protected readonly kofiUrl = KOFI_URL;

  protected readonly features: Feature[] = [
    { key: 'layers', icon: 'pi pi-bolt' },
    { key: 'apps', icon: 'pi pi-th-large' },
    { key: 'community', icon: 'pi pi-users' },
    { key: 'updates', icon: 'pi pi-shield' },
  ];

  /** Os perfis que já vêm no app (Sources/MacItRunCore/Resources/profiles.json). */
  protected readonly testedGames: TestedGame[] = [
    { key: 'darkSouls3', name: 'Dark Souls III', graphics: 'DXVK' },
    { key: 'dragonBall', name: 'Dragon Ball Gekishin Squadra', graphics: 'Wine (vkd3d)' },
  ];
}
