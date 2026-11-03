import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/** Tamanho mínimo da senha. Configure o mesmo valor no Supabase (Auth → Providers → Email). */
export const PASSWORD_MIN = 8;

/** Validador de grupo: `confirm` tem de ser igual a `password`. */
export const passwordsMatch: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
  const password = group.get('password')?.value;
  const confirm = group.get('confirm')?.value;
  return password && confirm && password !== confirm ? { mismatch: true } : null;
};
