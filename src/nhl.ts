// Data z NHL: výsledky noci a zápisy zápasů z veřejného API (api-web.nhle.com, bez klíče).
// Stahování je tenké (`fetchNight`), všechno ostatní jsou čisté funkce nad odpověďmi API,
// aby šly zkoušet bez sítě. API není oficiálně zdokumentované: čteme ho opatrně a co chybí, bereme jako nulu.

export const NHL_API = 'https://api-web.nhle.com/v1';

// ---- Tvar odpovědí API (jen to, co potřebujeme) ----

export interface ScoreTeam {
  abbrev: string;
  score?: number;
}

export interface ScoreGame {
  id: number;
  gameState?: string;
  homeTeam: ScoreTeam;
  awayTeam: ScoreTeam;
  gameOutcome?: { lastPeriodType?: string };
}

export interface ScoreResponse {
  games?: ScoreGame[];
}

export interface BoxSkater {
  playerId: number;
  name?: { default?: string };
  goals?: number;
  assists?: number;
  points?: number;
  sog?: number;
  shots?: number;
  toi?: string;
}

export interface BoxGoalie {
  playerId: number;
  name?: { default?: string };
  saveShotsAgainst?: string;
  saves?: number;
  shotsAgainst?: number;
  goalsAgainst?: number;
  savePctg?: number | string;
  toi?: string;
}

export interface BoxTeamStats {
  forwards?: BoxSkater[];
  defense?: BoxSkater[];
  goalies?: BoxGoalie[];
}

export interface Boxscore {
  id: number;
  homeTeam: { abbrev: string };
  awayTeam: { abbrev: string };
  playerByGameStats?: { homeTeam?: BoxTeamStats; awayTeam?: BoxTeamStats };
}

// ---- Čeští hráči ----

export interface CzPlayer {
  jmeno: string;
  pozice: 'G' | 'D' | 'F';
  tym?: string;
  nhlId?: number;
}

/** Text bez diakritiky, malými písmeny, s jednou mezerou. */
export function ascii(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Klíč jména, jak ho píše NHL v zápisu: „D. Pastrnak“ → „d. pastrnak“. */
export function nameKey(fullName: string): string {
  const parts = ascii(fullName).split(' ');
  const last = parts[parts.length - 1] ?? '';
  const first = parts[0] ?? '';
  return `${first.charAt(0)}. ${last}`;
}

/** Klíč jména ze zápisu NHL (už bývá ve tvaru iniciála + příjmení). */
export function boxKey(name: string | undefined): string {
  const n = ascii(name ?? '');
  if (/^[a-z]\. /.test(n)) return n;
  return nameKey(n);
}

// ---- Týmy ----

export const TEAM_NAMES: Record<string, string> = {
  ANA: 'Anaheim', BOS: 'Boston', BUF: 'Buffalo', CGY: 'Calgary', CAR: 'Carolina', CHI: 'Chicago',
  COL: 'Colorado', CBJ: 'Columbus', DAL: 'Dallas', DET: 'Detroit', EDM: 'Edmonton', FLA: 'Florida',
  LAK: 'Los Angeles', MIN: 'Minnesota', MTL: 'Montreal', NSH: 'Nashville', NJD: 'New Jersey',
  NYI: 'Islanders', NYR: 'Rangers', OTT: 'Ottawa', PHI: 'Philadelphia', PIT: 'Pittsburgh',
  SJS: 'San Jose', SEA: 'Seattle', STL: 'St. Louis', TBL: 'Tampa Bay', TOR: 'Toronto', UTA: 'Utah',
  VAN: 'Vancouver', VGK: 'Vegas', WSH: 'Washington', WPG: 'Winnipeg',
};

export const teamName = (abbrev: string): string => TEAM_NAMES[abbrev] ?? abbrev;

// ---- Zápasy ----

export const FINAL_STATES = new Set(['OFF', 'FINAL']);

export interface GameLine {
  gameId: number;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  /** '' v základní době, 'pp' po prodloužení, 'sn' po nájezdech. */
  suffix: '' | 'pp' | 'sn';
  final: boolean;
}

export function gameLine(g: ScoreGame): GameLine {
  const type = g.gameOutcome?.lastPeriodType ?? 'REG';
  return {
    gameId: g.id,
    home: g.homeTeam.abbrev,
    away: g.awayTeam.abbrev,
    homeScore: g.homeTeam.score ?? 0,
    awayScore: g.awayTeam.score ?? 0,
    suffix: type === 'OT' ? 'pp' : type === 'SO' ? 'sn' : '',
    final: FINAL_STATES.has(g.gameState ?? ''),
  };
}

/** „Buffalo – Vegas 1:4“ (domácí první, jako u nás). */
export function lineText(l: GameLine): string {
  return `${teamName(l.home)} – ${teamName(l.away)} ${l.homeScore}:${l.awayScore}${l.suffix ? ` ${l.suffix}` : ''}`;
}

/** Vyhrál tým hráče? */
export function teamWon(l: GameLine, team: string): boolean {
  return team === l.home ? l.homeScore > l.awayScore : l.awayScore > l.homeScore;
}

// ---- Výkon Čecha v noci ----

export interface NightPlayer {
  /** Id hráče v NHL jako text (pod ním ho vybírá Venca). */
  id: string;
  jmeno: string;
  team: string;
  goalie: boolean;
  goals: number;
  assists: number;
  points: number;
  shots: number;
  toi: string;
  saves: number;
  shotsAgainst: number;
  goalsAgainst: number;
  /** Úspěšnost zákroků 0–1 (jen brankář). */
  savePct: number | null;
  game: GameLine;
  won: boolean;
  /** Rozpor v datech NHL, který má zkontrolovat člověk. */
  note?: string;
}

function goalieNumbers(g: BoxGoalie): { saves: number; shotsAgainst: number; goalsAgainst: number; savePct: number | null; note?: string } {
  let saves = g.saves ?? NaN;
  let shotsAgainst = g.shotsAgainst ?? NaN;
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(g.saveShotsAgainst ?? '');
  if (m) {
    saves = Number.isFinite(saves) ? saves : Number(m[1]);
    shotsAgainst = Number.isFinite(shotsAgainst) ? shotsAgainst : Number(m[2]);
  }
  saves = Number.isFinite(saves) ? saves : 0;
  shotsAgainst = Number.isFinite(shotsAgainst) ? shotsAgainst : 0;
  // Obdržené góly se počítají ze střel a zákroků, aby seděly s úspěšností v grafice.
  // Když API uvádí jiné číslo, jde to ke kontrole (stalo se 15. 11. 2026 u Vladaře: 16/19, ale 4 góly).
  const goalsAgainst = shotsAgainst > 0 ? Math.max(0, shotsAgainst - saves) : (g.goalsAgainst ?? 0);
  const pct = shotsAgainst > 0 ? saves / shotsAgainst : null;
  const note = g.goalsAgainst !== undefined && shotsAgainst > 0 && g.goalsAgainst !== goalsAgainst
    ? `NHL uvádí ${g.goalsAgainst} obdržené góly, ale ${saves} zákroků z ${shotsAgainst} střel dává ${goalsAgainst}.`
    : undefined;
  return { saves, shotsAgainst, goalsAgainst, savePct: pct, ...(note ? { note } : {}) };
}

/** Odehrál brankář aspoň kus zápasu? (Náhradník na lavičce má v zápisu nulový čas.) */
function played(toi: string | undefined): boolean {
  if (!toi) return true;
  return !/^0?0:00$/.test(toi.trim());
}

/**
 * Čeští hráči v jednom zápase. Hledá podle nhlId, jinak podle iniciály a příjmení bez diakritiky.
 * Hráč, který nenastoupil (není v zápisu nebo má nulový čas), se nevypíše.
 */
export function czechInBox(box: Boxscore, line: GameLine, czechs: readonly CzPlayer[]): NightPlayer[] {
  const byId = new Map(czechs.filter((c) => c.nhlId).map((c) => [c.nhlId as number, c]));
  const byName = new Map(czechs.map((c) => [nameKey(c.jmeno), c]));
  const out: NightPlayer[] = [];
  for (const side of ['homeTeam', 'awayTeam'] as const) {
    const stats = box.playerByGameStats?.[side];
    const team = box[side].abbrev;
    if (!stats) continue;
    const find = (p: { playerId: number; name?: { default?: string } }) => byId.get(p.playerId) ?? byName.get(boxKey(p.name?.default));
    for (const p of [...(stats.forwards ?? []), ...(stats.defense ?? [])]) {
      const cz = find(p);
      if (!cz || !played(p.toi)) continue;
      const goals = p.goals ?? 0;
      const assists = p.assists ?? 0;
      out.push({
        id: String(p.playerId), jmeno: cz.jmeno, team, goalie: false,
        goals, assists, points: p.points ?? goals + assists, shots: p.sog ?? p.shots ?? 0, toi: p.toi ?? '',
        saves: 0, shotsAgainst: 0, goalsAgainst: 0, savePct: null,
        game: line, won: teamWon(line, team),
      });
    }
    for (const g of stats.goalies ?? []) {
      const cz = find(g);
      if (!cz || !played(g.toi)) continue;
      const n = goalieNumbers(g);
      if (n.shotsAgainst === 0 && !g.toi) continue;
      out.push({
        id: String(g.playerId), jmeno: cz.jmeno, team, goalie: true,
        goals: 0, assists: 0, points: 0, shots: 0, toi: g.toi ?? '',
        ...n, game: line, won: teamWon(line, team),
      });
    }
  }
  return out;
}

export interface Night {
  /** Den v USA, kdy se hrálo (datum NHL). */
  nhlDate: string;
  players: NightPlayer[];
  /** Zápasy noci, které v době běhu ještě nebyly dohrané (do příspěvku nejdou, mohli v nich hrát Češi). */
  unfinished: string[];
}

export interface NhlIo {
  fetch: typeof fetch;
}

async function getJson<T>(io: NhlIo, url: string): Promise<T> {
  const res = await io.fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'venca-stamgast (github.com/Kosta-CZ/venca-stamgast)' } });
  if (!res.ok) throw new Error(`NHL API ${url} vrátilo stav ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Celá noc: výsledky dne `nhlDate` (datum v USA) a zápisy dohraných zápasů. Nedohrané zápasy se
 * vrátí jen jako upozornění; na Čechy v nich se nedá spolehnout.
 */
export async function fetchNight(io: NhlIo, nhlDate: string, czechs: readonly CzPlayer[]): Promise<Night> {
  const score = await getJson<ScoreResponse>(io, `${NHL_API}/score/${nhlDate}`);
  const players: NightPlayer[] = [];
  const unfinished: string[] = [];
  for (const g of score.games ?? []) {
    const line = gameLine(g);
    if (!line.final) {
      unfinished.push(`${teamName(line.home)} – ${teamName(line.away)}`);
      continue;
    }
    const box = await getJson<Boxscore>(io, `${NHL_API}/gamecenter/${g.id}/boxscore`);
    players.push(...czechInBox(box, line, czechs));
  }
  return { nhlDate, players, unfinished };
}

/** Datum NHL (den v USA) pro ranní příspěvek v Česku: noc na `pragueDate` se hrála den předtím. */
export function nhlDateFor(pragueDate: string): string {
  const d = new Date(`${pragueDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
