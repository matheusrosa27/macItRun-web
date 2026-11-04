import { BADGE_STYLE, BADGES, knownBadges } from './badges';

describe('badges', () => {
  it('mantém as conhecidas, na ordem, e ignora as desconhecidas', () => {
    expect(knownBadges(['admin', 'novidade', 'pioneer'])).toEqual(['admin', 'pioneer']);
    expect(knownBadges(undefined)).toEqual([]);
  });

  it('toda tag tem aparência', () => {
    for (const badge of BADGES) expect(BADGE_STYLE[badge]).toBeDefined();
  });
});
