/**
 * Tags públicas ao lado do nome de usuário. As regras ficam no banco (private.user_badges,
 * migração 20261103160000_badges.sql); aqui só a aparência, na ordem em que o banco devolve.
 */
export const BADGES = ['admin', 'legend', 'veteran', 'contributor', 'newcomer', 'pioneer'] as const;
export type Badge = (typeof BADGES)[number];

type Severity = 'danger' | 'warn' | 'info' | 'success' | 'secondary' | 'contrast';

export const BADGE_STYLE: Record<Badge, { icon: string; severity: Severity }> = {
  admin: { icon: 'pi pi-shield', severity: 'danger' },
  legend: { icon: 'pi pi-star-fill', severity: 'warn' },
  veteran: { icon: 'pi pi-star', severity: 'info' },
  contributor: { icon: 'pi pi-check-circle', severity: 'success' },
  newcomer: { icon: 'pi pi-user-plus', severity: 'secondary' },
  pioneer: { icon: 'pi pi-flag', severity: 'contrast' },
};

/** Só as tags conhecidas (uma tag nova da API aparece depois de o site saber mostrá-la). */
export function knownBadges(badges: readonly string[] | undefined): Badge[] {
  return (badges ?? []).filter((b): b is Badge => (BADGES as readonly string[]).includes(b));
}
