// Přehledy, ke kterým nejsou volná strukturovaná data: hokejoví legionáři, Češi ve fotbale v cizině a tenis.
// Popis přehledu je v data/prehledy/<id>.json. Výkony dohledá Claude API dvakrát nezávisle: jednou jen
// v mezinárodních (oficiálních) zdrojích (A), jednou jen v českých (B). Kód obě verze porovná zápas po zápase;
// do grafiky jde jen výkon, který v obou sedí (stejný hráč, den, soupeř, skóre, góly a asistence nebo výsledek).
// Rozpory jdou do „pozor“, výkony jen z jednoho zdroje se do grafiky nedají.

import { askWithSearch, normalizeUrl, onDomains, type ClaudeIo } from './claude.ts';
import { numbersIn, plural } from './facts.ts';
import { shortDate } from './kotel.ts';
import { ascii } from './nhl.ts';
import { sourceLabel } from './scorers.ts';
import { checkExpression, cleanHashtags, LIMITS, parseJsonLoose, sponsorNotes, str, vencaNotes, words, type Expression } from './venca.ts';

export type DigestSport = 'hokej' | 'fotbal' | 'tenis';

/** Popis přehledu v data/prehledy/<id>.json. */
export interface DigestConfig {
  /** Přípona id konceptu: 2026-11-23-legionari. */
  id: string;
  nazev: string;
  sport: DigestSport;
  /** Kolik dní zpátky přehled pokrývá (7 = celý minulý týden, 1 = včerejšek). */
  obdobi_dni: number;
  /** Co přesně hledat (soutěže, hráči). */
  zadani: string;
  /** Soutěže, které do přehledu nikdy nepatří (např. KHL): porovnává se s názvem soutěže bez diakritiky. */
  vyloucit: string[];
  /** Hráči, které hledat přednostně (nepovinné). */
  hraci?: string[];
  zdroje_a: string[];
  zdroje_b: string[];
  hashtagy: string[];
  /** Nejvýš hledání a stažených stránek na jednu skupinu zdrojů (výchozí 10 a 8; víc = dražší běh). */
  hledani?: number;
  stranky?: number;
  /** Období, kdy přehled běží (YYYY-MM-DD, nepovinné): mimo něj úloha nic nehledá. */
  od?: string;
  do?: string;
}

export const isActive = (cfg: Pick<DigestConfig, 'od' | 'do'>, today: string): boolean => (!cfg.od || today >= cfg.od) && (!cfg.do || today <= cfg.do);

export const DIGEST_EMOJI: Record<DigestSport, string> = { hokej: '🏒', fotbal: '⚽', tenis: '🎾' };

/** Jeden výkon v jednom zápase. Skóre je z pohledu Čecha (jeho tým nebo on první). */
export interface Performance {
  player: string;
  team: string;
  competition: string;
  /** Kolo turnaje (tenis), jinak prázdné. */
  stage: string;
  date: string;
  opponent: string;
  score: string;
  won: boolean | null;
  goals: number | null;
  assists: number | null;
  /** Brankář odchytal celý zápas a jeho tým nedostal gól (čisté konto, „nula“); u ostatních null. */
  cleanSheet: boolean | null;
}

export interface DigestReport {
  items: Performance[];
  sources: string[];
  note: string;
}

// ---- Období ----

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Období přehledu: od (včetně) do (včetně), končí včerejškem. */
export function period(cfg: Pick<DigestConfig, 'obdobi_dni'>, today: string): { from: string; to: string } {
  return { from: addDays(today, -cfg.obdobi_dni), to: addDays(today, -1) };
}

/** „16.–22. 11.“, „30. 11.–6. 12.“ nebo jeden den „22. 11.“. */
export function periodLabel(p: { from: string; to: string }): string {
  if (p.from === p.to) return shortDate(p.from);
  const [, m1, d1] = p.from.split('-').map(Number);
  const [, m2] = p.to.split('-').map(Number);
  return m1 === m2 ? `${d1}.–${shortDate(p.to)}` : `${shortDate(p.from)}–${shortDate(p.to)}`;
}

// ---- Zadání a čtení odpovědi ----

export const DIGEST_SYSTEM =
  'Jsi pečlivý sportovní redaktor. Dohledáváš výsledky českých sportovců ve zdrojích, které máš povolené. '
  + 'Vycházíš jen z toho, co ve zdrojích opravdu najdeš: nic nedomýšlíš, nic nedopočítáváš a nic nedoplňuješ z paměti. Odpovídáš jen platným JSON.';

/** Tvar jednoho výkonu v odpovědi (JSON). */
function itemShape(sport: DigestSport): string {
  return sport === 'tenis'
    ? '{"hrac": "jméno Čecha/Češky", "turnaj": "název turnaje", "kolo": "kolo turnaje, např. 2. kolo, čtvrtfinále", "datum": "YYYY-MM-DD (den zápasu podle místa konání)", "souper": "jméno soupeře", "skore": "skóre po setech z pohledu Čecha, např. 6:4 3:6 7:6", "vyhra": true}'
    : '{"hrac": "jméno Čecha", "tym": "jeho tým", "soutez": "liga nebo pohár", "datum": "YYYY-MM-DD (den zápasu podle místa konání)", "souper": "soupeř", "skore": "konečné skóre z pohledu Čechova týmu, např. 4:2", "vyhra": true, "goly": 1, "asistence": 0, "nula": false}';
}

const answerShape = (sport: DigestSport) => `Vrať jen tento JSON, bez textu okolo:
{"vykony": [${itemShape(sport)}], "zdroje": ["adresy stránek, ze kterých údaje máš"], "poznamka": "jednou větou, jen když je něco nejisté; jinak prázdné"}${sport === 'tenis' ? '' : `
"nula" je true jen u brankáře, který odchytal celý zápas a jeho tým nedostal gól; u všech ostatních false.`}
Když nic nenajdeš, vrať {"vykony": [], "zdroje": [], "poznamka": "proč"}.`;

/** Zadání prvního hledání (české zdroje): najít výkony v období, se seznamem hráčů po hráčích. */
export function digestPrompt(cfg: DigestConfig, p: { from: string; to: string }, domains: readonly string[]): string {
  const tennis = cfg.sport === 'tenis';
  const what = tennis
    ? 'všechny zápasy českých tenistů a tenistek ve dvouhře (hlavní soutěž turnajů ATP a WTA včetně grandslamů)'
    : `zápasy, ve kterých český ${cfg.sport === 'hokej' ? 'hokejista' : 'fotbalista'} dal gól nebo měl asistenci, a zápasy, ve kterých český brankář odchytal celý zápas a jeho tým nedostal gól (čisté konto)`;
  // Hledání „všichni Češi za týden“ je moc široké a skončí na limitu; po hráčích to jde (jedno hledání na hráče).
  const players = cfg.hraci?.length
    ? `\nPostupuj po hráčích z tohoto seznamu, na každého stačí jedno hledání (jméno a klub; hráče ze stejného klubu hledej spolu): ${cfg.hraci.join('; ')}. Další Čechy přidej, jen když na ně při hledání narazíš.`
    : '';
  return `${cfg.zadani}${players}

Najdi ${what} od ${p.from} do ${p.to} (včetně).
Hledej jen na těchto webech: ${domains.join(', ')}.
${cfg.vyloucit.length ? `Nikdy nezahrnuj: ${cfg.vyloucit.join(', ')}.\n` : ''}
Každý zápas uveď zvlášť. Čísla opisuj přesně ze zdroje; zápas, u kterého si nejsi jistý, vynech a napiš ho do "poznamka".

${answerShape(cfg.sport)}`;
}

/**
 * Zadání druhého hledání (mezinárodní zdroje): jen KTERÉ zápasy ověřit (hráč, tým, soutěž, den, soupeř),
 * bez čísel. Skóre, výsledek, góly a asistence musí druhé hledání najít ve svých zdrojích samo; kód je pak
 * porovná s prvním. Ověřit pár známých zápasů stojí zlomek hledání naslepo.
 */
export function verifyPrompt(cfg: DigestConfig, p: { from: string; to: string }, domains: readonly string[], candidates: readonly Performance[]): string {
  const tennis = cfg.sport === 'tenis';
  const list = candidates
    .map((c) => (tennis
      ? `- ${c.player}: ${[c.competition, c.stage].filter(Boolean).join(', ') || 'turnaj ?'}, ${c.date}, soupeř ${c.opponent || '?'}`
      : `- ${c.player} (${[c.team || 'klub ?', c.cleanSheet ? 'brankář' : ''].filter(Boolean).join(', ')}): ${c.competition || 'soutěž ?'}, ${c.date}, soupeř ${c.opponent || '?'}`))
    .join('\n');
  const numbers = tennis
    ? 'skóre po setech a kdo vyhrál'
    : 'konečné skóre, výsledek a kolik gólů a asistencí v něm hráč měl (u brankáře také, jestli odchytal celý zápas bez obdrženého gólu)';
  return `Ověř tyto zápasy (období ${p.from} až ${p.to}):
${list}

Hledej jen na těchto webech: ${domains.join(', ')}.
U každého zápasu, který ve zdroji najdeš, opiš ze zdroje ${numbers}. Datum piš podle místa konání.
Jméno hráče a soupeře piš přesně tak, jak jsou v seznamu výše, i když je zdroj píše jinak (např. „Kolín nad Rýnem“ místo „Köln“).
Nic nedopočítávej a nedoplňuj z paměti. Zápas, který ve zdrojích nenajdeš, vynech. Jiné zápasy nepřidávej.

${answerShape(cfg.sport)}`;
}

/** Výkon stojí za řádek: tenisový zápas vždy, jinak gól, asistence nebo čisté konto brankáře. */
export const notable = (sport: DigestSport, p: Performance): boolean =>
  sport === 'tenis' || (p.goals ?? 0) > 0 || (p.assists ?? 0) > 0 || p.cleanSheet === true;

/** Kolik gólů dostal Čechův tým podle skóre „vlastní:soupeř“ (první dvojice čísel), nebo null. */
export function conceded(score: string): number | null {
  const m = /(\d+)\s*[:–-]\s*(\d+)/.exec(score);
  return m ? Number(m[2]) : null;
}

/** Výkony, které do přehledu vůbec můžou: bez vyloučených soutěží (KHL) a v období (±1 den kvůli pásmům). */
export function usableItems(cfg: Pick<DigestConfig, 'vyloucit'>, items: readonly Performance[], p: { from: string; to: string }): Performance[] {
  const banned = (x: Performance) => cfg.vyloucit.some((v) => ascii(`${x.competition} ${x.team}`).includes(ascii(v)));
  const inPeriod = (x: Performance) => x.date >= addDays(p.from, -1) && x.date <= addDays(p.to, 1);
  return items.filter((x) => !banned(x) && inPeriod(x));
}

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const int = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

export function parseDigest(text: string): DigestReport {
  const o = parseJsonLoose(text) as Record<string, unknown>;
  const items = (Array.isArray(o.vykony) ? o.vykony : []).map((x): Performance => {
    const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    return {
      player: s(r.hrac),
      team: s(r.tym),
      competition: s(r.soutez ?? r.turnaj),
      stage: s(r.kolo),
      date: s(r.datum),
      opponent: s(r.souper),
      score: s(r.skore),
      won: typeof r.vyhra === 'boolean' ? r.vyhra : null,
      goals: int(r.goly),
      assists: int(r.asistence),
      cleanSheet: typeof r.nula === 'boolean' ? r.nula : null,
    };
  }).filter((p) => p.player && /^\d{4}-\d{2}-\d{2}$/.test(p.date));
  const sources = (Array.isArray(o.zdroje) ? o.zdroje : []).filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u.trim())).map((u) => u.trim());
  return { items, sources, note: s(o.poznamka) };
}

// ---- Porovnání dvou zdrojů ----

const surname = (name: string) => ascii(name).replace(/[^a-z\s-]/g, '').split(/\s+/).filter(Boolean).pop() ?? '';
const samePerson = (a: string, b: string) => surname(a) !== '' && surname(a) === surname(b);
const dayGap = (a: string, b: string) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;
/** Skóre jako čísla bez přípon a tiebreaků: „7:6(5) 6:4“ → „7:6 6:4“, „3:2 pp“ → „3:2“. */
export const scoreKey = (score: string): string => (score.replace(/\(\d+\)/g, '').match(/\d+\s*[:–-]\s*\d+/g) ?? []).map((x) => x.replace(/\s*[–-]\s*|\s*:\s*/, ':')).join(' ');
const sameOpponent = (a: string, b: string) => {
  const x = ascii(a), y = ascii(b);
  return x === y || (x.length >= 4 && y.includes(x)) || (y.length >= 4 && x.includes(y)) || surname(a) === surname(b);
};

/** Výkon z A k výkonu z B: stejný hráč, den ±1 (časová pásma), stejný soupeř. */
const matchKey = (a: Performance, b: Performance) => samePerson(a.player, b.player) && dayGap(a.date, b.date) <= 1 && sameOpponent(a.opponent, b.opponent);

export interface ConfirmedDigest {
  items: Performance[];
  pozor: string[];
  /** Kolik výkonů bylo jen v jednom zdroji (do grafiky nejdou). */
  single: number;
}

const perfLabel = (p: Performance) => `${p.player} (${p.date}, ${p.opponent} ${p.score})`;

/**
 * Porovná výkony z obou hledání. Do výsledku jde jen výkon, který je v obou a sedí skóre, výsledek, góly
 * a asistence; rozpor jde do `pozor`. Vyloučené soutěže (KHL) se zahodí vždy.
 */
export function confirmDigest(cfg: Pick<DigestConfig, 'vyloucit' | 'sport'>, a: DigestReport, b: DigestReport, p: { from: string; to: string }): ConfirmedDigest {
  const pozor: string[] = [];
  // B (české zdroje) dodává kandidáty: zápas bez gólu, asistence i nuly do přehledu nepatří.
  const [la, lb] = [usableItems(cfg, a.items, p), usableItems(cfg, b.items, p).filter((x) => notable(cfg.sport, x))];
  const used = new Set<Performance>();
  const items: Performance[] = [];
  let single = 0;
  for (const x of la) {
    const y = lb.find((z) => !used.has(z) && matchKey(x, z));
    if (!y) {
      single++;
      continue;
    }
    used.add(y);
    const diffs: string[] = [];
    if (scoreKey(x.score) !== scoreKey(y.score)) diffs.push(`skóre ${x.score} × ${y.score}`);
    if (x.won !== null && y.won !== null && x.won !== y.won) diffs.push('výsledek');
    if (cfg.sport !== 'tenis') {
      if ((x.goals ?? 0) !== (y.goals ?? 0)) diffs.push(`góly ${x.goals ?? 0} × ${y.goals ?? 0}`);
      if ((x.assists ?? 0) !== (y.assists ?? 0)) diffs.push(`asistence ${x.assists ?? 0} × ${y.assists ?? 0}`);
      if ((x.cleanSheet ?? false) !== (y.cleanSheet ?? false)) diffs.push('čisté konto');
    }
    if (diffs.length) {
      pozor.push(`${perfLabel(x)}: zdroje se liší (${diffs.join(', ')}), do grafiky nejde.`);
      continue;
    }
    if (x.cleanSheet && conceded(x.score) !== 0) {
      pozor.push(`${perfLabel(x)}: čisté konto nesedí se skóre, do grafiky nejde.`);
      continue;
    }
    items.push({ ...x, won: x.won ?? y.won, team: x.team || y.team, stage: x.stage || y.stage });
  }
  single += lb.filter((z) => !used.has(z)).length;
  if (single) pozor.push(`${single} ${plural(single, 'výkon byl', 'výkony byly', 'výkonů bylo')} jen v jednom zdroji, do grafiky ${single === 1 ? 'nejde' : 'nejdou'}.`);
  for (const r of [a, b]) if (r.note) pozor.push(`Poznámka hledání: ${r.note}`);
  return { items: items.sort((x, y) => x.date.localeCompare(y.date)), pozor, single };
}

/** Odkazy z hledání: jen z povolených webů a jen ty, které Claude opravdu viděl. */
export function goodSources(label: string, sources: readonly string[], domains: readonly string[], seen: readonly string[], pozor: string[]): string[] {
  const seenSet = new Set(seen.map(normalizeUrl));
  const good: string[] = [];
  for (const u of sources) {
    if (!onDomains(u, domains)) pozor.push(`${label}: zdroj mimo povolené weby (${u}).`);
    else if (!seenSet.has(normalizeUrl(u))) pozor.push(`${label}: odkaz ${u} nebyl ve výsledcích hledání.`);
    else good.push(u);
  }
  return good;
}

// ---- Fakta do grafiky ----

/** Řádek grafiky: hráč, kde hraje, co se stalo (z dat) a hlavní číslo. */
export interface DigestRow {
  player: string;
  where: string;
  detail: string;
  value: string;
  /** Pro řazení (body, výhry). */
  weight: number;
}

export interface DigestFacts {
  id: string;
  nazev: string;
  sport: DigestSport;
  period: { from: string; to: string };
  periodLabel: string;
  rows: DigestRow[];
  items: Performance[];
  sources: string[];
  /** Hráč, kterého Venca vyzdvihne (vybírá z řádků). */
  hero?: string;
}

/** Hokej a fotbal: za hráče součet gólů a asistencí za období; tenis: každý zápas zvlášť. */
export function digestRows(sport: DigestSport, items: readonly Performance[]): DigestRow[] {
  if (sport === 'tenis') {
    return items.map((p) => ({
      player: p.player,
      where: [p.competition, p.stage].filter(Boolean).join(', '),
      detail: `${p.won === null ? '' : p.won ? 'výhra · ' : 'prohra · '}${p.opponent}`,
      value: p.score,
      weight: (p.won ? 2 : 1),
    })).sort((a, b) => b.weight - a.weight);
  }
  const by = new Map<string, Performance[]>();
  for (const p of items) {
    const k = surname(p.player) + '|' + ascii(p.team);
    by.set(k, [...(by.get(k) ?? []), p]);
  }
  return [...by.values()].map((list) => {
    const goals = list.reduce((n, p) => n + (p.goals ?? 0), 0);
    const assists = list.reduce((n, p) => n + (p.assists ?? 0), 0);
    const clean = list.filter((p) => p.cleanSheet === true).length;
    const first = list[0]!;
    const nula = clean === 0 ? '' : clean === 1 ? 'nula' : `${clean}× nula`;
    return {
      player: first.player,
      where: [first.team, first.competition].filter(Boolean).join(', '),
      detail: list.map((p) => `${p.opponent} ${p.score}`).join(' · '),
      // Brankář s čistým kontem: „nula“; když by měl i bod, obojí.
      value: goals + assists === 0 && nula ? nula : nula ? `${goals}+${assists} · ${nula}` : `${goals}+${assists}`,
      weight: goals * 3 + assists * 2 + clean * 3,
    };
  }).sort((a, b) => b.weight - a.weight || a.player.localeCompare(b.player, 'cs'));
}

// ---- Hledání ----

const EMPTY: DigestReport = { items: [], sources: [], note: '' };

interface GroupResult {
  report: DigestReport;
  seen: string[];
  /** Hledání vůbec neproběhlo (chyba API, třeba došlý kredit): to není „nic se nenašlo“. */
  error?: string;
}

async function searchGroup(io: ClaudeIo, label: string, user: string, domains: string[], limits: { searches: number; fetches: number }, log: (l: string) => void): Promise<GroupResult> {
  try {
    // Menší stránky: zpravodajské články se vejdou, dlouhé online přenosy se zkrátí (jinak by hledání bylo drahé).
    const a = await askWithSearch(io, { system: DIGEST_SYSTEM, user, domains, maxSearches: limits.searches, maxFetches: limits.fetches, maxPageTokens: 12000 }, (l) => log(`[${label}] ${l}`));
    try {
      return { report: parseDigest(a.text), seen: a.seen };
    } catch {
      log(`[${label}] Začátek odpovědi: ${JSON.stringify(a.text.slice(0, 400))}`);
      return { report: { ...EMPTY, note: `odpověď zdrojů ${label} není čitelný JSON` }, seen: a.seen };
    }
  } catch (err) {
    const error = `hledání ve zdrojích ${label} selhalo: ${err instanceof Error ? err.message : String(err)}`;
    return { report: { ...EMPTY, note: error }, seen: [], error };
  }
}

/**
 * Celý přehled: dvě hledání ve dvou skupinách zdrojů, porovnání a řádky do grafiky. `errors` nese hledání,
 * která selhala (bez obou hledání se nic potvrdit nedá, úloha to má hlásit jako chybu).
 *
 * Postup kvůli ceně a úspěšnosti: české zdroje (B) najdou výkony (po hráčích ze seznamu). Mezinárodní (A)
 * dostanou jen to, které zápasy ověřit (hráč, tým, soutěž, den, soupeř), čísla (skóre, výsledek, góly,
 * asistence) musí najít samy a kód je porovná. Když B nic nenajde (nebo selže), A se nespouští.
 */
export async function findDigest(io: ClaudeIo, cfg: DigestConfig, today: string, log: (l: string) => void = () => {}): Promise<{ facts: DigestFacts; pozor: string[]; errors: string[] }> {
  const p = period(cfg, today);
  const limits = { searches: cfg.hledani ?? 10, fetches: cfg.stranky ?? 8 };
  const b = await searchGroup(io, 'B', digestPrompt(cfg, p, cfg.zdroje_b), cfg.zdroje_b, limits, log);
  const candidates = b.error ? [] : usableItems(cfg, b.report.items, p).filter((x) => notable(cfg.sport, x));
  let a: GroupResult = { report: { ...EMPTY }, seen: [] };
  if (!candidates.length) {
    log('[A] České zdroje nic nenašly, mezinárodní hledání vynechávám (bez dvou zdrojů se nic nepotvrdí).');
  } else {
    // Ověření známých zápasů: na každý stačí pár hledání a stránek.
    const n = candidates.length;
    const verify = { searches: Math.min(limits.searches, 2 * n + 2), fetches: Math.min(limits.fetches, 2 * n + 2) };
    a = await searchGroup(io, 'A', verifyPrompt(cfg, p, cfg.zdroje_a, candidates), cfg.zdroje_a, verify, log);
  }
  const pozor: string[] = [];
  const sources = [...goodSources('Zdroje A', a.report.sources, cfg.zdroje_a, a.seen, pozor), ...goodSources('Zdroje B', b.report.sources, cfg.zdroje_b, b.seen, pozor)];
  const c = confirmDigest(cfg, a.report, b.report, p);
  const errors = [a.error, b.error].filter((x): x is string => Boolean(x));
  return { facts: digestFacts(cfg, p, c.items, sources), pozor: [...c.pozor, ...pozor], errors };
}

export function digestFacts(cfg: DigestConfig, p: { from: string; to: string }, items: Performance[], sources: string[]): DigestFacts {
  return { id: cfg.id, nazev: cfg.nazev, sport: cfg.sport, period: p, periodLabel: periodLabel(p), rows: digestRows(cfg.sport, items), items, sources };
}

// ---- Venca ----

export interface DigestVencaOut {
  hrdina: string | null;
  titulek: string;
  hlaska: string;
  popisek: string;
  hashtagy: string[];
  vyraz: Expression;
  pozor: string[];
}

export function digestUserMessage(f: DigestFacts): string {
  const data = {
    prehled: f.nazev,
    obdobi: f.periodLabel,
    vykony: f.items.map((p) => ({
      hrac: p.player,
      ...(p.team ? { tym: p.team } : {}),
      soutez: p.competition,
      ...(p.stage ? { kolo: p.stage } : {}),
      den: shortDate(p.date),
      souper: p.opponent,
      skore: p.score,
      vysledek: p.won === null ? 'neuvedeno' : p.won ? 'výhra' : 'prohra',
      ...(f.sport !== 'tenis' ? { goly: p.goals ?? 0, asistence: p.assists ?? 0 } : {}),
      ...(p.cleanSheet ? { ciste_konto: true } : {}),
    })),
    hraci_v_grafice: f.rows.map((r) => ({ hrac: r.player, kde: r.where, hodnota: r.value })),
  };
  return `FORMÁT: ${f.id}\nDATUM: ${f.period.to}\nDATA:\n${JSON.stringify(data, null, 2)}`;
}

export function digestAllowedNumbers(f: DigestFacts): Set<string> {
  const out = new Set<string>(['1', '2', '3', '91']);
  const add = (n: number | string) => out.add(String(Number(n)));
  for (const d of [f.period.from, f.period.to]) for (const x of d.split('-')) add(x);
  add(f.items.length);
  add(f.rows.length);
  for (const p of f.items) {
    for (const x of [...numbersIn(p.score), ...p.date.split('-'), p.goals ?? 0, p.assists ?? 0]) add(x);
    for (const x of numbersIn(`${p.competition} ${p.stage}`)) add(x);
  }
  for (const r of f.rows) for (const x of numbersIn(r.value)) add(x);
  return out;
}

export function checkDigestVenca(raw: unknown, f: DigestFacts, defaults: string[]): DigestVencaOut {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pozor = vencaNotes(o.pozor);
  let hrdina: string | null = str(o.hrdina) || null;
  if (hrdina && !f.rows.some((r) => samePerson(r.player, hrdina!))) {
    pozor.push(`Hrdina „${hrdina}“ v datech není, vybral ho kód.`);
    hrdina = null;
  }
  hrdina = hrdina ? f.rows.find((r) => samePerson(r.player, hrdina!))!.player : f.rows[0]?.player ?? null;
  const vyraz = checkExpression(o.vyraz, pozor);
  const titulek = str(o.titulek);
  const hlaska = str(o.hlaska);
  const popisek = str(o.popisek);
  if (!titulek) pozor.push('Chybí titulek.');
  if (!hlaska) pozor.push('Chybí hláška.');
  if (!popisek) pozor.push('Chybí popisek.');
  if (titulek && words(titulek) > LIMITS.titulekWords) pozor.push(`Titulek je delší než ${LIMITS.titulekWords} slov.`);
  if (hlaska && words(hlaska) > LIMITS.hlaskaWords) pozor.push(`Hláška je delší než ${LIMITS.hlaskaWords} slov.`);
  const allowed = digestAllowedNumbers(f);
  for (const [label, text] of [['titulku', titulek], ['hlášce', hlaska], ['popisku', popisek]] as const) {
    const bad = numbersIn(text).filter((n) => !allowed.has(String(Number(n.replace(',', '.')))));
    if (bad.length) pozor.push(`Čísla v ${label} nejsou v datech: ${[...new Set(bad)].join(', ')}.`);
  }
  pozor.push(...sponsorNotes({ titulku: titulek, hlášce: hlaska, popisku: popisek }));
  if (/\bkhl\b/i.test(`${titulek} ${hlaska} ${popisek}`)) pozor.push('Text zmiňuje KHL (do přehledů nepatří).');
  const hashtagy = cleanHashtags(Array.isArray(o.hashtagy) && o.hashtagy.length ? o.hashtagy : defaults);
  return { hrdina, titulek, hlaska, popisek, hashtagy, vyraz, pozor };
}

export function fallbackDigestVenca(f: DigestFacts, defaults: string[]): DigestVencaOut {
  return {
    hrdina: f.rows[0]?.player ?? null,
    titulek: `${f.nazev} ${f.periodLabel}`,
    hlaska: 'Dneska bez komentáře, Venca si dal volno. Čísla ale sedí.',
    popisek: `${f.nazev}: přehled ${f.periodLabel}. Kdo vás potěšil nejvíc?`,
    hashtagy: cleanHashtags(defaults),
    vyraz: 'klid',
    pozor: ['Texty jsou bez AI (zkouška bez klíče ANTHROPIC_API_KEY).'],
  };
}

export function digestDisclaimer(sources: readonly string[]): string {
  const labels = [...new Set(sources.map(sourceLabel))];
  return labels.length >= 2 ? `Fiktivní AI postava. Výsledky ověřené ve dvou zdrojích: ${labels.join(', ')}.` : 'Fiktivní AI postava.';
}

/** Popisek: Venca, hráči, kteří se nevešli do grafiky (hrdina + `maxRows` dalších), hashtagy a označení postavy. */
export function digestCaption(v: Pick<DigestVencaOut, 'popisek' | 'hashtagy'>, f: DigestFacts, maxRows: number): string {
  const hero = f.rows.find((r) => r.player === f.hero) ?? f.rows[0];
  const hidden = f.rows.filter((r) => r !== hero).slice(maxRows);
  const extra = hidden.length ? `Další: ${hidden.map((r) => `${r.player} ${r.value}`).join(', ')}.` : '';
  return [v.popisek, extra, v.hashtagy.join(' '), digestDisclaimer(f.sources)].filter(Boolean).join('\n\n');
}
