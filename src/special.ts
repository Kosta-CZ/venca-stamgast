// Speciál k velké akci Čecha (první: Jiří Procházka v UFC, sobota 21. 11. 2026). Dvě verze:
// odpoledne pozvánka (soupeř, bilance, místo, čas) a po zápase výsledek (vítěz, způsob, kolo, čas).
// Akce se popisují v data/specialy/*.json, takže šablona i úloha poslouží i pro další velké akce.
//
// Fakta dohledá Claude API s vyhledáváním dvakrát nezávisle: jednou jen v mezinárodních zdrojích (A),
// jednou jen v českých (B). Kód obě verze porovná údaj po údaji: každý údaj musí sedět v obou, jinak
// jde do „pozor“. Časy převádí na pražský čas kód, ne AI.

import { askWithSearch, onDomains, normalizeUrl, type ClaudeIo } from './claude.ts';
import { numbersIn } from './facts.ts';
import { ascii } from './nhl.ts';
import { sourceLabel } from './scorers.ts';
import { checkExpression, cleanHashtags, dayLabel, LIMITS, parseJsonLoose, str, vencaNotes, words, type Expression } from './venca.ts';

export type Stage = 'pozvanka' | 'vysledek';
export const STAGE_LABEL: Record<Stage, string> = { pozvanka: 'pozvánka', vysledek: 'výsledek' };

/** Popis akce v data/specialy/<název>.json. */
export interface SpecialEvent {
  /** Část id konceptu: „mma“ dá 2026-11-21-mma-pozvanka a 2026-11-21-mma-vysledek. */
  id: string;
  /** Den akce podle pražského času (YYYY-MM-DD). */
  datum: string;
  sport: string;
  /** Štítek v grafice, např. „UFC“. */
  stitek: string;
  /** Název akce do grafiky, např. „UFC Fight Night“. */
  akce: string;
  cech: string;
  souper: string;
  /** Popis zápasu pro hledání. */
  zadani: string;
  /** Časové pásmo místa konání (pro „místní čas“ ve zdrojích), např. Asia/Qatar. */
  pasmo: string;
  /** Mezinárodní zdroje (A) a české zdroje (B): dvě nezávislá hledání. */
  zdroje_a: string[];
  zdroje_b: string[];
  hashtagy: string[];
}

export const specialId = (e: Pick<SpecialEvent, 'datum' | 'id'>, stage: Stage): string => `${e.datum}-${e.id}-${stage}`;

/** Akce pro dnešek: pozvánka jen v den akce, výsledek i den po ní (zápas končí kolem půlnoci). */
export function pickEvent(events: readonly SpecialEvent[], stage: Stage, today: string): SpecialEvent | undefined {
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return events.find((e) => e.datum === today) ?? (stage === 'vysledek' ? events.find((e) => e.datum === yesterday) : undefined);
}

// ---- Co vrací hledání ----

export interface InviteReport {
  found: boolean;
  opponent: string | null;
  czechRecord: string | null;
  opponentRecord: string | null;
  city: string | null;
  arena: string | null;
  date: string | null;
  start: { time: string; zone: string } | null;
  weightClass: string | null;
  rounds: number | null;
  sources: string[];
  note: string;
}

export interface ResultReport {
  finished: boolean;
  winner: string | null;
  method: string | null;
  round: number | null;
  time: string | null;
  sources: string[];
  note: string;
}

export const WEIGHT_CLASSES = ['slámová', 'muší', 'bantamová', 'pérová', 'lehká', 'welterová', 'střední', 'polotěžká', 'těžká'];
export const METHODS = ['KO', 'TKO', 'submise', 'jednomyslné rozhodnutí', 'většinové rozhodnutí', 'dělené rozhodnutí', 'remíza', 'diskvalifikace', 'bez výsledku'];

const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const int = (v: unknown): number | null => (Number.isInteger(Number(v)) && v !== null && v !== '' ? Number(v) : null);
const urls = (v: unknown): string[] => (Array.isArray(v) ? v : []).filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u.trim())).map((u) => u.trim());

export function parseInvite(text: string): InviteReport {
  const o = parseJsonLoose(text) as Record<string, unknown>;
  const start = (o.hlavni_karta && typeof o.hlavni_karta === 'object' ? o.hlavni_karta : {}) as Record<string, unknown>;
  return {
    found: o.nalezeno !== false,
    opponent: s(o.souper),
    czechRecord: s(o.bilance_cecha),
    opponentRecord: s(o.bilance_soupere),
    city: s(o.mesto),
    arena: s(o.arena),
    date: s(o.datum),
    start: s(start.cas) ? { time: s(start.cas)!, zone: s(start.pasmo) ?? '' } : null,
    weightClass: s(o.vaha),
    rounds: int(o.pocet_kol),
    sources: urls(o.zdroje),
    note: s(o.poznamka) ?? '',
  };
}

export function parseResult(text: string): ResultReport {
  const o = parseJsonLoose(text) as Record<string, unknown>;
  return {
    finished: o.skonceno === true,
    winner: s(o.vitez),
    method: s(o.zpusob),
    round: int(o.kolo),
    time: s(o.cas),
    sources: urls(o.zdroje),
    note: s(o.poznamka) ?? '',
  };
}

// ---- Převody a porovnání ----

/** Bilance „32-6-1“, „32–6–1 (1 NC)“ → [výhry, prohry, remízy]; nečitelná = null. */
export function parseRecord(text: string | null): [number, number, number] | null {
  const m = /(\d+)\s*[-–—]\s*(\d+)(?:\s*[-–—]\s*(\d+))?/.exec(text ?? '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}
export const recordText = (r: [number, number, number]): string => r.join('-');

const ZONES: [RegExp, string][] = [
  [/^(e[sd]?t|eastern|new york)/, 'America/New_York'],
  [/^(p[sd]?t|pacific)/, 'America/Los_Angeles'],
  [/^(sec|selc|cet|cest|praha|prague|nasi?ho casu|cesk)/, 'Europe/Prague'],
  [/^(utc|gmt|z)$/, 'UTC'],
];

/** Posun pásma v minutách v daný okamžik (Intl, bez knihoven). */
function offsetMinutes(at: number, timeZone: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return Math.round((local - at) / 60_000);
}

/**
 * Čas ze zdroje („13:00“ + „ET“, „1:00 PM ET“, „21:00 místního času“, „GMT+3“) → den a čas v Praze.
 * Nečitelný čas nebo pásmo = null.
 */
export function toPrague(date: string, time: string, zone: string, localZone?: string): { date: string; time: string } | null {
  const t = /(\d{1,2})[:.](\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/i.exec(time);
  if (!t) return null;
  let h = Number(t[1]);
  const min = Number(t[2]);
  const ampm = (t[3] ?? /\b(am|pm)\b/i.exec(`${time} ${zone}`)?.[1] ?? '').toLowerCase().replace(/\./g, '');
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  const z = ascii(`${zone} ${time.replace(t[0], '')}`).replace(/\b(am|pm|cas[a-z]*)\b/g, '').trim();
  const gmt = /(?:gmt|utc)\s*([+-])\s*(\d{1,2})/.exec(z);
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, mo - 1, d, h, min);
  let utc: number;
  if (gmt) {
    utc = wall - (gmt[1] === '-' ? -1 : 1) * Number(gmt[2]) * 3_600_000;
  } else {
    const tz = /^(mistni|local|mistniho)/.test(z) ? localZone : ZONES.find(([re]) => re.test(z))?.[1];
    if (!tz) return null;
    utc = wall - offsetMinutes(wall, tz) * 60_000;
    utc = wall - offsetMinutes(utc, tz) * 60_000;
  }
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Prague', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(utc)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

const surname = (name: string) => ascii(name).split(' ').pop() ?? '';
export const samePerson = (a: string, b: string): boolean => surname(a) === surname(b);
const CITY_ALIASES: Record<string, string> = { doha: 'dauha', 'ad-dauha': 'dauha' };
const city = (c: string) => CITY_ALIASES[ascii(c)] ?? ascii(c);
const methodClass = (m: string) => (/^t?ko$/i.test(m) ? 'ko' : ascii(m));

/**
 * Porovná údaj z obou hledání; rozpor nebo chybějící údaj zapíše do `pozor`. Vrací hodnotu z A (nebo jedinou).
 * Doplňkový údaj (`optional`) se vrátí, jen když sedí v obou zdrojích; jinak se do grafiky nedá a ohlásí se jen rozpor.
 */
function agree<T>(label: string, a: T | null, b: T | null, same: (x: T, y: T) => boolean, show: (x: T) => string, pozor: string[], optional = false): T | null {
  if (optional) {
    if (a === null || b === null) return null;
    if (!same(a, b)) {
      pozor.push(`${label}: zdroje se liší (${show(a)} × ${show(b)}), do grafiky nejde.`);
      return null;
    }
    return a;
  }
  if (a === null && b === null) {
    pozor.push(`${label}: nenašel ho ani jeden zdroj.`);
    return null;
  }
  if (a === null || b === null) {
    pozor.push(`${label}: jen v jednom zdroji (${show((a ?? b) as T)}), druhý ho neuvádí.`);
    return (a ?? b) as T;
  }
  if (!same(a, b)) pozor.push(`${label}: zdroje se liší (${show(a)} × ${show(b)}).`);
  return a;
}

/** Odkazy z hledání: jen na povolených doménách a jen ty, které Claude opravdu viděl. */
export function checkSources(label: string, sources: readonly string[], domains: readonly string[], seen: readonly string[], pozor: string[]): string[] {
  const seenSet = new Set(seen.map(normalizeUrl));
  const good = sources.filter((u) => onDomains(u, domains) && seenSet.has(normalizeUrl(u)));
  for (const u of sources) {
    if (!onDomains(u, domains)) pozor.push(`${label}: zdroj mimo povolené weby (${u}).`);
    else if (!seenSet.has(normalizeUrl(u))) pozor.push(`${label}: odkaz ${u} nebyl ve výsledcích hledání.`);
  }
  if (!good.length) pozor.push(`${label}: údaje nemají ověřený zdroj.`);
  return good;
}

export interface SpecialFacts {
  stage: Stage;
  akce: string;
  /** Popis zápasu z popisu akce (pro Vencu: např. že jde o hlavní zápas večera). */
  popis: string;
  sport: string;
  stitek: string;
  datum: string;
  dayLabel: string;
  czech: { name: string; record: string | null };
  opponent: { name: string; record: string | null };
  /** Řádky pozvánky (místo, čas, váha) nebo dlaždice výsledku (způsob, kolo, čas). */
  rows: { label: string; value: string }[];
  /** Jméno vítěze (u výsledku); null = remíza nebo bez výsledku. */
  winner?: string | null;
  sources: string[];
}

const base = (e: SpecialEvent, stage: Stage) => ({ stage, akce: e.akce, popis: e.zadani, sport: e.sport, stitek: e.stitek, datum: e.datum, dayLabel: dayLabel(e.datum) });

/** Pozvánka z obou hledání: potvrzené údaje do grafiky, rozpory do pozor. */
export function confirmInvite(e: SpecialEvent, a: InviteReport, b: InviteReport, sources: string[]): { facts: SpecialFacts; pozor: string[] } {
  const pozor: string[] = [];
  if (!a.found || !b.found) pozor.push(`Zápas ${!a.found ? 'mezinárodní' : 'české'} zdroje nenašly.`);
  for (const r of [a, b]) if (r.note) pozor.push(`Poznámka hledání: ${r.note}`);

  const opponent = agree('Soupeř', a.opponent, b.opponent, samePerson, (x) => x, pozor) ?? e.souper;
  if (!samePerson(opponent, e.souper)) pozor.push(`Soupeř se změnil? V zadání je ${e.souper}, zdroje píšou ${opponent}.`);
  const czechRec = agree('Bilance Čecha', parseRecord(a.czechRecord), parseRecord(b.czechRecord), (x, y) => recordText(x) === recordText(y), recordText, pozor);
  const oppRec = agree('Bilance soupeře', parseRecord(a.opponentRecord), parseRecord(b.opponentRecord), (x, y) => recordText(x) === recordText(y), recordText, pozor);
  const cityName = agree('Město', a.city, b.city, (x, y) => city(x) === city(y), (x) => x, pozor);
  const arena = agree('Hala', a.arena, b.arena, (x, y) => ascii(x).includes(ascii(y)) || ascii(y).includes(ascii(x)), (x) => x, pozor, true);
  const date = agree('Datum', a.date, b.date, (x, y) => x === y, (x) => x, pozor);
  if (date && date !== e.datum) pozor.push(`Datum ve zdrojích (${date}) nesedí se zadáním (${e.datum}).`);
  // České zdroje (B) píšou čas bez pásma: je to náš čas.
  const conv = (r: InviteReport, fallbackZone: string) => (r.start ? toPrague(r.date ?? e.datum, r.start.time, r.start.zone || fallbackZone, e.pasmo) : null);
  const [sa, sb] = [conv(a, ''), conv(b, 'SEČ')];
  if (a.start && !sa) pozor.push(`Čas ze zdroje A nejde převést (${a.start.time} ${a.start.zone}).`);
  if (b.start && !sb) pozor.push(`Čas ze zdroje B nejde převést (${b.start.time} ${b.start.zone}).`);
  const start = agree('Začátek hlavní karty', sa, sb, (x, y) => x.date === y.date && x.time === y.time, (x) => `${dayLabel(x.date)} ${x.time}`, pozor);
  const weight = agree('Váhová kategorie', a.weightClass, b.weightClass, (x, y) => ascii(x).replace(/ vaha$/, '') === ascii(y).replace(/ vaha$/, ''), (x) => x, pozor, true);
  const rounds = agree('Počet kol', a.rounds, b.rounds, (x, y) => x === y, String, pozor, true);

  const rows = [
    { label: 'Akce', value: e.akce },
    ...(arena || cityName ? [{ label: 'Místo', value: [arena, cityName].filter(Boolean).join(', ') }] : []),
    ...(start ? [{ label: 'Hlavní karta', value: `${dayLabel(start.date).split(' ')[0]} ${start.time} našeho času` }] : []),
    ...(weight || rounds ? [{ label: 'Zápas', value: [weight ? `${weight.replace(/ váha$/, '')} váha` : '', rounds ? `${rounds} kol` : ''].filter(Boolean).join(' · ') }] : []),
  ];
  return {
    facts: { ...base(e, 'pozvanka'), czech: { name: e.cech, record: czechRec ? recordText(czechRec) : null }, opponent: { name: opponent, record: oppRec ? recordText(oppRec) : null }, rows, sources },
    pozor,
  };
}

/** Výsledek z obou hledání. `null`, když zápas podle některého zdroje ještě neskončil. */
export function confirmResult(e: SpecialEvent, a: ResultReport, b: ResultReport, sources: string[], invite?: Pick<SpecialFacts, 'czech' | 'opponent'>): { facts: SpecialFacts; pozor: string[] } | null {
  if (!a.finished || !b.finished) return null;
  const pozor: string[] = [];
  for (const r of [a, b]) if (r.note) pozor.push(`Poznámka hledání: ${r.note}`);
  const method = agree('Způsob ukončení', a.method, b.method, (x, y) => methodClass(x) === methodClass(y), (x) => x, pozor);
  if (method && !METHODS.includes(method)) pozor.push(`Neznámý způsob ukončení „${method}“.`);
  const noWinner = method !== null && /remiza|bez vysledku/.test(ascii(method));
  const winner = noWinner ? null : agree('Vítěz', a.winner, b.winner, samePerson, (x) => x, pozor);
  if (winner && !samePerson(winner, e.cech) && !samePerson(winner, e.souper)) pozor.push(`Vítěz ${winner} není ani ${e.cech}, ani ${e.souper}.`);
  const round = agree('Kolo', a.round, b.round, (x, y) => x === y, String, pozor);
  const time = agree('Čas', a.time, b.time, (x, y) => x.replace(/^0/, '') === y.replace(/^0/, ''), (x) => x, pozor);
  if (time && !/^\d{1,2}:\d{2}$/.test(time)) pozor.push(`Čas „${time}“ není ve tvaru m:ss.`);

  const oppName = invite?.opponent.name ?? e.souper;
  const winnerName = winner ? (samePerson(winner, e.cech) ? e.cech : samePerson(winner, oppName) || samePerson(winner, e.souper) ? oppName : winner) : null;
  const rows = [
    ...(method ? [{ label: 'Způsob', value: method }] : []),
    ...(round ? [{ label: 'Kolo', value: `${round}.` }] : []),
    ...(time ? [{ label: 'Čas', value: time }] : []),
  ];
  return {
    facts: {
      ...base(e, 'vysledek'),
      czech: { name: e.cech, record: invite?.czech.record ?? null },
      opponent: { name: oppName, record: invite?.opponent.record ?? null },
      rows, winner: winnerName, sources,
    },
    pozor,
  };
}

// ---- Dotazy ----

export const FACTS_SYSTEM =
  'Jsi pečlivý sportovní redaktor. Dohledáváš fakta k zápasu ve zdrojích, které máš povolené. '
  + 'Vycházíš jen z toho, co ve zdrojích opravdu najdeš: nic nedomýšlíš, nic nedopočítáváš a nepřevádíš časová pásma. Odpovídáš jen platným JSON.';

export function invitePrompt(e: SpecialEvent, domains: readonly string[]): string {
  return `Zjisti fakta k zápasu: ${e.zadani}.
Hledej jen na těchto webech: ${domains.join(', ')}.

Vrať jen tento JSON, bez textu okolo:
{
  "nalezeno": true,
  "souper": "jméno soupeře, jak ho uvádí zdroj (když se soupeř změnil, napiš nového)",
  "bilance_cecha": "bilance ${e.cech} před zápasem jako výhry-prohry-remízy, např. \\"10-2-0\\"",
  "bilance_soupere": "bilance soupeře před zápasem, stejný tvar",
  "mesto": "město konání česky",
  "arena": "název haly",
  "datum": "den zápasu YYYY-MM-DD",
  "hlavni_karta": {"cas": "začátek hlavní karty HH:MM (24 h), jak ho uvádí zdroj", "pasmo": "časové pásmo toho času, jak ho uvádí zdroj (ET, PT, UTC, GMT+3, SEČ, místní čas…)"},
  "vaha": "váhová kategorie zápasu, jedna z: ${WEIGHT_CLASSES.join(', ')}",
  "pocet_kol": 5,
  "zdroje": ["adresy stránek, ze kterých údaje máš"],
  "poznamka": "jednou větou, jen když se zdroje mezi sebou liší nebo je údaj nejistý; jinak prázdné. Nepopisuj postup."
}
Údaj, který ve zdrojích nenajdeš, nech null. Když zápas nenajdeš vůbec, vrať {"nalezeno": false, "poznamka": "proč"}.`;
}

export function resultPrompt(e: SpecialEvent, domains: readonly string[]): string {
  return `Zjisti výsledek zápasu: ${e.zadani}.
Hledej jen na těchto webech: ${domains.join(', ')}.

Když zápas ještě neskončil nebo jeho výsledek ve zdrojích není, vrať {"skonceno": false, "poznamka": "co víš"}.
Jinak vrať jen tento JSON, bez textu okolo:
{
  "skonceno": true,
  "vitez": "jméno vítěze (u remízy nebo zápasu bez výsledku null)",
  "zpusob": "jedna z: ${METHODS.join(', ')}",
  "kolo": 2,
  "cas": "čas v kole, kdy zápas skončil, m:ss",
  "zdroje": ["adresy stránek, ze kterých výsledek máš"],
  "poznamka": "jednou větou, jen když se zdroje mezi sebou liší nebo je údaj nejistý; jinak prázdné. Nepopisuj postup."
}`;
}

/** Jedno hledání v jedné skupině zdrojů; nečitelná odpověď dá prázdný výsledek s poznámkou. */
async function searchGroup<T extends { sources: string[]; note: string }>(
  io: ClaudeIo, label: string, domains: string[], user: string, parse: (text: string) => T, empty: T, log: (l: string) => void,
): Promise<{ report: T; seen: string[] }> {
  try {
    const a = await askWithSearch(io, { system: FACTS_SYSTEM, user, domains, maxSearches: 8, maxFetches: 6 }, (l) => log(`[${label}] ${l}`));
    try {
      return { report: parse(a.text), seen: a.seen };
    } catch {
      log(`[${label}] Začátek odpovědi: ${JSON.stringify(a.text.slice(0, 400))}`);
      return { report: { ...empty, note: `odpověď zdrojů ${label} není čitelný JSON` }, seen: a.seen };
    }
  } catch (err) {
    return { report: { ...empty, note: `hledání ve zdrojích ${label} selhalo: ${err instanceof Error ? err.message : String(err)}` }, seen: [] };
  }
}

const EMPTY_INVITE: InviteReport = { found: false, opponent: null, czechRecord: null, opponentRecord: null, city: null, arena: null, date: null, start: null, weightClass: null, rounds: null, sources: [], note: '' };
const EMPTY_RESULT: ResultReport = { finished: false, winner: null, method: null, round: null, time: null, sources: [], note: '' };

/** Pozvánka: dvě nezávislá hledání (A mezinárodní, B české) a porovnání. */
export async function findInvite(io: ClaudeIo, e: SpecialEvent, log: (l: string) => void = () => {}): Promise<{ facts: SpecialFacts; pozor: string[] }> {
  const [a, b] = await Promise.all([
    searchGroup(io, 'A', e.zdroje_a, invitePrompt(e, e.zdroje_a), parseInvite, EMPTY_INVITE, log),
    searchGroup(io, 'B', e.zdroje_b, invitePrompt(e, e.zdroje_b), parseInvite, EMPTY_INVITE, log),
  ]);
  const pozor: string[] = [];
  const sources = [...checkSources('Zdroje A', a.report.sources, e.zdroje_a, a.seen, pozor), ...checkSources('Zdroje B', b.report.sources, e.zdroje_b, b.seen, pozor)];
  const res = confirmInvite(e, a.report, b.report, sources);
  return { facts: res.facts, pozor: [...res.pozor, ...pozor] };
}

/**
 * Výsledek: dvě nezávislá hledání, ale postupně. Nejdřív mezinárodní zdroje (výsledky mají nejrychleji);
 * když výsledek ještě nemají, české se nehledají (bez obou se nic nepotvrdí, ušetří se půlka ceny).
 * Vrací čekání, když zápas podle některého zdroje ještě neskončil.
 */
export async function findResult(io: ClaudeIo, e: SpecialEvent, invite: Pick<SpecialFacts, 'czech' | 'opponent'> | undefined, log: (l: string) => void = () => {}): Promise<{ facts: SpecialFacts; pozor: string[] } | { waiting: string }> {
  const a = await searchGroup(io, 'A', e.zdroje_a, resultPrompt(e, e.zdroje_a), parseResult, EMPTY_RESULT, log);
  if (!a.report.finished) return { waiting: `mezinárodní zdroje: ${a.report.note || 'výsledek zatím nemají'}; české zdroje se zatím nehledaly` };
  const b = await searchGroup(io, 'B', e.zdroje_b, resultPrompt(e, e.zdroje_b), parseResult, EMPTY_RESULT, log);
  if (!b.report.finished) return { waiting: `mezinárodní zdroje: výsledek mají; české zdroje: ${b.report.note || 'výsledek zatím nemají'}` };
  const pozor: string[] = [];
  const sources = [...checkSources('Zdroje A', a.report.sources, e.zdroje_a, a.seen, pozor), ...checkSources('Zdroje B', b.report.sources, e.zdroje_b, b.seen, pozor)];
  const res = confirmResult(e, a.report, b.report, sources, invite)!;
  return { facts: res.facts, pozor: [...res.pozor, ...pozor] };
}

// ---- Venca ----

export interface SpecialVencaOut {
  titulek: string;
  hlaska: string;
  popisek: string;
  hashtagy: string[];
  vyraz: Expression;
  pozor: string[];
}

export function specialUserMessage(f: SpecialFacts): string {
  const data = {
    akce: f.akce,
    zapas: f.popis,
    sport: f.sport,
    den: f.dayLabel,
    cech: f.czech,
    souper: f.opponent,
    ...(f.stage === 'vysledek' ? { vitez: f.winner ?? 'bez vítěze' } : {}),
    udaje: Object.fromEntries(f.rows.map((r) => [r.label.toLowerCase(), r.value])),
    overeni: 'Všechny údaje kód ověřil ve dvou nezávislých zdrojích.',
  };
  return `FORMÁT: ${f.stage === 'pozvanka' ? 'mma_pozvanka' : 'mma_vysledek'}\nDATUM: ${f.datum}\nDATA:\n${JSON.stringify(data, null, 2)}`;
}

/** Slova, která u MMA můžou působit jako posměch knockoutu nebo zranění (bible, sekce 8). */
export const MMA_TABOO = /uspal|uspav|spink|šel spát|poslal (ho )?spát|krev|krvav|rozbil|rozmlát|zmlát|nosítk|mrtvol|otřes|ksicht|zničil ho|ponížil/i;

export function specialAllowedNumbers(f: SpecialFacts): Set<string> {
  const out = new Set<string>(['1', '2', '3', '91']);
  const add = (n: number | string) => out.add(String(Number(n)));
  const [y, m, d] = f.datum.split('-');
  for (const x of [y, m, d]) if (x) add(x);
  for (const x of [f.czech.record, f.opponent.record, ...f.rows.map((r) => r.value)]) for (const n of numbersIn(x ?? '')) add(n);
  return out;
}

export function checkSpecialVenca(raw: unknown, f: SpecialFacts, defaults: string[] = []): SpecialVencaOut {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pozor = vencaNotes(o.pozor);
  let vyraz = checkExpression(o.vyraz, pozor);
  if (f.stage === 'vysledek' && vyraz === 'vztek') {
    pozor.push('Výraz vztek se k výsledku MMA nehodí (respekt k soupeři), použito zklamání.');
    vyraz = 'zklamani';
  }
  const titulek = str(o.titulek);
  const hlaska = str(o.hlaska);
  const popisek = str(o.popisek);
  if (!titulek) pozor.push('Chybí titulek.');
  if (!hlaska) pozor.push('Chybí hláška.');
  if (!popisek) pozor.push('Chybí popisek.');
  if (titulek && words(titulek) > LIMITS.titulekWords) pozor.push(`Titulek je delší než ${LIMITS.titulekWords} slov.`);
  if (hlaska && words(hlaska) > LIMITS.hlaskaWords) pozor.push(`Hláška je delší než ${LIMITS.hlaskaWords} slov.`);
  const allowed = specialAllowedNumbers(f);
  for (const [label, text] of [['titulku', titulek], ['hlášce', hlaska], ['popisku', popisek]] as const) {
    const bad = numbersIn(text).filter((n) => !allowed.has(String(Number(n.replace(',', '.')))));
    if (bad.length) pozor.push(`Čísla v ${label} nejsou v datech: ${[...new Set(bad)].join(', ')}.`);
    const taboo = MMA_TABOO.exec(text);
    if (taboo) pozor.push(`Text v ${label} může působit jako posměch knockoutu nebo zranění („${taboo[0]}“).`);
  }
  const hashtagy = cleanHashtags(Array.isArray(o.hashtagy) && o.hashtagy.length ? o.hashtagy : defaults);
  return { titulek, hlaska, popisek, hashtagy, vyraz, pozor };
}

export function fallbackSpecialVenca(f: SpecialFacts, defaults: string[]): SpecialVencaOut {
  const vs = `${f.czech.name} – ${f.opponent.name}`;
  return {
    titulek: f.stage === 'pozvanka' ? `Dnes večer ${f.stitek}` : `${f.stitek}: výsledek`,
    hlaska: 'Dneska bez komentáře, Venca si dal volno. Údaje ale sedí.',
    popisek: f.stage === 'pozvanka' ? `${vs}: budete se dívat?` : `${vs}: jak jste to viděli?`,
    hashtagy: cleanHashtags(defaults),
    vyraz: f.stage === 'pozvanka' ? 'nervozita' : 'klid',
    pozor: ['Texty jsou bez AI (zkouška bez klíče ANTHROPIC_API_KEY).'],
  };
}

export function specialDisclaimer(sources: readonly string[]): string {
  const labels = [...new Set(sources.map(sourceLabel))];
  return labels.length >= 2 ? `Fiktivní AI postava. Údaje ověřené ve dvou zdrojích: ${labels.join(', ')}.` : 'Fiktivní AI postava.';
}

export function specialCaption(v: Pick<SpecialVencaOut, 'popisek' | 'hashtagy'>, sources: readonly string[]): string {
  return [v.popisek, v.hashtagy.join(' '), specialDisclaimer(sources)].filter(Boolean).join('\n\n');
}
