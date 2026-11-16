// Ukázková noc pro příkaz `make --demo` (bez sítě): noc na pondělí 9. 11. 2026, jak ji tehdy
// popsaly ČTK, ČT sport a iRozhlas. Id hráčů jsou smyšlená, skutečná dodá NHL API.

import type { Night, NightPlayer, GameLine } from './nhl.ts';
import type { VencaOut } from './venca.ts';

const bufVgk: GameLine = { gameId: 1, home: 'BUF', away: 'VGK', homeScore: 1, awayScore: 4, suffix: '', final: true };
const bosFla: GameLine = { gameId: 2, home: 'BOS', away: 'FLA', homeScore: 4, awayScore: 1, suffix: '', final: true };
const cgyPhi: GameLine = { gameId: 3, home: 'CGY', away: 'PHI', homeScore: 4, awayScore: 3, suffix: 'pp', final: true };

const skater = (id: string, jmeno: string, team: string, goals: number, assists: number, game: GameLine, won: boolean): NightPlayer => ({
  id, jmeno, team, goalie: false, goals, assists, points: goals + assists, shots: 0, toi: '', saves: 0, shotsAgainst: 0, goalsAgainst: 0, savePct: null, game, won,
});

export const SAMPLE_DATE = '2026-11-09';

export const SAMPLE_NIGHT: Night = {
  nhlDate: '2026-11-08',
  unfinished: [],
  players: [
    skater('1', 'Tomáš Hertl', 'VGK', 2, 0, bufVgk, true),
    skater('2', 'David Pastrňák', 'BOS', 0, 2, bosFla, true),
    skater('3', 'Pavel Zacha', 'BOS', 0, 2, bosFla, true),
    { id: '4', jmeno: 'Dan Vladař', team: 'PHI', goalie: true, goals: 0, assists: 0, points: 0, shots: 0, toi: '', saves: 22, shotsAgainst: 26, goalsAgainst: 4, savePct: 22 / 26, game: cgyPhi, won: false },
    skater('5', 'Adam Klapka', 'CGY', 0, 0, cgyPhi, true),
    skater('6', 'Jiří Kulich', 'BUF', 0, 0, bufVgk, false),
    skater('7', 'Radko Gudas', 'FLA', 0, 0, bosFla, false),
  ],
};

/** Vencovy texty k ukázce (místo volání API). */
export const SAMPLE_VENCA: VencaOut = {
  muz_noci: '1',
  titulek: 'Hertl sestřelil Buffalo',
  hlaska: 'Dvě třetiny se rozbruslil a pak to vyřídil za pět minut. Tomu říkám hospodaření se silami.',
  popisek: 'Hertl dvěma góly ve třetí třetině rozhodl v Buffalu, Pastrňák se Zachou přidali po dvou asistencích. Kdo z Čechů vás v noci potěšil nejvíc?',
  hashtagy: ['#NHL', '#CesiVNHL', '#hokej'],
  vyraz: 'radost',
  pozor: [],
};
