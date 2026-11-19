// Paměť Vency: poslední hlášky do zadání a kontrola opakovaných obratů (17.–19. 11. 2026 třikrát za
// sebou „Jardo, ani nic neříkej“).

import { describe, expect, it } from 'vitest';
import { loadRecent, RECENT_KEY, RECENT_MAX, recentBlock, repeatedPhrases, repeatNotes, withLine, type RecentLine } from '../src/memory.ts';
import type { Store } from '../src/storage.ts';

const memStore = (files: Record<string, string>): Store => ({
  label: 'paměť',
  get: async (key) => files[key] ?? null,
  put: async (key, body) => {
    files[key] = body;
  },
});

const recent: RecentLine[] = [
  { id: '2026-11-18-ranni-pivo', hlaska: 'Pastrňák zase rozdával. Jardo, ani nic neříkej.' },
  { id: '2026-11-17-ranni-pivo', hlaska: 'Znám to, já takhle chytal celou sezónu ’91.' },
];

describe('paměť hlášek', () => {
  it('opakovaný obrat najde i s jinou interpunkcí a bez diakritiky, krátkou shodu ne', () => {
    expect(repeatedPhrases('Kubala dal tři góly. Jardo, ani nic neříkej.', recent)).toEqual(['Jardo, ani nic neříkej.']);
    expect(repeatedPhrases('Tři body doma. Jardo ani nic nerikej!', recent)).toEqual(['Jardo ani nic nerikej!']);
    expect(repeatedPhrases('Já takhle chytal celou sezónu ’91, a stejně.', recent)).toEqual(['Já takhle chytal celou sezónu ’91,']);
    expect(repeatedPhrases('Jardo, dneska mlč.', recent)).toEqual([]);
    expect(repeatedPhrases('Nic neříkej, prosím.', recent)).toEqual([]);
    expect(repeatNotes('Výhra. Jardo, ani nic neříkej.', recent)).toEqual(['Hláška opakuje obrat z minulých příspěvků: „Jardo, ani nic neříkej.“.']);
  });

  it('zadání nese poslední hlášky; prázdná paměť nic nepřidá', () => {
    expect(recentBlock([])).toBe('');
    const block = recentBlock(recent);
    expect(block).toContain('POSLEDNÍ HLÁŠKY');
    expect(block).toContain('- „Pastrňák zase rozdával. Jardo, ani nic neříkej.“');
  });

  it('nová hláška jde na začátek, stejný den se přepíše, nejvýš 12', () => {
    const next = withLine(recent, { id: '2026-11-18-ranni-pivo', hlaska: 'Nová.' });
    expect(next.map((x) => x.id)).toEqual(['2026-11-18-ranni-pivo', '2026-11-17-ranni-pivo']);
    expect(next[0]!.hlaska).toBe('Nová.');
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, hlaska: `h${i}` }));
    expect(withLine(many, { id: 'x', hlaska: 'y' })).toHaveLength(RECENT_MAX);
  });

  it('načtení: uložená paměť, a když ještě není, poskládá se z konceptů posledního týdne', async () => {
    expect(await loadRecent(memStore({ [RECENT_KEY]: JSON.stringify(recent) }))).toEqual(recent);
    expect(await loadRecent(memStore({ [RECENT_KEY]: 'rozbité' }))).toEqual([]);
    const drafts = memStore({
      'drafts/2026-11-19-ranni-pivo.json': JSON.stringify({ venca: { hlaska: 'Dnešní. Jardo, ani nic neříkej.' } }),
      'drafts/2026-11-15-kotel.json': JSON.stringify({ venca: { hlaska: 'Kotel. Jardo, ani nic neříkej.' } }),
      'drafts/2026-11-01-ranni-pivo.json': JSON.stringify({ venca: { hlaska: 'Moc staré.' } }),
    });
    expect(await loadRecent(drafts, '2026-11-20')).toEqual([
      { id: '2026-11-19-ranni-pivo', hlaska: 'Dnešní. Jardo, ani nic neříkej.' },
      { id: '2026-11-15-kotel', hlaska: 'Kotel. Jardo, ani nic neříkej.' },
    ]);
    expect(await loadRecent(drafts)).toEqual([]);
  });
});

describe('Jarda v textech', () => {
  it('zmínku o Jardovi (fanoušci ho zatím neznají) kód pošle ke kontrole, jiná slova ne', async () => {
    const { jardaNotes } = await import('../src/venca.ts');
    expect(jardaNotes({ hlášce: 'Tři góly v Brně. Jardo, ani nic neříkej.' })).toEqual(['Text v hlášce zmiňuje Jardu („Jardo“), kterého fanoušci zatím neznají.']);
    expect(jardaNotes({ popisku: 'Tohle by Jardovi nevysvětlil nikdo.', titulku: 'Kubala zlomil Zbrojovku' })).toHaveLength(1);
    expect(jardaNotes({ hlášce: 'Hajdy na Jadran, kluci.', popisku: undefined })).toEqual([]);
  });
});
