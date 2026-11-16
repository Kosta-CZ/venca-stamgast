import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  checkScorers, daysLabel, defaultHero, latestRound, roundDays, roundView, tableAsOf, tableFromGames, teamNamer,
  type KotelFacts, type KotelGame, type TeamEntry,
} from '../src/kotel.ts';
import { awaitingResults, endingOf, isFinal, roundKey, seasonFor, slimEvent, syncRounds, tsdbGetter, type RoundEvent, type StoredRound } from '../src/sportsdb.ts';
import { memoryStore } from '../src/storage.ts';
import { applyScorers, parseScore, parseScorerReport, scorersPrompt, sourceLabel, type ReportGame } from '../src/scorers.ts';
import { checkKotelVenca, findHero, kotelAllowedNumbers, kotelCaption, kotelDisclaimer, kotelUserMessage } from '../src/kotelVenca.ts';
import { kotelHtml } from '../src/render/kotel.ts';
import { SAMPLE_KOTEL } from '../src/kotelSample.ts';

const TEAMS = (JSON.parse(readFileSync(new URL('../data/extraliga-tymy.json', import.meta.url), 'utf8')) as { tymy: TeamEntry[] }).tymy;
const name = teamNamer(TEAMS);

/** Kola 1–19 sezóny 2026/27 tak, jak je 16. 11. 2026 uložila úloha z TheSportsDB. */
const SEASON = JSON.parse(readFileSync(new URL('./fixtures/extraliga-2026-2027.json', import.meta.url), 'utf8')) as StoredRound[];

let n = 0;
function ev(home: string, away: string, score: string | null, date: string, status = score ? 'FT' : 'NS', time = '17:00:00'): RoundEvent {
  const [h, a] = score ? score.split(':').map(Number) : [null, null];
  return { id: String(++n), homeId: null, awayId: null, home, away, homeGoals: h ?? null, awayGoals: a ?? null, date, time, status, postponed: false };
}
const round = (r: number, events: RoundEvent[], fetchedAt = '2026-11-16T07:00:00Z'): StoredRound => ({ season: '2026-2027', round: r, fetchedAt, events });

describe('převod týmů', () => {
  it('podle id TheSportsDB i podle názvu bez diakritiky', () => {
    expect(name('140826', 'cokoli')).toBe('Hradec Králové');
    expect(name(null, 'Mountfield HK')).toBe('Hradec Králové');
    expect(name(null, 'Bili Tygri Liberec')).toBe('Liberec');
    expect(name(null, 'Plzen')).toBe('Plzeň');
    expect(name(null, 'Litvinov')).toBe('Litvínov');
    expect(name(null, 'Motor České Budějovice')).toBe('Budějovice');
  });

  it('neznámý tým vrátí null a kolo ho ohlásí', () => {
    expect(name(null, 'Berani Zlín')).toBeNull();
    const v = roundView(round(1, [ev('Berani Zlín', 'Kometa Brno', '2:1', '2026-11-15')]), name, '2026-11-16');
    expect(v.unknownTeams).toEqual(['Berani Zlín']);
    expect(v.games[0]!.home).toBe('Berani Zlín');
  });

  it('každý tým z TheSportsDB v uložené sezóně má český název', () => {
    for (const r of SEASON) for (const e of r.events) {
      expect(name(e.homeId, e.home), e.home).not.toBeNull();
      expect(name(e.awayId, e.away), e.away).not.toBeNull();
    }
  });
});

describe('TheSportsDB', () => {
  it('stavy zápasu: FT, AOT = prodloužení, AP = nájezdy, NS nehráno', () => {
    const e = slimEvent({ idEvent: '1', strHomeTeam: 'Plzen', strAwayTeam: 'Mladá Boleslav', intHomeScore: '3', intAwayScore: '2', strStatus: 'AOT', dateEvent: '2026-11-15', strPostponed: 'no' });
    expect(e.homeGoals).toBe(3);
    expect(isFinal(e)).toBe(true);
    expect(endingOf('AOT')).toBe('ot');
    expect(endingOf('AP')).toBe('so');
    expect(endingOf('FT')).toBe('reg');
    expect(isFinal(slimEvent({ idEvent: '2', intHomeScore: null, intAwayScore: null, strStatus: 'NS' }))).toBe(false);
  });

  it('sezóna podle data', () => {
    expect(seasonFor('2026-11-21')).toBe('2026-2027');
    expect(seasonFor('2027-03-01')).toBe('2026-2027');
    expect(seasonFor('2027-09-10')).toBe('2027-2028');
  });

  it('mezi dotazy je pauza, po 429 se čeká a zkouší znovu', async () => {
    const waits: number[] = [];
    const statuses = [429, 200, 200];
    const f = vi.fn(async () => {
      const s = statuses.shift() ?? 200;
      return new Response(s === 200 ? '{"events":[]}' : 'Too Many', { status: s, headers: s === 429 ? { 'retry-after': '120' } : {} });
    });
    const get = tsdbGetter({ fetch: f as unknown as typeof fetch, sleep: async (ms) => void waits.push(ms), gapMs: 7000 });
    await get('a');
    await get('b');
    expect(f).toHaveBeenCalledTimes(3);
    expect(waits).toContain(120_000);
    expect(waits.filter((w) => w > 0 && w <= 7000).length).toBeGreaterThanOrEqual(1);
  });

  it('po opakovaném 429 to vzdá s chybou', async () => {
    const f = vi.fn(async () => new Response('x', { status: 429 }));
    const get = tsdbGetter({ fetch: f as unknown as typeof fetch, sleep: async () => {}, gapMs: 0 });
    await expect(get('eventsround.php')).rejects.toThrow(/429/);
    expect(f.mock.calls.length).toBe(6);
  });

  it('stáhne chybějící kola, konec sezóny pozná podle prázdného kola a dohrané kolo už znovu nestahuje', async () => {
    const asked: string[] = [];
    const tsdb = { 1: [{ idEvent: 'a', strHomeTeam: 'Kladno', strAwayTeam: 'Třinec', intHomeScore: '1', intAwayScore: '4', strStatus: 'FT', dateEvent: '2026-09-15' }], 2: [{ idEvent: 'b', strHomeTeam: 'Sparta', strAwayTeam: 'Kometa', intHomeScore: null, intAwayScore: null, strStatus: 'NS', dateEvent: '2026-11-20' }] } as Record<number, unknown[]>;
    const get = async (path: string) => {
      asked.push(path);
      const r = Number(/r=(\d+)/.exec(path)![1]);
      return { events: tsdb[r] ?? null };
    };
    const store = memoryStore();
    const first = await syncRounds(get, store, '2026-2027', { today: '2026-11-16' });
    expect([...first.keys()]).toEqual([1, 2]);
    expect(asked).toHaveLength(3);
    expect(store.data.has(roundKey('2026-2027', 1))).toBe(true);

    asked.length = 0;
    await syncRounds(get, store, '2026-2027', { today: '2026-11-16' });
    expect(asked.map((p) => /r=(\d+)/.exec(p)![1])).toEqual(['3']);

    asked.length = 0;
    await syncRounds(get, store, '2026-2027', { today: '2026-11-21' });
    expect(asked.map((p) => /r=(\d+)/.exec(p)![1])).toEqual(['2', '3']);
  });

  it('kolo s odloženým zápasem čeká na výsledek až od nového data', () => {
    const r = round(19, [ev('Kladno', 'Třinec', '1:4', '2026-11-15'), ev('Kometa', 'Karlovy Vary', null, '2027-01-18')]);
    expect(awaitingResults(r, '2026-11-21')).toBe(false);
    expect(awaitingResults(r, '2027-01-18')).toBe(true);
  });
});

describe('kolo a tabulka', () => {
  const r19 = SEASON.find((r) => r.round === 19)!;

  it('19. kolo: pořadí zápasů jako u ČTK, odložený zápas s novým datem, konce pp a sn', () => {
    const v = roundView(r19, name, '2026-11-16');
    expect(v.dayLabel).toBe('neděle 15. 11.');
    expect(v.date).toBe('2026-11-15');
    expect(v.missing).toEqual([]);
    expect(v.games.map((g) => `${g.home} – ${g.away}`)).toEqual(SAMPLE_KOTEL.games.map((g) => `${g.home} – ${g.away}`));
    expect(v.games.map((g) => [g.homeGoals, g.awayGoals, g.ending, g.postponedTo])).toEqual(SAMPLE_KOTEL.games.map((g) => [g.homeGoals, g.awayGoals, g.ending, g.postponedTo]));
  });

  it('tabulka po 19. kole sedí se zprávou ČTK (3-2-1-0, vzájemné zápasy při rovnosti bodů)', () => {
    const table = tableAsOf(SEASON, '2026-11-15', name);
    expect(table.slice(0, 4)).toEqual(SAMPLE_KOTEL.table);
    expect(table).toHaveLength(14);
    expect(table.find((r) => r.team === 'Kometa')?.games).toBe(17);
  });

  it('předehrávka se do tabulky počítá podle dne, kdy se hrála', () => {
    const rounds = [
      round(1, [ev('A', 'B', '2:1', '2026-09-15'), ev('C', 'D', '1:0', '2026-09-15')]),
      round(9, [ev('A', 'C', '0:3', '2026-09-14'), ev('B', 'D', '2:2', '2026-12-01')]),
    ];
    const t = tableAsOf(rounds, '2026-09-15', (_id, raw) => raw);
    expect(t.find((r) => r.team === 'C')).toMatchObject({ games: 2, points: 6 });
    expect(t.find((r) => r.team === 'B')?.games).toBe(1);
  });

  it('při rovnosti bodů rozhodují vzájemné zápasy, ne celkové skóre', () => {
    const g = (home: string, away: string, h: number, a: number): KotelGame => ({ home, away, homeGoals: h, awayGoals: a, ending: 'reg', homeScorers: [], awayScorers: [] });
    // A i B mají 6 bodů, A má lepší celkové skóre (+9 proti +2), ale vzájemný zápas vyhrál B.
    const t = tableFromGames([g('A', 'X', 9, 0), g('B', 'Y', 1, 0), g('B', 'A', 1, 0), g('A', 'Y', 1, 0)]);
    expect(t.map((r) => `${r.team} ${r.points}`).slice(0, 2)).toEqual(['B 6', 'A 6']);
  });

  it('dny kola bez předehrávek, popisek dvou dnů i rozsahu', () => {
    expect(roundDays([{ date: '2026-11-18' }, { date: '2026-11-22' }, { date: '2026-11-22' }])).toEqual(['2026-11-22']);
    expect(daysLabel(['2026-09-19', '2026-09-20', '2026-09-22'])).toBe('19.–22. 9.');
    expect(daysLabel(['2026-09-30', '2026-10-01', '2026-10-02'])).toBe('30. 9.–2. 10.');
    const v = roundView(round(20, [ev('Budějovice', 'Sparta', '2:3', '2026-11-19'), ev('Plzeň', 'Pardubice', '1:2', '2026-11-20'), ev('Olomouc', 'Liberec', '4:2', '2026-11-20')]), name, '2026-11-21');
    expect(v.dayLabel).toBe('čtvrtek 19. 11. a pátek 20. 11.');
    expect(v.date).toBe('2026-11-20');
  });

  it('předehrávka hraná mimo dny kola dostane datum', () => {
    const v = roundView(round(21, [ev('Kladno', 'Liberec', '3:1', '2026-11-18'), ev('Sparta', 'Plzeň', '2:0', '2026-11-22'), ev('Třinec', 'Kometa', '2:1', '2026-11-22')]), name, '2026-11-23');
    expect(v.games.find((g) => g.home === 'Kladno')?.playedOn).toBe('2026-11-18');
    expect(v.date).toBe('2026-11-22');
  });

  it('sobota ráno: poslední odehrané kolo, ne kolo s dnešními zápasy', () => {
    const today = '2026-11-21';
    const views = [
      round(19, [ev('Kladno', 'Třinec', '1:4', '2026-11-15')]),
      round(20, [ev('Plzeň', 'Pardubice', '1:2', '2026-11-20'), ev('Olomouc', 'Liberec', '4:2', '2026-11-20')]),
      round(21, [ev('Sparta', 'Kometa', null, '2026-11-21')]),
    ].map((r) => roundView(r, name, today));
    expect(latestRound(views, today)?.round).toBe(20);
  });

  it('chybějící výsledek po odehraném dni se ohlásí', () => {
    const v = roundView(round(20, [ev('Plzeň', 'Pardubice', '1:2', '2026-11-20'), ev('Olomouc', 'Liberec', null, '2026-11-20')]), name, '2026-11-21');
    expect(v.missing).toEqual(['Olomouc – Liberec']);
  });
});

const r19games = (): KotelGame[] => roundView(SEASON.find((r) => r.round === 19)!, name, '2026-11-16').games.map((g) => ({ ...g, homeScorers: [], awayScorers: [] }));

/** Odpověď Claude podle zprávy ČTK k 19. kolu (střelci z ukázky). */
function ctkReport(): ReportGame[] {
  return SAMPLE_KOTEL.games.filter((g) => g.homeGoals !== null).map((g) => ({
    home: g.home, away: g.away,
    score: `${g.homeGoals}:${g.awayGoals}${g.ending === 'ot' ? ' pp' : g.ending === 'so' ? ' sn' : ''}`,
    homeScorers: g.homeScorers, awayScorers: g.awayScorers, shootoutWinner: g.shootoutWinner ?? null,
    sources: ['https://www.ceskenoviny.cz/zpravy/2700000'], note: '',
  }));
}
const SEEN = ['https://www.ceskenoviny.cz/zpravy/2700000'];

describe('střelci', () => {
  it('JSON z odpovědi i s textem a obalem ```', () => {
    const text = 'Našel jsem souhrn.\n```json\n{"kolo":19,"zapasy":[{"domaci":"Kladno","hoste":"Třinec","skore":"1:4","strelci_domaci":[{"jmeno":"Kempný","goly":1}],"strelci_hoste":[{"jmeno":"Daňo","goly":2},{"jmeno":"Daňo","goly":1}],"rozhodujici_najezd":null,"zdroje":["https://www.ceskenoviny.cz/zpravy/1"],"poznamka":""}]}\n```';
    const [g] = parseScorerReport(text);
    expect(g?.home).toBe('Kladno');
    expect(g?.awayScorers).toEqual([{ name: 'Daňo', goals: 3 }]);
    expect(() => parseScorerReport('Nic jsem nenašel.')).toThrow();
    expect(() => parseScorerReport('{"kolo": 19}')).toThrow(/zápas/);
  });

  it('skóre ze zdroje', () => {
    expect(parseScore('3:2 pp')).toEqual({ home: 3, away: 2, ending: 'ot' });
    expect(parseScore('2:1 sn')).toEqual({ home: 2, away: 1, ending: 'so' });
    expect(parseScore('2:1 po samostatných nájezdech')).toMatchObject({ ending: 'so' });
    expect(parseScore('1:4 (0:0, 0:4, 1:0)')).toEqual({ home: 1, away: 4, ending: 'reg' });
    expect(parseScore('?')).toBeNull();
  });

  it('střelci podle ČTK k 19. kolu projdou kontrolou bez výhrad', () => {
    const res = applyScorers(r19games(), ctkReport(), { seen: SEEN, name });
    expect(res.pozor).toEqual([]);
    expect(res.games.map((g) => [g.homeScorers, g.awayScorers])).toEqual(SAMPLE_KOTEL.games.map((g) => [g.homeScorers, g.awayScorers]));
    expect(res.games.find((g) => g.ending === 'so')?.shootoutWinner).toBe('Hrivík');
    expect(res.sources).toEqual([{ url: SEEN[0], games: res.games.filter((g) => g.homeGoals !== null).map((g) => `${g.home} – ${g.away}`) }]);
  });

  it('názvy týmů ze zdroje se převedou (Mountfield HK, Mladá Boleslav) i když jsou prohozené', () => {
    const report = ctkReport().map((r) => (r.away === 'Hradec Králové' ? { ...r, away: 'Mountfield HK' } : r.away === 'Boleslav' ? { ...r, home: 'Mladá Boleslav', away: 'Plzeň', homeScorers: r.awayScorers, awayScorers: r.homeScorers, score: '2:3 pp' } : r));
    const res = applyScorers(r19games(), report, { seen: SEEN, name });
    expect(res.pozor).toEqual([]);
    expect(res.games.find((g) => g.home === 'Plzeň')?.homeScorers).toEqual([{ name: 'Teplý', goals: 1 }, { name: 'Merežko', goals: 2 }]);
  });

  it('rozpory jdou do pozor: součet gólů, jiné skóre, chybějící zápas, nájezd a podezřelé odkazy', () => {
    const report = ctkReport()
      .filter((r) => r.home !== 'Sparta')
      .map((r) => {
        if (r.home === 'Kladno') return { ...r, awayScorers: [{ name: 'Daňo', goals: 2 }] };
        if (r.home === 'Liberec') return { ...r, score: '5:2' };
        if (r.home === 'Vítkovice') return { ...r, shootoutWinner: null };
        if (r.home === 'Budějovice') return { ...r, sources: ['https://www.ceskenoviny.cz/zpravy/vymysleny'] };
        if (r.home === 'Plzeň') return { ...r, sources: ['https://www.idnes.cz/sport/clanek'] };
        return r;
      });
    const p = applyScorers(r19games(), report, { seen: SEEN, name }).pozor.join('\n');
    expect(p).toContain('Třinec má ve střelcích 2 góly, skóre říká 4');
    expect(p).toContain('zdroj píše 5:2, TheSportsDB 5:1');
    expect(p).toContain('Sparta – Hradec Králové 1:3 chybí');
    expect(p).toContain('rozhodující nájezd');
    expect(p).toContain('nebyl ve výsledcích hledání');
    expect(p).toContain('mimo povolené weby');
  });

  it('zadání nenese skóre (to musí přinést zdroj) a vynechá odložený zápas', () => {
    const { user } = scorersPrompt(19, 'neděle 15. 11.', '2026-2027', r19games());
    expect(user).toContain('- Kladno – Třinec');
    expect(user).not.toContain('Kometa – Karlovy Vary');
    expect(user).not.toContain('1:4');
    expect(user).toContain('2026/27');
  });

  it('zdroje mají krátké jméno', () => {
    expect(sourceLabel('https://www.ceskenoviny.cz/zpravy/1')).toBe('ČTK');
    expect(sourceLabel('https://sport.ceskatelevize.cz/clanek/x')).toBe('ČT sport');
    expect(sourceLabel('https://www.hokej.cz/zapas/1')).toBe('hokej.cz');
    expect(kotelDisclaimer([{ url: 'https://www.ceskenoviny.cz/zpravy/1' }, { url: 'https://www.hokej.cz/z' }])).toBe('Fiktivní AI postava. Výsledky z TheSportsDB, střelci ze zpráv ČTK, hokej.cz.');
  });
});

describe('Venca v Kotli', () => {
  const facts: KotelFacts = { ...SAMPLE_KOTEL, hero: undefined };
  const ok = {
    muz_kola: { jmeno: 'Daňo', tym: 'Třinec' },
    titulek: 'Třinec vyřídil Kladno',
    hlaska: 'Daňo dal 2 a Třinec má 48 bodů. Jardo, ani nic neříkej.',
    popisek: 'Třinec vyhrál v Kladně 4:1 a v čele má náskok 9 bodů. Kdo vás v 19. kole překvapil?',
    hashtagy: ['#extraliga', '#hokej', '#tipsport'],
    vyraz: 'rikal',
    pozor: [],
  };

  it('čísla z dat projdou, muž kola ze střelců platí, sázkový hashtag zmizí', () => {
    const v = checkKotelVenca(ok, facts, '2026-11-15');
    expect(v.pozor).toEqual([]);
    expect(v.muz_kola).toEqual({ name: 'Daňo', team: 'Třinec' });
    expect(v.hashtagy).toEqual(['#extraliga', '#hokej']);
  });

  it('vymyšlené číslo a muž kola, který neskóroval, jdou do pozor', () => {
    const v = checkKotelVenca({ ...ok, hlaska: 'Kladno mělo 37 střel.', muz_kola: { jmeno: 'Vladař', tym: 'Třinec' } }, facts, '2026-11-15');
    expect(v.pozor.join(' ')).toContain('37');
    expect(v.pozor.join(' ')).toContain('Vladař');
    expect(v.muz_kola).toEqual(defaultHero(facts.games));
    expect(v.muz_kola?.name).toBe('Daňo');
  });

  it('muž kola se najde i bez diakritiky', () => {
    expect(findHero(facts, { jmeno: 'Merezko', tym: 'Plzen' })).toEqual({ name: 'Merežko', team: 'Plzeň' });
  });

  it('povolená čísla: kolo, skóre, góly, tabulka, odstupy a datum odloženého zápasu', () => {
    const ok = kotelAllowedNumbers(facts, '2026-11-15');
    for (const x of ['19', '4', '5', '48', '39', '9', '32', '15', '11', '18', '91']) expect(ok.has(x), x).toBe(true);
    expect(ok.has('37')).toBe(false);
  });

  it('data pro Vencu mají střelce kola a odložený zápas', () => {
    const msg = kotelUserMessage(facts, '2026-11-15');
    expect(msg).toContain('FORMÁT: kotel');
    expect(msg).toContain('"strelci_kola"');
    expect(msg).toContain('odloženo na 18. 1.');
  });

  it('popisek nese označení AI postavy a zdroje', () => {
    const c = kotelCaption({ popisek: 'Text.', hashtagy: ['#extraliga'] }, [{ url: 'https://www.ceskenoviny.cz/zpravy/1' }]);
    expect(c).toContain('Fiktivní AI postava');
    expect(c).toContain('ČTK');
  });
});

describe('šablona Kotle', () => {
  it('odložený zápas s datem, předehrávka s datem, muž kola zvýrazněný jen ve svém týmu', () => {
    const games: KotelGame[] = [
      ...SAMPLE_KOTEL.games,
      { home: 'Sparta', away: 'Třinec', homeGoals: 2, awayGoals: 1, ending: 'reg', homeScorers: [{ name: 'Daňo', goals: 2 }], awayScorers: [{ name: 'Daňo', goals: 1 }], playedOn: '2026-11-18' },
    ];
    const html = kotelHtml({ facts: { ...SAMPLE_KOTEL, games }, venca: { titulek: '<b>T</b>', hlaska: 'H', vyraz: 'klid' }, disclaimer: 'Patička & zdroje' });
    expect(html).toContain('hraje se 18. 1.');
    expect(html).toContain('hráno 18. 11.');
    expect(html).toContain('&lt;b&gt;T&lt;/b&gt;');
    expect(html).toContain('Patička &amp; zdroje');
    expect(html.match(/<b style="color:#F5B027">Daňo/g)?.length).toBe(2);
  });

  it('ukázka z 19. kola sedí se skóre', () => {
    expect(SAMPLE_KOTEL.games.flatMap(checkScorers)).toEqual([]);
  });
});
