// Formato .macitrun-profile, versão 1, em Zod. Usado pelo site (Angular) e pela API (Edge
// Functions). As regras são as de profile.schema.json, que é a fonte única copiada para o app;
// os testes rodam os mesmos casos nos dois e conferem que concordam.
import { z } from 'zod';

export const PROFILE_FORMAT = 'macitrun-profile';
export const PROFILE_VERSION = 1;
/** Tamanho máximo do arquivo inteiro, em bytes UTF-8. */
export const MAX_PROFILE_BYTES = 16 * 1024;
export const PROFILE_EXTENSION = '.macitrun-profile';

export const GRAPHICS = ['dxmt', 'dxvk', 'wine'] as const;
export const WINDOWS_VERSIONS = ['win11', 'win10', 'win81', 'win8', 'win7', 'winxp'] as const;
export const LOAD_ORDERS = ['native', 'builtin', 'native,builtin', 'builtin,native', 'disabled', ''] as const;
/**
 * Apps do catálogo "Apps prontos" do macItRun (Resources/apps.json no app) que um jogo pode exigir:
 * a loja onde ele é comprado/instalado ou um launcher obrigatório. O app só instala o que está no
 * catálogo dele, sempre do site oficial e com a assinatura conferida.
 */
export const REQUIRABLE_APPS = ['steam', 'epic-games', 'gog-galaxy', 'ubisoft-connect', 'ea-app', 'rockstar'] as const;
/** Prefixos das variáveis que só ajustam as camadas gráficas. */
export const ENVIRONMENT_PREFIXES = ['DXVK_', 'DXMT_', 'MVK_CONFIG_', 'MTL_HUD_'] as const;

export type Graphics = (typeof GRAPHICS)[number];
export type WindowsVersion = (typeof WINDOWS_VERSIONS)[number];

/** Configurado pelo próprio macItRun (GraphicsPlan.appsUsingWineDirectX no app). */
const RESERVED_EXECUTABLES = ['steamwebhelper.exe'];
/** Valem para a garrafa inteira: o wineserver e todos os processos precisam concordar. */
const BOTTLE_WIDE_ENVIRONMENT = ['WINEMSYNC', 'WINEESYNC'];
/** Nomes que apontariam para arquivos fora da garrafa. */
const PATH_SUFFIXES = ['PATH', 'FILE', 'DIR'];

// As mesmas quebras de linha que o Character.isNewline do Swift.
const NEWLINE = /[\n\r\u000b\u000c\u0085\u2028\u2029]/;

/** Tamanho em caracteres (code points), como o maxLength do JSON Schema. */
const length = (value: string) => [...value].length;
const maxChars = (max: number, message: string) =>
  z.string().refine((value) => length(value) <= max, { message });
const singleLine = (max: number, message: string) =>
  z.string().refine((value) => length(value) <= max && !NEWLINE.test(value), { message });

const executable = z
  .string()
  .regex(/^[A-Za-z0-9 _.()+-]{1,96}\.exe$/i, { message: 'executable_invalid' })
  .refine((name) => !RESERVED_EXECUTABLES.includes(name.toLowerCase()), {
    message: 'executable_reserved',
  });

const environmentKey = z
  .string()
  .refine((key) => !BOTTLE_WIDE_ENVIRONMENT.includes(key), { message: 'environment_bottle_wide' })
  .refine(
    (key) => ENVIRONMENT_PREFIXES.some((prefix) => key.startsWith(prefix)) && /^[A-Z0-9_]{1,64}$/.test(key),
    { message: 'environment_not_allowed' },
  )
  .refine((key) => !PATH_SUFFIXES.some((suffix) => key.endsWith(suffix)), {
    message: 'environment_path',
  });

const requirableApp = z.enum(REQUIRABLE_APPS, { message: 'requires_app_invalid' });

/** Do que o jogo depende: uma das lojas (com o id do jogo nela) e todos os launchers. */
const requiresSchema = z
  .strictObject({
    stores: z
      .array(
        z.strictObject({
          app: requirableApp,
          id: z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/, { message: 'requires_id_invalid' }),
        }),
      )
      .min(1, { message: 'requires_empty' })
      .max(6, { message: 'requires_too_many' })
      .optional(),
    launchers: z
      .array(requirableApp)
      .min(1, { message: 'requires_empty' })
      .max(6, { message: 'requires_too_many' })
      .refine((apps) => new Set(apps).size === apps.length, { message: 'requires_duplicate' })
      .optional(),
  })
  .refine((value) => value.stores !== undefined || value.launchers !== undefined, {
    message: 'requires_empty',
  });

export const profileSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, { message: 'id_invalid' }),
  name: z
    .string()
    .refine((name) => /\S/.test(name) && length(name) <= 100, { message: 'name_invalid' }),
  executables: z.array(executable).min(1, { message: 'executables_empty' }),
  graphics: z.enum(GRAPHICS).optional(),
  windowsVersion: z.enum(WINDOWS_VERSIONS).optional(),
  dllOverrides: z
    .record(
      z.string().regex(/^[a-z0-9_.-]{1,64}$/, { message: 'dll_invalid' }),
      z.enum(LOAD_ORDERS, { message: 'load_order_invalid' }),
    )
    .optional(),
  environment: z.record(environmentKey, singleLine(256, 'environment_value_invalid')).optional(),
  arguments: z
    .array(singleLine(256, 'argument_invalid'))
    .max(20, { message: 'arguments_too_many' })
    .optional(),
  notes: maxChars(2000, 'notes_too_long').optional(),
  requires: requiresSchema.optional(),
});

const testedValue = z.string().regex(/^[A-Za-z0-9 ._,()+-]{1,64}$/, { message: 'tested_on_invalid' });

export const testedOnSchema = z.strictObject({
  mac: testedValue.optional(),
  macOS: testedValue.optional(),
  runtime: testedValue.optional(),
  app: testedValue.optional(),
});

export const profileFileSchema = z.strictObject({
  format: z.literal(PROFILE_FORMAT),
  version: z.literal(PROFILE_VERSION),
  profile: profileSchema,
  testedOn: testedOnSchema.optional(),
});

export type GameProfile = z.infer<typeof profileSchema>;
export type RequirableApp = (typeof REQUIRABLE_APPS)[number];
export type Requires = z.infer<typeof requiresSchema>;
export type TestedOn = z.infer<typeof testedOnSchema>;
export type ProfileFile = z.infer<typeof profileFileSchema>;

export interface ProfileIssue {
  /** Caminho do campo, ex. `profile.environment.DYLD_INSERT_LIBRARIES`. */
  path: string;
  /** Código da regra, ex. `environment_not_allowed`, `too_large` ou `invalid_json`. */
  code: string;
}

export type ProfileResult = { ok: true; file: ProfileFile } | { ok: false; issues: ProfileIssue[] };

/**
 * Valida um perfil já lido. O resultado tem as chaves na ordem do formato, então
 * `JSON.stringify(file, null, 2)` dá sempre o mesmo arquivo.
 */
export function parseProfileFile(input: unknown): ProfileResult {
  const result = profileFileSchema.safeParse(input);
  if (result.success) return { ok: true, file: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      code: issueCode(issue),
    })),
  };
}

/** As regras próprias têm a mensagem como código; as do Zod (tipo, campo a mais) usam o dele. */
function issueCode(issue: z.core.$ZodIssue): string {
  // Chave de record recusada: o motivo está na regra da chave.
  if (issue.code === 'invalid_key' && issue.issues[0]) return issueCode(issue.issues[0]);
  return /^[a-z_]+$/.test(issue.message) ? issue.message : issue.code;
}

/** Valida o texto de um arquivo .macitrun-profile (colado, enviado ou vindo do app). */
export function parseProfileText(text: string): ProfileResult {
  if (new TextEncoder().encode(text).length > MAX_PROFILE_BYTES) {
    return { ok: false, issues: [{ path: '', code: 'too_large' }] };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ path: '', code: 'invalid_json' }] };
  }
  return parseProfileFile(value);
}

/** O arquivo como o app grava e a API serve: JSON com 2 espaços e quebra de linha no fim. */
export function serializeProfileFile(file: ProfileFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}
