// TheSportsDB: volný zdroj výsledků extraligy (veřejný klíč 123, bez registrace, za data se neplatí).
// Limit dotazů je přísný (po pár rychlých dotazech vrací 429): dotazy jdou pomalu za sebou a při 429
// se čeká a zkouší znovu. Kola se ukládají (R2: kotel/<sezóna>/kolo-NN.json) a znovu se stahují jen ta,
// kde od minula mohl přibýt výsledek. Tabulka se pak počítá z uložených kol (kotel.ts).

import type { Store } from './storage.ts';

export const TSDB_BASE = 'https://www.thesportsdb.com/api/v1/json/123';
export const EXTRALIGA_ID = 4923;
const UA = { 'user-agent': 'venca-stamgast (https://github.com/Kosta-CZ/venca-stamgast)' };

/** Zápas, jak ho vrací TheSportsDB (jen pole, která čteme). */
export interface TsdbEvent {
  idEvent: string;
  idHomeTeam?: string | null;
  idAwayTeam?: string | null;
  strHomeTeam?: string | null;
  strAwayTeam?: string | null;
  intHomeScore?: string | number | null;
  intAwayScore?: string | number | null;
  dateEvent?: string | null;
  strTime?: string | null;
  strStatus?: string | null;
  strPostponed?: string | null;
}

/** Zápas v uloženém kole: krátký tvar bez obrázků a odkazů. Názvy týmů jsou tak, jak je píše TheSportsDB. */
export interface RoundEvent {
  id: string;
  homeId: string | null;
  awayId: string | null;
  home: string;
  away: string;
  homeGoals: number | null;
  awayGoals: number | null;
  /** Den zápasu YYYY-MM-DD (u odloženého zápasu nové datum). */
  date: string | null;
  time: string | null;
  /** Stav podle TheSportsDB: FT, AOT (po prodloužení), AP (po nájezdech), NS (nehráno)… */
  status: string;
  postponed: boolean;
}

export interface StoredRound {
  season: string;
  round: number;
  fetchedAt: string;
  events: RoundEvent[];
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function slimEvent(e: TsdbEvent): RoundEvent {
  return {
    id: String(e.idEvent),
    homeId: text(e.idHomeTeam),
    awayId: text(e.idAwayTeam),
    home: text(e.strHomeTeam) ?? '?',
    away: text(e.strAwayTeam) ?? '?',
    homeGoals: num(e.intHomeScore),
    awayGoals: num(e.intAwayScore),
    date: text(e.dateEvent),
    time: text(e.strTime),
    status: text(e.strStatus) ?? '',
    postponed: /^(yes|true|1)$/i.test(text(e.strPostponed) ?? ''),
  };
}

const FINAL = new Set(['FT', 'AOT', 'AP', 'AET', 'PEN', 'MATCH FINISHED']);

/** Dohraný zápas se skóre (konec v základní době, po prodloužení nebo po nájezdech). */
export const isFinal = (e: Pick<RoundEvent, 'status' | 'homeGoals' | 'awayGoals'>): boolean =>
  e.homeGoals !== null && e.awayGoals !== null && FINAL.has(e.status.toUpperCase());

/** Konec zápasu podle stavu: AOT = prodloužení, AP = nájezdy. */
export function endingOf(status: string): 'reg' | 'ot' | 'so' {
  const s = status.toUpperCase();
  if (s === 'AOT' || s === 'AET') return 'ot';
  if (s === 'AP' || s === 'PEN') return 'so';
  return 'reg';
}

/** Sezóna extraligy pro den (srpen až červenec): 2026-11-15 → „2026-2027“. */
export function seasonFor(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return m >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

// ---- Pomalé dotazy ----

export interface PacedIo {
  fetch: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  /** Pauza mezi dotazy v ms. Výchozí 7 s: TheSportsDB pustí asi 10 dotazů za minutu, pak 429 a 2 minuty pauza. */
  gapMs?: number;
}

/** Čekání po 429 (nebo výpadku): pak to úloha vzdá a ohlásí chybu. */
export const BACKOFF_MS = [20_000, 45_000, 75_000, 120_000, 180_000];

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Funkce na dotazy do TheSportsDB s pauzou mezi dotazy a opakováním po 429. */
export function tsdbGetter(io: PacedIo): (path: string) => Promise<unknown> {
  const sleep = io.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = io.log ?? (() => {});
  const gap = io.gapMs ?? 7000;
  let last = Number.NEGATIVE_INFINITY;

  return async (path: string) => {
    for (let attempt = 0; ; attempt++) {
      const wait = last + gap - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      let problem: string;
      let retryAfter = 0;
      try {
        const res = await io.fetch(`${TSDB_BASE}/${path}`, { headers: UA });
        if (res.ok) {
          const body = await res.text();
          try {
            return JSON.parse(body) as unknown;
          } catch {
            problem = `odpověď není JSON (${body.slice(0, 60).replace(/\s+/g, ' ')})`;
          }
        } else if (res.status === 429 || res.status >= 500) {
          problem = `stav ${res.status}`;
          retryAfter = Number(res.headers.get('retry-after')) || 0;
        } else {
          throw new Error(`TheSportsDB odmítl ${path}: stav ${res.status}.`);
        }
      } catch (e) {
        if (msg(e).startsWith('TheSportsDB odmítl')) throw e;
        problem = `neodpovídá (${msg(e)})`;
      }
      const delay = retryAfter > 0 && retryAfter <= 600 ? retryAfter * 1000 : BACKOFF_MS[attempt];
      if (delay === undefined) throw new Error(`TheSportsDB: ${path} ${problem} ani po ${attempt + 1} pokusech.`);
      log(`TheSportsDB: ${path} ${problem}, čekám ${Math.round(delay / 1000)} s a zkusím to znovu.`);
      await sleep(delay);
    }
  };
}

export async function fetchRound(get: (path: string) => Promise<unknown>, season: string, round: number): Promise<RoundEvent[]> {
  const body = (await get(`eventsround.php?id=${EXTRALIGA_ID}&r=${round}&s=${season}`)) as { events?: TsdbEvent[] | null } | null;
  return (body?.events ?? []).filter((e) => e && e.idEvent).map(slimEvent);
}

// ---- Uložená kola ----

/** Víc kol extraliga nemá (52 v sezóně se 14 týmy); dál se nehledá. */
export const MAX_ROUNDS = 60;

export const roundKey = (season: string, round: number): string => `kotel/${season}/kolo-${String(round).padStart(2, '0')}.json`;

/** Má kolo zápas bez výsledku, který se už měl odehrát? Pak se stáhne znovu. */
export const awaitingResults = (r: StoredRound, today: string): boolean =>
  r.events.some((e) => !isFinal(e) && (!e.date || e.date <= today));

const firstOpenDate = (r: StoredRound): string =>
  r.events.filter((e) => !isFinal(e)).map((e) => e.date ?? '9999').sort()[0] ?? '9999';

export interface SyncOptions {
  /** Dnešek v Praze (YYYY-MM-DD). */
  today: string;
  /** Kola, která se stáhnou znovu vždy (kolo příspěvku). */
  force?: number[];
  /** Kolik kol s budoucími zápasy se obnoví, když jsou uložená déle než `staleDays` (rozpis se mění). */
  staleLimit?: number;
  staleDays?: number;
  now?: Date;
  log?: (line: string) => void;
}

/**
 * Doplní uložená kola sezóny z TheSportsDB a vrátí je všechna. Stahuje jen kola, která chybí,
 * čekají na výsledek, jsou vynucená, nebo mají starý rozpis (nejvýš `staleLimit`). Hledání nových kol
 * skončí u prvního prázdného (konec sezóny).
 */
export async function syncRounds(
  get: (path: string) => Promise<unknown>,
  store: Store,
  season: string,
  opts: SyncOptions,
): Promise<Map<number, StoredRound>> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? new Date();
  const rounds = new Map<number, StoredRound>();
  const all = Array.from({ length: MAX_ROUNDS }, (_, i) => i + 1);

  for (let i = 0; i < all.length; i += 10) {
    await Promise.all(
      all.slice(i, i + 10).map(async (n) => {
        const body = await store.get(roundKey(season, n));
        if (!body) return;
        try {
          const r = JSON.parse(body) as StoredRound;
          if (Array.isArray(r.events) && r.events.length) rounds.set(n, r);
        } catch {
          log(`Uložené kolo ${n} je poškozené, stáhnu ho znovu.`);
        }
      }),
    );
  }

  const staleBefore = new Date(now.getTime() - (opts.staleDays ?? 6) * 86_400_000).toISOString();
  const stale = new Set(
    [...rounds.values()]
      .filter((r) => r.fetchedAt < staleBefore && r.events.some((e) => !isFinal(e)) && !awaitingResults(r, opts.today))
      .sort((a, b) => firstOpenDate(a).localeCompare(firstOpenDate(b)))
      .slice(0, opts.staleLimit ?? 6)
      .map((r) => r.round),
  );
  const force = new Set(opts.force ?? []);

  let requests = 0;
  for (const n of all) {
    const have = rounds.get(n);
    const why = !have ? 'nové' : force.has(n) ? 'kolo příspěvku' : awaitingResults(have, opts.today) ? 'čeká na výsledky' : stale.has(n) ? 'obnova rozpisu' : null;
    if (!why) continue;
    const events = await fetchRound(get, season, n);
    requests++;
    if (!events.length) {
      if (!have) {
        log(`Kolo ${n} v TheSportsDB není, sezóna ${season} má ${n - 1} kol.`);
        break;
      }
      log(`Kolo ${n} přišlo prázdné, nechávám uložené.`);
      continue;
    }
    const r: StoredRound = { season, round: n, fetchedAt: now.toISOString(), events };
    await store.put(roundKey(season, n), JSON.stringify(r, null, 1));
    rounds.set(n, r);
    log(`Kolo ${n}: ${why}, dohráno ${events.filter(isFinal).length} z ${events.length}.`);
  }
  log(`TheSportsDB: ${requests} dotazů, uložených kol ${rounds.size} (${store.label}).`);
  return rounds;
}
