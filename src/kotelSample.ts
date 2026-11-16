// Ukázkové kolo pro příkaz `kotel --demo` (bez sítě): 19. kolo extraligy v neděli 15. 11. 2026, jak ho
// popsala ČTK (výsledky souhlasí s TheSportsDB, zápas Kometa – Vary je tam přeložený na 18. 1.).

import type { KotelFacts } from './kotel.ts';
import type { VencaOut } from './venca.ts';

export const SAMPLE_KOTEL: KotelFacts = {
  round: 19,
  dayLabel: 'neděle 15. 11.',
  hero: { name: 'Daňo', team: 'Třinec' },
  games: [
    { home: 'Kladno', away: 'Třinec', homeGoals: 1, awayGoals: 4, ending: 'reg',
      homeScorers: [{ name: 'Kempný', goals: 1 }],
      awayScorers: [{ name: 'Daňo', goals: 2 }, { name: 'L. Hudáček', goals: 1 }, { name: 'M. Růžička', goals: 1 }] },
    { home: 'Liberec', away: 'Litvínov', homeGoals: 5, awayGoals: 1, ending: 'reg',
      homeScorers: [{ name: 'Rychlovský', goals: 1 }, { name: 'A. Najman', goals: 1 }, { name: 'Sandberg', goals: 1 }, { name: 'F. Jansa', goals: 1 }, { name: 'D. Zeman', goals: 1 }],
      awayScorers: [{ name: 'M. Sukeľ', goals: 1 }] },
    { home: 'Sparta', away: 'Hradec Králové', homeGoals: 1, awayGoals: 3, ending: 'reg',
      homeScorers: [{ name: 'Řepík', goals: 1 }],
      awayScorers: [{ name: 'Čacho', goals: 1 }, { name: 'Vukojevic', goals: 1 }, { name: 'R. Pavlík', goals: 1 }] },
    { home: 'Budějovice', away: 'Pardubice', homeGoals: 2, awayGoals: 1, ending: 'reg',
      homeScorers: [{ name: 'Ordoš', goals: 1 }, { name: 'M. Beránek', goals: 1 }],
      awayScorers: [{ name: 'Tomášek', goals: 1 }] },
    { home: 'Vítkovice', away: 'Olomouc', homeGoals: 2, awayGoals: 1, ending: 'so', shootoutWinner: 'Hrivík',
      homeScorers: [{ name: 'Abdul', goals: 1 }],
      awayScorers: [{ name: 'M. Vitouch', goals: 1 }] },
    { home: 'Plzeň', away: 'Boleslav', homeGoals: 3, awayGoals: 2, ending: 'ot',
      homeScorers: [{ name: 'Teplý', goals: 1 }, { name: 'Merežko', goals: 2 }],
      awayScorers: [{ name: 'Fořt', goals: 1 }, { name: 'Zvagulis', goals: 1 }] },
    { home: 'Kometa', away: 'Karlovy Vary', homeGoals: null, awayGoals: null, ending: 'reg',
      homeScorers: [], awayScorers: [], postponedTo: '2027-01-18' },
  ],
  table: [
    { pos: 1, team: 'Třinec', games: 19, points: 48 },
    { pos: 2, team: 'Pardubice', games: 19, points: 39 },
    { pos: 3, team: 'Kladno', games: 19, points: 32 },
    { pos: 4, team: 'Budějovice', games: 19, points: 32 },
  ],
};

export const SAMPLE_KOTEL_VENCA: Pick<VencaOut, 'titulek' | 'hlaska' | 'vyraz'> = {
  titulek: 'Třinec vyřídil Kladno jednou třetinou',
  hlaska: 'Čtyři góly v jedné třetině. To jsem v ’91 zvládal taky, jenže na druhé straně.',
  vyraz: 'rikal',
};
