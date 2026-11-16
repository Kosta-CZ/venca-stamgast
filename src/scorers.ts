// Střelci Kotle. TheSportsDB střelce zdarma nedává, dohledá je Claude API s vyhledáváním jen v českých
// zdrojích (ČTK, hokej.cz, ČT sport). Výjimka z pravidla 1, se kterou majitel souhlasil: jména střelců
// dodává AI ze zpráv, kód je ale vždy porovná se skóre z TheSportsDB a každý rozpor jde do „pozor“.
// Odkazy na zdroje jdou do zprávy ke schválení; odkaz, který Claude ve vyhledávání neviděl, se nepočítá.

import { askWithSearch, normalizeUrl, onDomains, type ClaudeIo } from './claude.ts';
import { checkScorers, expectedScorerGoals, played, scoreText, type Ending, type KotelGame, type KotelScorer, type TeamNamer } from './kotel.ts';
import { ascii } from './nhl.ts';
import { parseJsonLoose } from './venca.ts';

export const SCORER_DOMAINS = ['ceskenoviny.cz', 'hokej.cz', 'sport.ceskatelevize.cz'];

/** Zdroj střelců pro zprávu ke schválení: adresa a zápasy, ke kterým patří. */
export interface Source {
  url: string;
  games: string[];
}

export interface ReportGame {
  home: string;
  away: string;
  /** Skóre podle zdroje, jak ho Claude opsal („3:2 pp“). */
  score: string;
  homeScorers: KotelScorer[];
  awayScorers: KotelScorer[];
  shootoutWinner: string | null;
  sources: string[];
  note: string;
}

const SOURCE_NAMES: [string, string][] = [
  ['ceskenoviny.cz', 'ČTK'], ['ceskatelevize.cz', 'ČT sport'], ['isport.blesk.cz', 'iSport'], ['idnes.cz', 'iDNES'],
  ['irozhlas.cz', 'iROZHLAS'], ['aktualne.cz', 'Aktuálně'], ['denik.cz', 'Deník'], ['sport.cz', 'Sport.cz'],
  ['ufc.com', 'UFC'], ['espn.com', 'ESPN'], ['cbssports.com', 'CBS Sports'], ['mmafighting.com', 'MMA Fighting'],
  ['mmajunkie.usatoday.com', 'MMA Junkie'], ['sherdog.com', 'Sherdog'], ['tapology.com', 'Tapology'],
];

/** Krátký název zdroje do popisku: ceskenoviny.cz je ČTK, sport.ceskatelevize.cz je ČT sport. */
export function sourceLabel(url: string): string {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
  return SOURCE_NAMES.find(([d]) => host === d || host.endsWith(`.${d}`))?.[1] ?? host;
}

const gameName = (g: Pick<KotelGame, 'home' | 'away'>) => `${g.home} – ${g.away}`;

/** Zadání pro Claude: kolo, dny, zápasy s výsledkem (bez skóre, to musí přinést zdroj) a tvar odpovědi. */
export function scorersPrompt(round: number, dayLabel: string, season: string, games: readonly KotelGame[]): { system: string; user: string } {
  const list = games.filter(played).map((g) => `- ${gameName(g)}`).join('\n');
  const year = season.replace('-', '/').replace(/\/20(\d\d)$/, '/$1');
  return {
    system:
      'Jsi pečlivý sportovní redaktor. Dohledáváš střelce zápasů české hokejové extraligy v českých zpravodajských zdrojích. '
      + 'Vycházíš jen z toho, co ve zdrojích opravdu najdeš: nic nedomýšlíš a nic nedopočítáváš. Odpovídáš jen platným JSON.',
    user: `Dohledej střelce zápasů ${round}. kola hokejové extraligy, sezóna ${year} (dny kola: ${dayLabel}).

Hledej jen na ceskenoviny.cz (zpravodajství ČTK), hokej.cz a sport.ceskatelevize.cz. Nejrychlejší bývá souhrn kola od ČTK nebo zápisy zápasů s řádkem „Branky:“.

Zápasy kola (domácí – hosté; v odpovědi piš názvy týmů přesně takhle):
${list}

Pro každý zápas uveď:
- "skore": konečné skóre podle zdroje, např. "4:1", "3:2 pp" (po prodloužení), "2:1 sn" (po samostatných nájezdech),
- "strelci_domaci" a "strelci_hoste": hráči, kteří dali gól, s počtem gólů. Jméno piš jako ČTK v řádku „Branky“: příjmení, iniciála křestního jména jen tam, kde ji zdroj uvádí (např. "L. Hudáček"). Gól z rozhodujících nájezdů do střelců nepatří.
- "rozhodujici_najezd": u zápasu rozhodnutého nájezdy hráč, který proměnil rozhodující nájezd, jinak null,
- "zdroje": adresy článků, ze kterých jsi střelce vzal (jen stránky, které jsi opravdu našel nebo otevřel),
- "poznamka": prázdná, nebo krátce, když je střelec nebo počet gólů nejistý (zdroje se liší, údaj chybí). Překlepy ve zdroji, které na střelce nemají vliv, nepiš.

Když zápas ve zdrojích nenajdeš, nech seznamy střelců prázdné a do "poznamka" napiš proč. Nehádej.

Odpověz jen tímto JSON, bez textu okolo (příklad je smyšlený):
{"kolo": ${round}, "zapasy": [{"domaci": "Tým A", "hoste": "Tým B", "skore": "2:1 sn", "strelci_domaci": [{"jmeno": "Novák", "goly": 1}], "strelci_hoste": [{"jmeno": "J. Dvořák", "goly": 1}], "rozhodujici_najezd": "Svoboda", "zdroje": ["https://www.ceskenoviny.cz/zpravy/..."], "poznamka": ""}]}`,
  };
}

function scorerList(v: unknown): KotelScorer[] {
  const out = new Map<string, number>();
  for (const s of Array.isArray(v) ? v : []) {
    const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const name = (typeof o.jmeno === 'string' ? o.jmeno : typeof o.name === 'string' ? o.name : '').trim().replace(/\s+/g, ' ');
    if (!name) continue;
    const n = Number(o.goly ?? o.goals);
    const goals = Number.isInteger(n) && n > 0 ? n : 1;
    out.set(name, (out.get(name) ?? 0) + goals);
  }
  return [...out].map(([name, goals]) => ({ name, goals }));
}

/** Odpověď Claude → zápasy se střelci. Nečitelná odpověď vyhodí chybu. */
export function parseScorerReport(text: string): ReportGame[] {
  const raw = parseJsonLoose(text) as { zapasy?: unknown };
  if (!Array.isArray(raw.zapasy)) throw new Error('V odpovědi chybí seznam zápasů.');
  return raw.zapasy.map((z) => {
    const o = (z && typeof z === 'object' ? z : {}) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    return {
      home: s(o.domaci),
      away: s(o.hoste),
      score: s(o.skore),
      homeScorers: scorerList(o.strelci_domaci),
      awayScorers: scorerList(o.strelci_hoste),
      shootoutWinner: s(o.rozhodujici_najezd) || null,
      sources: (Array.isArray(o.zdroje) ? o.zdroje : []).filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u.trim())).map((u) => u.trim()),
      note: s(o.poznamka),
    };
  });
}

/** Skóre ze zdroje: „3:2 pp“ → góly a konec zápasu; nečitelné = null. */
export function parseScore(text: string): { home: number; away: number; ending: Ending } | null {
  const m = /(\d+)\s*[:–-]\s*(\d+)\s*(.*)$/.exec(text.trim());
  if (!m) return null;
  const rest = ascii(m[3] ?? '');
  const ending: Ending = /\bsn\b|najezd|naj\.|\bso\b/.test(rest) ? 'so' : /\bpp\b|prodl|\bot\b/.test(rest) ? 'ot' : 'reg';
  return { home: Number(m[1]), away: Number(m[2]), ending };
}

/** Stejný tým? Přesně, přes převodní tabulku (aliasy), nebo když jeden název obsahuje druhý. */
function sameTeam(ours: string, theirs: string, name: TeamNamer): boolean {
  const a = ascii(ours);
  const b = ascii(name(null, theirs) ?? theirs);
  return a === b || (b.length >= 4 && a.includes(b)) || (a.length >= 4 && b.includes(a));
}

export interface ScorerResult {
  games: KotelGame[];
  pozor: string[];
  sources: Source[];
}

/**
 * Doplní střelce do zápasů kola a zkontroluje je: skóre ze zdroje proti TheSportsDB, součet gólů
 * střelců proti skóre (checkScorers), rozhodující nájezd a odkazy (jen povolené domény a jen ty,
 * které Claude opravdu viděl).
 */
export function applyScorers(games: readonly KotelGame[], report: readonly ReportGame[], opts: { seen: readonly string[]; domains?: readonly string[]; name: TeamNamer }): ScorerResult {
  const domains = opts.domains ?? SCORER_DOMAINS;
  const seen = new Set(opts.seen.map(normalizeUrl));
  const pozor: string[] = [];
  const sources = new Map<string, Source>();
  const used = new Set<ReportGame>();

  const out = games.map((g) => {
    if (!played(g)) return g;
    const label = `${gameName(g)} ${scoreText(g)}`;
    let r = report.find((x) => !used.has(x) && sameTeam(g.home, x.home, opts.name) && sameTeam(g.away, x.away, opts.name));
    let swapped = false;
    if (!r) {
      r = report.find((x) => !used.has(x) && sameTeam(g.home, x.away, opts.name) && sameTeam(g.away, x.home, opts.name));
      swapped = Boolean(r);
    }
    if (!r) {
      pozor.push(`Střelci zápasu ${label} chybí: AI zápas ve zdrojích nenašla.`);
      return g;
    }
    used.add(r);
    const filled: KotelGame = {
      ...g,
      homeScorers: swapped ? r.awayScorers : r.homeScorers,
      awayScorers: swapped ? r.homeScorers : r.awayScorers,
      ...(r.shootoutWinner && g.ending === 'so' ? { shootoutWinner: r.shootoutWinner } : {}),
    };

    if (r.note) pozor.push(`Střelci ${label}: ${r.note}`);
    const src = parseScore(r.score);
    if (!src) {
      pozor.push(`${label}: zdroj neuvádí čitelné skóre („${r.score}“).`);
    } else {
      const [h, a] = swapped ? [src.away, src.home] : [src.home, src.away];
      if (h !== g.homeGoals || a !== g.awayGoals || src.ending !== g.ending) {
        pozor.push(`${gameName(g)}: zdroj píše ${r.score}, TheSportsDB ${scoreText(g)}.`);
      }
    }
    if (filled.homeScorers.length + filled.awayScorers.length > 0) pozor.push(...checkScorers(filled));
    else if (expectedScorerGoals(g, 'home') + expectedScorerGoals(g, 'away') > 0) pozor.push(`Střelci zápasu ${label} chybí.`);
    if (g.ending === 'so' && !filled.shootoutWinner) pozor.push(`${label}: chybí, kdo proměnil rozhodující nájezd.`);

    let good = 0;
    for (const url of r.sources) {
      if (!onDomains(url, domains)) {
        pozor.push(`${label}: zdroj mimo povolené weby (${url}).`);
      } else if (!seen.has(normalizeUrl(url))) {
        pozor.push(`${label}: odkaz ${url} nebyl ve výsledcích hledání.`);
      } else {
        good++;
        const s = sources.get(url) ?? sources.set(url, { url, games: [] }).get(url)!;
        s.games.push(gameName(g));
      }
    }
    if (!good) pozor.push(`Střelci zápasu ${label} nemají ověřený zdroj.`);
    return filled;
  });

  return { games: out, pozor, sources: [...sources.values()] };
}

/** Celé dohledání: dotaz s vyhledáváním, přečtení odpovědi a kontrola. Nikdy nespadne kvůli obsahu. */
export async function findScorers(
  io: ClaudeIo,
  round: { round: number; dayLabel: string; season: string; games: KotelGame[] },
  name: TeamNamer,
  log: (line: string) => void = () => {},
): Promise<ScorerResult & { model: string }> {
  if (!round.games.some(played)) return { games: round.games, pozor: [], sources: [], model: io.model };
  const prompt = scorersPrompt(round.round, round.dayLabel, round.season, round.games);
  try {
    const answer = await askWithSearch(io, { ...prompt, domains: SCORER_DOMAINS, maxSearches: 10, maxFetches: 10 }, log);
    let report: ReportGame[];
    try {
      report = parseScorerReport(answer.text);
    } catch (e) {
      log(`Začátek odpovědi: ${JSON.stringify(answer.text.slice(0, 600))}`);
      throw new Error(`odpověď není čitelný JSON (${e instanceof Error ? e.message : String(e)})`);
    }
    const res = applyScorers(round.games, report, { seen: answer.seen, name });
    if (answer.stopReason === 'refusal') res.pozor.push('Claude dotaz na střelce odmítl.');
    return { ...res, model: answer.model };
  } catch (e) {
    return { games: round.games, pozor: [`Střelce se nepodařilo dohledat: ${e instanceof Error ? e.message : String(e)}`], sources: [], model: io.model };
  }
}
