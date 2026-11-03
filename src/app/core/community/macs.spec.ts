import { isKnownMac, macName } from './macs';

describe('macName', () => {
  it('dá o nome do Mac pelo identificador', () => {
    expect(macName('Mac17,5')).toBe('MacBook Neo (A18 Pro, 2026)');
    expect(macName('Mac16,12')).toBe('MacBook Air 13″ (M4, 2025)');
    expect(macName('Mac17,2')).toBe('MacBook Pro 14″ (M5, 2025)');
    expect(macName('Mac16,10')).toBe('Mac mini (M4, 2024)');
    expect(macName('Mac17,3')).toBe('MacBook Air 13″ (M5)');
  });

  it('mostra como veio um identificador que não conhece', () => {
    expect(macName('Mac99,1')).toBe('Mac99,1');
    expect(isKnownMac('Mac99,1')).toBeFalse();
    expect(isKnownMac('Mac17,5')).toBeTrue();
  });

  it('não confunde com propriedades de objeto', () => {
    expect(macName('toString')).toBe('toString');
    expect(isKnownMac('constructor')).toBeFalse();
  });
});
