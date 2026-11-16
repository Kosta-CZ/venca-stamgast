// Extraligový kotel: týdenní příspěvek o kole extraligy (výsledky, střelci, tabulka, Venca).
// Tady jsou tvary dat a čisté pomocné funkce; stahování a vykreslení jsou zvlášť.

export type Ending = 'reg' | 'ot' | 'so';

export interface KotelScorer {
  /** Jméno tak, jak ho píše zdroj (ČTK): příjmení, při shodě s iniciálou („L. Hudáček“). */
  name: string;
  goals: number;
}

export interface KotelGame {
  home: string;
  away: string;
  homeGoals: number | null;
  awayGoals: number | null;
  ending: Ending;
  homeScorers: KotelScorer[];
  awayScorers: KotelScorer[];
  /** Rozhodující nájezd (jen u `so`). */
  shootoutWinner?: string;
  /** Odložený zápas: nové datum YYYY-MM-DD. */
  postponedTo?: string;
}

export interface TableRow {
  pos: number;
  team: string;
  games: number;
  points: number;
}

export interface KotelFacts {
  round: number;
  /** Den kola pro titulek, např. „neděle 15. 11.“. */
  dayLabel: string;
  games: KotelGame[];
  table: TableRow[];
  /** Muž kola (vybírá Venca z hráčů, kteří v kole skórovali). */
  hero?: { name: string; team: string };
}

export const SUFFIX: Record<Ending, string> = { reg: '', ot: 'pp', so: 'sn' };

export const played = (g: KotelGame) => g.homeGoals !== null && g.awayGoals !== null && !g.postponedTo;

/** „1:4“, „3:2 pp“, „2:1 sn“. */
export function scoreText(g: KotelGame): string {
  if (!played(g)) return '';
  return `${g.homeGoals}:${g.awayGoals}${SUFFIX[g.ending] ? ` ${SUFFIX[g.ending]}` : ''}`;
}

/** „Daňo 2, L. Hudáček, M. Růžička“ (dva a víc gólů číslem za jménem). */
export function scorersText(list: readonly KotelScorer[]): string {
  return list.map((s) => (s.goals > 1 ? `${s.name} ${s.goals}` : s.name)).join(', ');
}

/** Počet gólů, které musí mít střelci týmu: u nájezdů se rozhodující branka do střelců nepočítá. */
export function expectedScorerGoals(g: KotelGame, side: 'home' | 'away'): number {
  const own = (side === 'home' ? g.homeGoals : g.awayGoals) ?? 0;
  const other = (side === 'home' ? g.awayGoals : g.homeGoals) ?? 0;
  return g.ending === 'so' && own > other ? own - 1 : own;
}

/** Kontrola střelců proti skóre: vrací seznam rozporů (prázdný = sedí). */
export function checkScorers(g: KotelGame): string[] {
  if (!played(g)) return [];
  const problems: string[] = [];
  for (const side of ['home', 'away'] as const) {
    const list = side === 'home' ? g.homeScorers : g.awayScorers;
    const got = list.reduce((sum, s) => sum + s.goals, 0);
    const want = expectedScorerGoals(g, side);
    if (got !== want) {
      problems.push(`${g.home} – ${g.away} ${scoreText(g)}: ${side === 'home' ? g.home : g.away} má ve střelcích ${got} gólů, skóre říká ${want}.`);
    }
  }
  return problems;
}

/** Body v extralize: výhra 3, výhra po prodloužení nebo nájezdech 2, prohra po nich 1. */
export function extraligaPoints(own: number, other: number, ending: Ending): number {
  if (own > other) return ending === 'reg' ? 3 : 2;
  return ending === 'reg' ? 0 : 1;
}

/** Tabulka z odehraných zápasů (body, pak rozdíl skóre, pak vstřelené góly). */
export function tableFromGames(games: readonly KotelGame[]): TableRow[] {
  const rows = new Map<string, { team: string; games: number; points: number; gf: number; ga: number }>();
  const row = (team: string) => rows.get(team) ?? rows.set(team, { team, games: 0, points: 0, gf: 0, ga: 0 }).get(team)!;
  for (const g of games) {
    if (!played(g)) continue;
    const h = row(g.home), a = row(g.away);
    const hg = g.homeGoals!, ag = g.awayGoals!;
    h.games++; a.games++;
    h.gf += hg; h.ga += ag; a.gf += ag; a.ga += hg;
    h.points += extraligaPoints(hg, ag, g.ending);
    a.points += extraligaPoints(ag, hg, g.ending);
  }
  return [...rows.values()]
    .sort((x, y) => y.points - x.points || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.team.localeCompare(y.team, 'cs'))
    .map((r, i) => ({ pos: i + 1, team: r.team, games: r.games, points: r.points }));
}

/** „18. 1.“ z YYYY-MM-DD. */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d}. ${m}.`;
}
