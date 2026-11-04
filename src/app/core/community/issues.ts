import type { ProfileIssue } from '@macitrun/profile-schema';

/** Problemas do arquivo que têm mensagem própria (publish.issues.*); os outros usam a genérica. */
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

export function issueKey(issue: ProfileIssue): string {
  return `publish.issues.${ISSUE_CODES.has(issue.code) ? issue.code : 'generic'}`;
}
