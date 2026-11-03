/**
 * Nome dos Macs pelo identificador de modelo que o app grava em testedOn.mac (o `hw.model` do
 * macOS, ex. "Mac17,5"). Só Macs com Apple silicon, que são os que rodam o macItRun.
 *
 * Fontes: as páginas "Identify your Mac" da Apple (support.apple.com/108052, 102869, 102852,
 * 108054, 102231, 102887) e, para a MacBook Neo, Geekbench/EveryMac/iFixit (Mac17,5).
 * São nomes de produto: iguais em todos os idiomas.
 */
interface MacModel {
  family: string;
  /** Tamanho da tela, em polegadas. */
  inches?: number;
  chip: string;
  year?: number;
}

const MODELS: Record<string, MacModel> = {
  // MacBook Neo
  'Mac17,5': { family: 'MacBook Neo', chip: 'A18 Pro', year: 2026 },
  // MacBook Air
  'MacBookAir10,1': { family: 'MacBook Air', inches: 13, chip: 'M1', year: 2020 },
  'Mac14,2': { family: 'MacBook Air', inches: 13, chip: 'M2', year: 2022 },
  'Mac14,15': { family: 'MacBook Air', inches: 15, chip: 'M2', year: 2023 },
  'Mac15,12': { family: 'MacBook Air', inches: 13, chip: 'M3', year: 2024 },
  'Mac15,13': { family: 'MacBook Air', inches: 15, chip: 'M3', year: 2024 },
  'Mac16,12': { family: 'MacBook Air', inches: 13, chip: 'M4', year: 2025 },
  'Mac16,13': { family: 'MacBook Air', inches: 15, chip: 'M4', year: 2025 },
  'Mac17,3': { family: 'MacBook Air', inches: 13, chip: 'M5' },
  'Mac17,4': { family: 'MacBook Air', inches: 15, chip: 'M5' },
  // MacBook Pro
  'MacBookPro17,1': { family: 'MacBook Pro', inches: 13, chip: 'M1', year: 2020 },
  'MacBookPro18,1': { family: 'MacBook Pro', inches: 16, chip: 'M1 Pro', year: 2021 },
  'MacBookPro18,2': { family: 'MacBook Pro', inches: 16, chip: 'M1 Max', year: 2021 },
  'MacBookPro18,3': { family: 'MacBook Pro', inches: 14, chip: 'M1 Pro', year: 2021 },
  'MacBookPro18,4': { family: 'MacBook Pro', inches: 14, chip: 'M1 Max', year: 2021 },
  'Mac14,7': { family: 'MacBook Pro', inches: 13, chip: 'M2', year: 2022 },
  'Mac14,9': { family: 'MacBook Pro', inches: 14, chip: 'M2 Pro', year: 2023 },
  'Mac14,5': { family: 'MacBook Pro', inches: 14, chip: 'M2 Max', year: 2023 },
  'Mac14,10': { family: 'MacBook Pro', inches: 16, chip: 'M2 Pro', year: 2023 },
  'Mac14,6': { family: 'MacBook Pro', inches: 16, chip: 'M2 Max', year: 2023 },
  'Mac15,3': { family: 'MacBook Pro', inches: 14, chip: 'M3', year: 2023 },
  'Mac15,6': { family: 'MacBook Pro', inches: 14, chip: 'M3 Pro', year: 2023 },
  'Mac15,8': { family: 'MacBook Pro', inches: 14, chip: 'M3 Max', year: 2023 },
  'Mac15,10': { family: 'MacBook Pro', inches: 14, chip: 'M3 Max', year: 2023 },
  'Mac15,7': { family: 'MacBook Pro', inches: 16, chip: 'M3 Pro', year: 2023 },
  'Mac15,9': { family: 'MacBook Pro', inches: 16, chip: 'M3 Max', year: 2023 },
  'Mac15,11': { family: 'MacBook Pro', inches: 16, chip: 'M3 Max', year: 2023 },
  'Mac16,1': { family: 'MacBook Pro', inches: 14, chip: 'M4', year: 2024 },
  'Mac16,8': { family: 'MacBook Pro', inches: 14, chip: 'M4 Pro', year: 2024 },
  'Mac16,6': { family: 'MacBook Pro', inches: 14, chip: 'M4 Max', year: 2024 },
  'Mac16,7': { family: 'MacBook Pro', inches: 16, chip: 'M4 Pro', year: 2024 },
  'Mac16,5': { family: 'MacBook Pro', inches: 16, chip: 'M4 Max', year: 2024 },
  'Mac17,2': { family: 'MacBook Pro', inches: 14, chip: 'M5', year: 2025 },
  // A Apple lista os dois identificadores de cada tamanho como "M5 Pro ou M5 Max".
  'Mac17,7': { family: 'MacBook Pro', inches: 14, chip: 'M5 Pro/Max', year: 2026 },
  'Mac17,9': { family: 'MacBook Pro', inches: 14, chip: 'M5 Pro/Max', year: 2026 },
  'Mac17,6': { family: 'MacBook Pro', inches: 16, chip: 'M5 Pro/Max', year: 2026 },
  'Mac17,8': { family: 'MacBook Pro', inches: 16, chip: 'M5 Pro/Max', year: 2026 },
  // iMac
  'iMac21,1': { family: 'iMac', inches: 24, chip: 'M1', year: 2021 },
  'iMac21,2': { family: 'iMac', inches: 24, chip: 'M1', year: 2021 },
  'Mac15,4': { family: 'iMac', inches: 24, chip: 'M3', year: 2023 },
  'Mac15,5': { family: 'iMac', inches: 24, chip: 'M3', year: 2023 },
  'Mac16,2': { family: 'iMac', inches: 24, chip: 'M4', year: 2024 },
  'Mac16,3': { family: 'iMac', inches: 24, chip: 'M4', year: 2024 },
  // Mac mini
  'Macmini9,1': { family: 'Mac mini', chip: 'M1', year: 2020 },
  'Mac14,3': { family: 'Mac mini', chip: 'M2', year: 2023 },
  'Mac14,12': { family: 'Mac mini', chip: 'M2 Pro', year: 2023 },
  'Mac16,10': { family: 'Mac mini', chip: 'M4', year: 2024 },
  'Mac16,11': { family: 'Mac mini', chip: 'M4 Pro', year: 2024 },
  'Mac17,16': { family: 'Mac mini', chip: 'M5 Pro' },
  'Mac18,5': { family: 'Mac mini', chip: 'M6' },
  // Mac Studio
  'Mac13,1': { family: 'Mac Studio', chip: 'M1 Max', year: 2022 },
  'Mac13,2': { family: 'Mac Studio', chip: 'M1 Ultra', year: 2022 },
  'Mac14,13': { family: 'Mac Studio', chip: 'M2 Max', year: 2023 },
  'Mac14,14': { family: 'Mac Studio', chip: 'M2 Ultra', year: 2023 },
  'Mac15,14': { family: 'Mac Studio', chip: 'M3 Ultra', year: 2025 },
  'Mac16,9': { family: 'Mac Studio', chip: 'M4 Max', year: 2025 },
  'Mac17,14': { family: 'Mac Studio', chip: 'M5 Max' },
  'Mac17,15': { family: 'Mac Studio', chip: 'M5 Ultra' },
  // Mac Pro
  'Mac14,8': { family: 'Mac Pro', chip: 'M2 Ultra', year: 2023 },
};

/**
 * "MacBook Air 13″ (M4, 2025)". Identificador desconhecido (um Mac lançado depois desta
 * lista) aparece como veio, para não esconder a informação.
 */
export function macName(identifier: string): string {
  if (!isKnownMac(identifier)) return identifier;
  const model = MODELS[identifier];
  const size = model.inches ? ` ${model.inches}″` : '';
  const details = [model.chip, model.year].filter(Boolean).join(', ');
  return `${model.family}${size} (${details})`;
}

/** Se o identificador está na lista (para mostrar o código ao lado do nome só quando ajuda). */
export function isKnownMac(identifier: string): boolean {
  return Object.hasOwn(MODELS, identifier);
}
