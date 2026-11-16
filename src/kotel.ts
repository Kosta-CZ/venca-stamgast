// Extraligový kotel: týdenní příspěvek o kole extraligy (výsledky, střelci, tabulka, Venca).
// Tady jsou tvary dat a čisté pomocné funkce; stahování (sportsdb.ts), střelci (scorers.ts)
// a vykreslení (render/kotel.ts) jsou zvlášť.

import { plural } from './facts.ts';
import { ascii } from './nhl.ts';
import { endingOf, isFinal, type RoundEvent, type StoredRound } from './sportsdb.ts';
import { dayLabel } from './venca.ts';

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
  /** Odložený zápas bez nového data. */
  postponed?: boolean;
  /** Zápas kola hraný mimo dny kola (předehrávka, dohrávka): den YYYY-MM-DD. */
  playedOn?: string;
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
      problems.push(`${g.home} – ${g.away} ${scoreText(g)}: ${side === 'home' ? g.home : g.away} má ve střelcích ${got} ${plural(got, 'gól', 'góly', 'gólů')}, skóre říká ${want}.`);
    }
  }
  return problems;
}

/** Body v extralize: výhra 3, výhra po prodloužení nebo nájezdech 2, prohra po nich 1. */
export function extraligaPoints(own: number, other: number, ending: Ending): number {
  if (own > other) return ending === 'reg' ? 3 : 2;
  return ending === 'reg' ? 0 : 1;
}

interface Stats {
  team: string;
  games: number;
  points: number;
  gf: number;
  ga: number;
}

function stats(games: readonly KotelGame[], only?: ReadonlySet<string>): Map<string, Stats> {
  const rows = new Map<string, Stats>();
  const row = (team: string) => rows.get(team) ?? rows.set(team, { team, games: 0, points: 0, gf: 0, ga: 0 }).get(team)!;
  for (const g of games) {
    if (!played(g)) continue;
    if (only && !(only.has(g.home) && only.has(g.away))) continue;
    const h = row(g.home), a = row(g.away);
    const hg = g.homeGoals!, ag = g.awayGoals!;
    h.games++; a.games++;
    h.gf += hg; h.ga += ag; a.gf += ag; a.ga += hg;
    h.points += extraligaPoints(hg, ag, g.ending);
    a.points += extraligaPoints(ag, hg, g.ending);
  }
  return rows;
}

/**
 * Tabulka z odehraných zápasů. V průběhu sezóny rozhoduje při rovnosti bodů rozdíl skóre, pak vstřelené góly
 * (tak řadí i ČTK). Po základní části (`final`) rozhodují nejdřív vzájemné zápasy týmů se stejným počtem bodů
 * (body, rozdíl skóre, vstřelené góly z minitabulky).
 */
export function tableFromGames(games: readonly KotelGame[], opts: { final?: boolean } = {}): TableRow[] {
  const all = stats(games);
  const mutual = new Map<string, Stats>();
  if (opts.final) {
    const byPoints = new Map<number, string[]>();
    for (const r of all.values()) byPoints.set(r.points, [...(byPoints.get(r.points) ?? []), r.team]);
    for (const teams of byPoints.values()) {
      if (teams.length < 2) continue;
      for (const [team, s] of stats(games, new Set(teams))) mutual.set(team, s);
    }
  }
  const m = (team: string) => mutual.get(team) ?? { points: 0, gf: 0, ga: 0 };
  return [...all.values()]
    .sort((x, y) =>
      y.points - x.points
      || m(y.team).points - m(x.team).points
      || (m(y.team).gf - m(y.team).ga) - (m(x.team).gf - m(x.team).ga)
      || m(y.team).gf - m(x.team).gf
      || (y.gf - y.ga) - (x.gf - x.ga)
      || y.gf - x.gf
      || x.team.localeCompare(y.team, 'cs'))
    .map((r, i) => ({ pos: i + 1, team: r.team, games: r.games, points: r.points }));
}

/** „18. 1.“ z YYYY-MM-DD. */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d}. ${m}.`;
}

// ---- Týmy: názvy z TheSportsDB → čeština (data/extraliga-tymy.json) ----

export interface TeamEntry {
  id?: string;
  nazev: string;
  aliasy?: string[];
}

export type TeamNamer = (id: string | null, name: string) => string | null;

/** Převod týmu: nejdřív podle id v TheSportsDB, pak podle názvu bez diakritiky. Neznámý tým = null. */
export function teamNamer(list: readonly TeamEntry[]): TeamNamer {
  const byId = new Map(list.filter((t) => t.id).map((t) => [t.id as string, t.nazev]));
  const byName = new Map<string, string>();
  for (const t of list) for (const n of [t.nazev, ...(t.aliasy ?? [])]) byName.set(ascii(n), t.nazev);
  return (id, name) => (id ? byId.get(id) : undefined) ?? byName.get(ascii(name)) ?? null;
}

// ---- Kolo z uložených dat ----

/** Zápasy do ±3 dnů od dne, kdy se hrála většina kola, patří do dnů kola; ostatní jsou předehrávky a dohrávky. */
export const ROUND_SPAN_DAYS = 3;

const dayDiff = (a: string, b: string) => (Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;

/** Dny kola, seřazené. */
export function roundDays(events: readonly Pick<RoundEvent, 'date'>[]): string[] {
  const counts = new Map<string, number>();
  for (const e of events) if (e.date) counts.set(e.date, (counts.get(e.date) ?? 0) + 1);
  const mode = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0];
  if (!mode) return [];
  return [...counts.keys()].filter((d) => Math.abs(dayDiff(d, mode)) <= ROUND_SPAN_DAYS).sort();
}

export interface RoundView {
  round: number;
  /** Dny kola a poslední z nich (podle něj id konceptu a tabulka). */
  days: string[];
  date: string;
  dayLabel: string;
  games: KotelGame[];
  /** Zápasy, které se už měly odehrát, ale v datech ještě nemají výsledek. */
  missing: string[];
  /** Týmy, které nejsou v data/extraliga-tymy.json. */
  unknownTeams: string[];
}

const gameOrder = (a: RoundEvent, b: RoundEvent, home: (e: RoundEvent) => string) =>
  (a.date ?? '9999').localeCompare(b.date ?? '9999') || (a.time ?? '').localeCompare(b.time ?? '') || home(a).localeCompare(home(b), 'cs');

/**
 * Kolo pro příspěvek: zápasy s českými názvy týmů, konec zápasu (pp, sn), odložené zápasy s novým datem
 * a zápasy, kterým ještě chybí výsledek. Pořadí jako u ČTK: podle začátku, pak podle domácích.
 */
export function roundView(r: StoredRound, name: TeamNamer, today: string): RoundView {
  const days = roundDays(r.events.filter((e) => isFinal(e) || !e.postponed));
  const last = days[days.length - 1] ?? r.events.map((e) => e.date ?? '').sort().pop() ?? today;
  const unknownTeams = new Set<string>();
  const cz = (id: string | null, raw: string) => {
    const n = name(id, raw);
    if (!n) unknownTeams.add(raw);
    return n ?? raw;
  };
  const home = (e: RoundEvent) => cz(e.homeId, e.home);
  const missing: string[] = [];

  const finals = r.events.filter(isFinal).sort((a, b) => gameOrder(a, b, home));
  const open = r.events.filter((e) => !isFinal(e)).sort((a, b) => gameOrder(a, b, home));
  const games: KotelGame[] = [...finals, ...open].map((e) => {
    const g: KotelGame = { home: home(e), away: cz(e.awayId, e.away), homeGoals: null, awayGoals: null, ending: 'reg', homeScorers: [], awayScorers: [] };
    if (isFinal(e)) {
      g.homeGoals = e.homeGoals;
      g.awayGoals = e.awayGoals;
      g.ending = endingOf(e.status);
      if (e.date && !days.includes(e.date)) g.playedOn = e.date;
    } else if (e.date && e.date > last) {
      g.postponedTo = e.date;
    } else if (e.postponed) {
      g.postponed = true;
    } else if (!e.date || e.date <= today) {
      missing.push(`${g.home} – ${g.away}`);
    }
    return g;
  });

  return { round: r.round, days, date: last, dayLabel: daysLabel(days.length ? days : [last]), games, missing, unknownTeams: [...unknownTeams] };
}

/** „neděle 15. 11.“, „čtvrtek 19. 11. a pátek 20. 11.“, u tří a více dnů rozsah „19.–22. 9.“. */
export function daysLabel(days: readonly string[]): string {
  if (days.length <= 2) return days.map(dayLabel).join(' a ');
  const [first, last] = [days[0]!, days[days.length - 1]!];
  const [, m1, d1] = first.split('-').map(Number);
  const [, m2] = last.split('-').map(Number);
  return m1 === m2 ? `${d1}.–${shortDate(last)}` : `${shortDate(first)}–${shortDate(last)}`;
}

/** Kolo, které se už odehrálo: poslední den minul, nebo je dnes a všechno je dohrané. */
export const roundIsPast = (v: RoundView, today: string): boolean =>
  v.date < today || (v.date === today && v.missing.length === 0 && v.games.some(played));

/** Poslední odehrané kolo (pro sobotní příspěvek); undefined na začátku sezóny. */
export function latestRound(views: readonly RoundView[], today: string): RoundView | undefined {
  return views.filter((v) => roundIsPast(v, today)).sort((a, b) => b.date.localeCompare(a.date) || b.round - a.round)[0];
}

/**
 * Tabulka k danému dni: všechny dohrané zápasy ze všech uložených kol do toho dne včetně. Když je k tomu dni
 * dohraná celá základní část, rozhodují při rovnosti bodů vzájemné zápasy.
 */
export function tableAsOf(rounds: Iterable<StoredRound>, cutoff: string, name: TeamNamer): TableRow[] {
  const games: KotelGame[] = [];
  let final = true;
  for (const r of rounds) {
    for (const e of r.events) {
      if (!isFinal(e) || !e.date || e.date > cutoff) {
        final = false;
        continue;
      }
      games.push({
        home: name(e.homeId, e.home) ?? e.home, away: name(e.awayId, e.away) ?? e.away,
        homeGoals: e.homeGoals, awayGoals: e.awayGoals, ending: endingOf(e.status), homeScorers: [], awayScorers: [],
      });
    }
  }
  return tableFromGames(games, { final });
}

/** Střelci kola (kandidáti na muže kola) s týmem a počtem gólů. */
export function roundScorers(games: readonly KotelGame[]): { name: string; team: string; goals: number; won: boolean }[] {
  const out: { name: string; team: string; goals: number; won: boolean }[] = [];
  for (const g of games) {
    if (!played(g)) continue;
    for (const [list, team, own, other] of [[g.homeScorers, g.home, g.homeGoals!, g.awayGoals!], [g.awayScorers, g.away, g.awayGoals!, g.homeGoals!]] as const) {
      for (const s of list) out.push({ name: s.name, team, goals: s.goals, won: own > other });
    }
  }
  return out;
}

/** Výchozí muž kola: nejvíc gólů, pak vítězný tým, pak pořadí v kole. */
export function defaultHero(games: readonly KotelGame[]): { name: string; team: string } | undefined {
  const best = roundScorers(games).map((s, i) => ({ ...s, i })).sort((a, b) => b.goals - a.goals || Number(b.won) - Number(a.won) || a.i - b.i)[0];
  return best ? { name: best.name, team: best.team } : undefined;
}
