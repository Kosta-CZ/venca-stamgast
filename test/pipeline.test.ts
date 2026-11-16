import { describe, expect, it } from 'vitest';
import { boxKey, czechInBox, gameLine, lineText, nameKey, nhlDateFor, type Boxscore, type CzPlayer } from '../src/nhl.ts';
import { allowedNumbers, pctText, plural, postFacts, valueText } from '../src/facts.ts';
import { caption, checkVenca, dayLabel, parseJsonLoose } from '../src/venca.ts';
import { draftIdFromIssue, issueBody, DRAFT_MARK, type Draft } from '../src/draft.ts';
import { ranniPivoHtml } from '../src/render/ranniPivo.ts';
import { vencaSvg } from '../src/render/avatar.ts';
import { SAMPLE_DATE, SAMPLE_NIGHT, SAMPLE_VENCA } from '../src/sample.ts';

const czechs: CzPlayer[] = [
  { jmeno: 'Tomáš Hertl', pozice: 'F' },
  { jmeno: 'Dan Vladař', pozice: 'G' },
  { jmeno: 'David Jiříček', pozice: 'D' },
  { jmeno: 'Adam Jiříček', pozice: 'D' },
];

// Tvar zápisu podle veřejného API NHL (zkrácený).
const box: Boxscore = {
  id: 2026020123,
  homeTeam: { abbrev: 'CGY' },
  awayTeam: { abbrev: 'PHI' },
  playerByGameStats: {
    homeTeam: { forwards: [{ playerId: 10, name: { default: 'T. Hertl' }, goals: 0, assists: 0, toi: '12:00' }] },
    awayTeam: {
      defense: [
        { playerId: 11, name: { default: 'D. Jiricek' }, goals: 0, assists: 1, points: 1, sog: 2, toi: '18:10' },
        { playerId: 12, name: { default: 'A. Jiricek' }, goals: 0, assists: 0, toi: '00:00' },
      ],
      goalies: [
        { playerId: 13, name: { default: 'D. Vladar' }, saveShotsAgainst: '22/26', goalsAgainst: 4, toi: '61:30' },
        { playerId: 14, name: { default: 'S. Ersson' }, saveShotsAgainst: '0/0', toi: '00:00' },
      ],
    },
  },
};
const line = gameLine({ id: 1, gameState: 'OFF', homeTeam: { abbrev: 'CGY', score: 4 }, awayTeam: { abbrev: 'PHI', score: 3 }, gameOutcome: { lastPeriodType: 'OT' } });

describe('NHL', () => {
  it('jména se párují bez diakritiky a podle iniciály', () => {
    expect(nameKey('David Pastrňák')).toBe('d. pastrnak');
    expect(boxKey('D. Pastrnak')).toBe('d. pastrnak');
    expect(nameKey('Adam Jiříček')).not.toBe(nameKey('David Jiříček'));
  });

  it('najde Čechy v zápisu a vynechá ty, kdo nenastoupili', () => {
    const found = czechInBox(box, line, czechs);
    expect(found.map((p) => p.jmeno).sort()).toEqual(['Dan Vladař', 'David Jiříček', 'Tomáš Hertl']);
    const vladar = found.find((p) => p.goalie);
    expect(vladar?.saves).toBe(22);
    expect(vladar?.shotsAgainst).toBe(26);
    expect(vladar?.won).toBe(false);
    expect(found.find((p) => p.jmeno === 'Tomáš Hertl')?.team).toBe('CGY');
  });

  it('řádek zápasu je domácí – hosté s prodloužením', () => {
    expect(lineText(line)).toBe('Calgary – Philadelphia 4:3 pp');
    expect(line.final).toBe(true);
  });

  it('noc na pondělí se hrála v neděli', () => {
    expect(nhlDateFor('2026-11-09')).toBe('2026-11-08');
    expect(nhlDateFor('2026-03-01')).toBe('2026-02-28');
  });
});

describe('fakta', () => {
  it('české tvary a formáty', () => {
    expect(plural(1, 'gól', 'góly', 'gólů')).toBe('gól');
    expect(plural(3, 'gól', 'góly', 'gólů')).toBe('góly');
    expect(plural(5, 'gól', 'góly', 'gólů')).toBe('gólů');
    expect(pctText(22 / 26)).toBe('84,6 %');
  });

  it('muž noci a pořadí ostatních', () => {
    const f = postFacts(SAMPLE_NIGHT.players);
    expect(f?.hero.jmeno).toBe('Tomáš Hertl');
    expect(f?.hero.big).toBe(2);
    expect(f?.hero.unit).toBe('góly');
    expect(f?.others).toHaveLength(4);
    expect(f?.more).toBe(2);
    expect(f?.hidden.map((h) => h.jmeno)).toHaveLength(2);
  });

  it('muž noci od Vency platí, jen když hrál', () => {
    expect(postFacts(SAMPLE_NIGHT.players, '4')?.hero.jmeno).toBe('Dan Vladař');
    expect(postFacts(SAMPLE_NIGHT.players, '999')?.hero.jmeno).toBe('Tomáš Hertl');
    expect(postFacts([])).toBeNull();
  });

  it('hodnota brankáře je úspěšnost, hráče body', () => {
    const vladar = SAMPLE_NIGHT.players.find((p) => p.goalie);
    expect(vladar && valueText(vladar)).toBe('84,6 %');
  });
});

describe('Venca', () => {
  it('JSON i v obalu ```', () => {
    expect(parseJsonLoose('Tady:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => parseJsonLoose('nic')).toThrow();
  });

  it('ukázka projde kontrolou bez výhrad', () => {
    expect(checkVenca(SAMPLE_VENCA, SAMPLE_NIGHT, SAMPLE_DATE).pozor).toEqual([]);
  });

  it('vymyšlené číslo skončí v pozor', () => {
    const out = checkVenca({ ...SAMPLE_VENCA, hlaska: 'Hertl dal 3 góly a 7 střel.' }, SAMPLE_NIGHT, SAMPLE_DATE);
    expect(out.pozor.join(' ')).toContain('7');
    expect(out.pozor.join(' ')).not.toContain(' 3,');
  });

  it('neznámý výraz a cizí muž noci se opraví', () => {
    const out = checkVenca({ ...SAMPLE_VENCA, vyraz: 'smich', muz_noci: 'x' }, SAMPLE_NIGHT, SAMPLE_DATE);
    expect(out.vyraz).toBe('klid');
    expect(out.muz_noci).toBeNull();
    expect(out.pozor.length).toBe(2);
  });

  it('sázkové hashtagy se zahodí', () => {
    const out = checkVenca({ ...SAMPLE_VENCA, hashtagy: ['#NHL', '#tipsport', 'hokej'] }, SAMPLE_NIGHT, SAMPLE_DATE);
    expect(out.hashtagy).toEqual(['#NHL', '#hokej']);
  });

  it('popisek nese označení AI postavy', () => {
    expect(caption(SAMPLE_VENCA)).toContain('Fiktivní AI postava');
  });

  it('povolená čísla obsahují data i datum', () => {
    const ok = allowedNumbers(SAMPLE_NIGHT.players, SAMPLE_DATE);
    for (const n of ['2', '4', '22', '26', '84,6', '9', '11']) expect(ok.has(n)).toBe(true);
  });

  it('popisek dne', () => {
    expect(dayLabel('2026-11-09')).toBe('pondělí 9. 11.');
  });
});

describe('koncept a šablona', () => {
  const facts = postFacts(SAMPLE_NIGHT.players, '1');
  const draft: Draft = {
    id: '2026-11-09-ranni-pivo', kind: 'ranni-pivo', date: SAMPLE_DATE, dayLabel: 'pondělí 9. 11.',
    caption: caption(SAMPLE_VENCA), venca: SAMPLE_VENCA, facts: facts!, pozor: [], model: null, createdAt: '', imageUrl: 'https://example.r2.dev/drafts/x.jpg',
  };

  it('issue nese značku konceptu, kterou umí přečíst schválení', () => {
    const body = issueBody(draft);
    expect(body.startsWith(DRAFT_MARK(draft.id))).toBe(true);
    expect(draftIdFromIssue(body)).toBe(draft.id);
    expect(body).toContain('/vydat');
  });

  it('šablona escapuje texty a má všechny hráče z grafiky', () => {
    const html = ranniPivoHtml({ dayLabel: 'pondělí 9. 11.', facts: facts!, venca: { ...SAMPLE_VENCA, hlaska: '<b>pozor</b>' } });
    expect(html).toContain('&lt;b&gt;pozor&lt;/b&gt;');
    for (const r of facts!.others) expect(html).toContain(r.jmeno);
    expect(html).toContain('TOMÁŠ HERTL');
  });

  it('všech osm výrazů se vykreslí', () => {
    for (const e of ['klid', 'radost', 'nadseni', 'zklamani', 'vztek', 'rikal', 'nevericne', 'nervozita'] as const) {
      expect(vencaSvg(e, 100)).toContain(`vc-${e}`);
    }
  });
});

import { r2Endpoint, r2FromEnv } from '../src/storage.ts';

describe('úložiště R2', () => {
  const base = { R2_ACCESS_KEY_ID: 'a', R2_SECRET_ACCESS_KEY: 'b', R2_BUCKET: 'venca-stamgast', R2_PUBLIC_URL: 'https://pub-x.r2.dev/' };

  it('bucket v EU má adresu z R2_ENDPOINT', () => {
    expect(r2FromEnv({ ...base, R2_ENDPOINT: 'https://abc.eu.r2.cloudflarestorage.com/' }).endpoint).toBe('https://abc.eu.r2.cloudflarestorage.com');
  });

  it('bez R2_ENDPOINT se adresa složí z účtu', () => {
    expect(r2Endpoint({ R2_ACCOUNT_ID: 'abc' })).toBe('https://abc.r2.cloudflarestorage.com');
  });

  it('chybějící nastavení řekne co', () => {
    expect(() => r2FromEnv({ R2_BUCKET: 'x' })).toThrow(/R2_ENDPOINT/);
  });
});
