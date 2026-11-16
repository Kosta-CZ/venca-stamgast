import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { footballPoints, roundView, tableAsOf, teamNamer, type KotelGame, type TeamEntry } from '../src/kotel.ts';
import { LEAGUES, leagueOf } from '../src/leagues.ts';
import { awaitingResults, slimEvent, type StoredRound } from '../src/sportsdb.ts';
import { applyScorers, scorersPrompt, type ReportGame } from '../src/scorers.ts';
import { checkKotelVenca, kotelUserMessage } from '../src/kotelVenca.ts';
import { cleanHashtags } from '../src/venca.ts';
import { kotelHtml } from '../src/render/kotel.ts';
import { approvalText } from '../src/telegram.ts';
import { issueTitle, type Draft } from '../src/draft.ts';
import { parseCallback } from '../worker/src/index.ts';

const fotbal = LEAGUES.fotbal;
const name = teamNamer((JSON.parse(readFileSync(new URL('../data/fotbal-tymy.json', import.meta.url), 'utf8')) as { tymy: TeamEntry[] }).tymy);
/** Kola 1–15 fotbalové 1. ligy 2026/27, jak je 16. 11. 2026 vrátil TheSportsDB. */
const SEASON = JSON.parse(readFileSync(new URL('./fixtures/fotbal-2026-2027.json', import.meta.url), 'utf8')) as StoredRound[];

describe('fotbalová 1. liga', () => {
  it('tabulka po 14. kole sedí s tabulkou ČTK (3-1-0, při shodě rozdíl skóre a vstřelené góly)', () => {
    const t = tableAsOf(SEASON, '2026-11-08', name, fotbal.points);
    // ČTK 8. 11. 2026 (ceskenoviny.cz, souhrn 14. kola): tým, zápasy, body.
    expect(t.map((r) => `${r.pos}. ${r.team} ${r.games} ${r.points}`)).toEqual([
      '1. Slavia 14 34', '2. Liberec 13 26', '3. Mladá Boleslav 14 25', '4. Sparta 14 24', '5. Olomouc 14 24',
      '6. Teplice 14 21', '7. Jablonec 14 21', '8. Plzeň 14 20', '9. Bohemians 14 20', '10. Zbrojovka Brno 14 20',
      '11. Hradec Králové 14 18', '12. Pardubice 14 17', '13. Ostrava 13 14', '14. Artis Brno 14 10', '15. Slovácko 14 10', '16. Zlín 14 3',
    ]);
  });

  it('body 3-1-0', () => {
    expect([footballPoints(2, 1, 'reg'), footballPoints(1, 1, 'reg'), footballPoints(0, 3, 'reg')]).toEqual([3, 1, 0]);
  });

  it('každý tým z TheSportsDB má český název (dvě Brna zvlášť)', () => {
    for (const r of SEASON) for (const e of r.events) {
      expect(name(e.homeId, e.home), e.home).not.toBeNull();
      expect(name(e.awayId, e.away), e.away).not.toBeNull();
    }
    expect(name(null, 'Zbrojovka Brno')).toBe('Zbrojovka Brno');
    expect(name(null, 'Artis Brno')).toBe('Artis Brno');
    expect(name(null, 'Brno')).toBeNull();
  });

  it('odložený zápas se stavem PST a původním datem je „odloženo“, ne chybějící výsledek', () => {
    const r12 = SEASON.find((r) => r.round === 12)!;
    const v = roundView(r12, name, '2026-11-16');
    expect(v.missing).toEqual([]);
    expect(v.games.find((g) => g.home === 'Liberec' && g.away === 'Ostrava')?.postponed).toBe(true);
    expect(awaitingResults(r12, '2026-11-16')).toBe(false);
    expect(slimEvent({ idEvent: '1', strStatus: 'Postponed', dateEvent: '2026-10-24' }).status).toBe('Postponed');
  });

  it('14. kolo: dny kola, remíza 0:0 bez střelců není chyba, vlastní gól se počítá týmu', () => {
    const v = roundView(SEASON.find((r) => r.round === 14)!, name, '2026-11-16');
    expect(v.dayLabel).toBe('sobota 7. 11. a neděle 8. 11.');
    expect(v.date).toBe('2026-11-08');
    const games = v.games.map((g): KotelGame => ({ ...g, homeScorers: [], awayScorers: [] }));
    const src = ['https://www.ceskenoviny.cz/zpravy/2898880'];
    const report: ReportGame[] = [
      { home: 'Jablonec', away: 'Mladá Boleslav', score: '0:0', homeScorers: [], awayScorers: [], shootoutWinner: null, sources: src, note: '' },
      { home: 'Teplice', away: 'Pardubice', score: '1:4', homeScorers: [{ name: 'Večerka', goals: 1 }], awayScorers: [{ name: 'Ouattara', goals: 2 }, { name: 'Jukla (vl.)', goals: 1 }, { name: 'Trmala (vl.)', goals: 1 }], shootoutWinner: null, sources: src, note: '' },
    ];
    const res = applyScorers(games.filter((g) => ['Jablonec', 'Teplice'].includes(g.home)), report, { seen: src, name, domains: fotbal.scorerDomains });
    expect(res.pozor).toEqual([]);
  });

  it('zadání pro střelce: 1. liga, vlastní góly, žádné nájezdy, zdroje fotbalu', () => {
    const { system, user } = scorersPrompt(14, 'sobota 7. 11. a neděle 8. 11.', '2026-2027', [{ home: 'Plzeň', away: 'Sparta', homeGoals: 1, awayGoals: 1, ending: 'reg', homeScorers: [], awayScorers: [] }], fotbal);
    expect(system).toContain('fotbalové 1. ligy');
    expect(user).toContain('(vl.)');
    expect(user).toContain('"rozhodujici_najezd": vždy null');
    expect(user).not.toContain('pp');
    expect(user).toContain('fotbal.cz');
    expect(user).not.toContain('hokej.cz');
  });

  it('Venca: formát liga, sponzor v textu a sázkový hashtag neprojdou', () => {
    const facts = { round: 14, dayLabel: 'sobota 7. 11. a neděle 8. 11.', games: [{ home: 'Slavia', away: 'Artis Brno', homeGoals: 4, awayGoals: 1, ending: 'reg' as const, homeScorers: [{ name: 'Chytil', goals: 1 }], awayScorers: [{ name: 'Papalelé', goals: 1 }] }], table: [{ pos: 1, team: 'Slavia', games: 14, points: 34 }] };
    expect(kotelUserMessage(facts, '2026-11-08', fotbal)).toContain('FORMÁT: liga');
    expect(kotelUserMessage(facts, '2026-11-08', fotbal)).not.toContain('konec');
    const v = checkKotelVenca({ titulek: 'Slavia jede', hlaska: 'Chance Liga má lídra.', popisek: 'Slavia vyhrála 4:1.', vyraz: 'radost', muz_kola: { jmeno: 'Chytil', tym: 'Slavia' } }, facts, '2026-11-08');
    expect(v.pozor.join(' ')).toContain('sázkovou kancelář');
    expect(cleanHashtags(['#ChanceLiga', '#fotbal', '#FortunaLiga'])).toEqual(['#fotbal']);
  });

  it('koncept fotbalu: id s příponou liga, štítek 1. LIGA, zpráva a issue se jménem soutěže', () => {
    const d: Draft = {
      id: '2026-11-08-liga', kind: 'kotel', league: 'fotbal', season: '2026-2027', date: '2026-11-08', dayLabel: 'sobota 7. 11. a neděle 8. 11.', caption: 'C',
      venca: { muz_kola: null, titulek: 'T', hlaska: 'H', popisek: 'C', hashtagy: [], vyraz: 'klid', pozor: [] },
      facts: { round: 14, dayLabel: 'x', games: [], table: [] }, sources: [], pozor: [], model: null, createdAt: '',
    };
    expect(leagueOf(d).label).toBe('1. LIGA');
    expect(approvalText(d)).toContain('⚽ <b>Fotbalová liga · 14. kolo</b>');
    expect(issueTitle(d)).toBe('Ke schválení: Fotbalová liga 14. kolo');
    expect(parseCallback(`vydat:${d.id}`)?.id).toBe('2026-11-08-liga');
    expect(kotelHtml({ facts: d.facts, venca: d.venca, label: fotbal.label })).toContain('1. LIGA · <span');
    expect(leagueOf({}).title).toBe('Extraligový kotel');
  });
});
