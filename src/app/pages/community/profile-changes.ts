import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { GameProfile, TestedOn } from '../../core/community/community';
import { isKnownMac, macName } from '../../core/community/macs';

/** Chave de tradução da ordem de carga de uma DLL ("" e "disabled" desligam a DLL). */
const LOAD_ORDER_KEY: Record<string, string> = {
  native: 'native',
  builtin: 'builtin',
  'native,builtin': 'nativeBuiltin',
  'builtin,native': 'builtinNative',
  disabled: 'disabled',
  '': 'disabled',
};

/**
 * O que um perfil de configuração muda (tabela legível, não o JSON) e onde foi testado. Usado
 * na página do perfil e na prévia antes de publicar. Tudo sai como texto puro.
 */
@Component({
  selector: 'app-profile-changes',
  imports: [TranslocoPipe],
  templateUrl: './profile-changes.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileChanges {
  readonly profile = input.required<GameProfile>();
  readonly testedOn = input<TestedOn>();

  protected readonly dlls = computed(() =>
    Object.entries(this.profile().dllOverrides ?? {}).map(([dll, order]) => ({
      dll,
      order: `community.profile.loadOrder.${LOAD_ORDER_KEY[order] ?? 'disabled'}`,
    })),
  );
  protected readonly environment = computed(() => Object.entries(this.profile().environment ?? {}));
  protected readonly testedRows = computed(() => {
    const tested = this.testedOn() ?? {};
    return (['mac', 'macOS', 'runtime', 'app'] as const).map((key) => {
      const value = tested[key];
      // O Mac aparece pelo nome, com o identificador ao lado (é o que o app grava).
      return key === 'mac' && value && isKnownMac(value)
        ? { key, value: macName(value), detail: value }
        : { key, value, detail: undefined };
    });
  });
}
