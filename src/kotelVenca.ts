// Venca a kolo ligy (Extraligový kotel = formát `kotel`, fotbalová 1. liga = formát `liga` v prompts/system.md):
// data pro Claude API a kontrola jeho textů. Výsledky, střelce a tabulku dosazuje do grafiky kód; Venca dodá
// titulek, hlášku, popisek, výraz a muže kola, kterého vybírá jen z hráčů, kteří v kole skórovali.

import { numbersIn } from './facts.ts';
import { ascii } from './nhl.ts';
import { defaultHero, played, roundScorers, scoreText, shortDate, type KotelFacts } from './kotel.ts';
import { LEAGUES, type League } from './leagues.ts';
import { sourceLabel, type Source } from './scorers.ts';
import { checkExpression, cleanHashtags, LIMITS, sponsorNotes, str, vencaNotes, words, type Expression } from './venca.ts';

export interface KotelVencaOut {
  muz_kola: { name: string; team: string } | null;
  titulek: string;
  hlaska: string;
  popisek: string;
  hashtagy: string[];
  vyraz: Expression;
  pozor: string[];
}

const ENDING_TEXT = { reg: 'v základní době', ot: 'po prodloužení', so: 'po nájezdech' } as const;

/** Data pro Vencu: to, co je v grafice, česky pojmenované. */
export function kotelVencaData(facts: KotelFacts, league: League = LEAGUES.extraliga): Record<string, unknown> {
  const hockey = league.sport === 'hokej';
  return {
    soutez: hockey ? 'hokejová extraliga' : 'fotbalová 1. liga',
    kolo: facts.round,
    dny_kola: facts.dayLabel,
    zapasy: facts.games.map((g) =>
      played(g)
        ? {
            domaci: g.home,
            hoste: g.away,
            skore: scoreText(g),
            ...(hockey ? { konec: ENDING_TEXT[g.ending] } : {}),
            strelci_domaci: g.homeScorers.map((s) => ({ jmeno: s.name, goly: s.goals })),
            strelci_hoste: g.awayScorers.map((s) => ({ jmeno: s.name, goly: s.goals })),
            ...(g.shootoutWinner ? { rozhodujici_najezd: g.shootoutWinner } : {}),
            ...(g.playedOn ? { hrano: shortDate(g.playedOn) } : {}),
          }
        : { domaci: g.home, hoste: g.away, stav: g.postponedTo ? `odloženo na ${shortDate(g.postponedTo)}` : g.postponed ? 'odloženo' : 'bez výsledku' },
    ),
    tabulka: facts.table.map((r) => ({ poradi: r.pos, tym: r.team, zapasy: r.games, body: r.points })),
    strelci_kola: roundScorers(facts.games).map((s) => ({ jmeno: s.name, tym: s.team, goly: s.goals })),
  };
}

export function kotelUserMessage(facts: KotelFacts, date: string, league: League = LEAGUES.extraliga): string {
  return `FORMÁT: ${league.vencaFormat}\nDATUM: ${date}\nDATA:\n${JSON.stringify(kotelVencaData(facts, league), null, 2)}`;
}

/**
 * Čísla, která smí Venca v textech použít: kolo, skóre a součty gólů, góly střelců, tabulka
 * (pořadí, zápasy, body, bodové odstupy v horní půlce), dny a měsíce kola a odložených zápasů,
 * čísla třetin (1–3) a rok ’91 z popisu postavy.
 */
export function kotelAllowedNumbers(facts: KotelFacts, date: string): Set<string> {
  const out = new Set<string>(['1', '2', '3', '91']);
  const add = (n: number | string) => out.add(String(n));
  add(facts.round);
  const dates = [date, ...facts.games.flatMap((g) => [g.postponedTo, g.playedOn]).filter((d): d is string => Boolean(d))];
  for (const d of dates) {
    const [y, m, day] = d.split('-').map(Number) as [number, number, number];
    add(y);
    add(m);
    add(day);
  }
  for (const m of facts.dayLabel.match(/\d+/g) ?? []) add(Number(m));
  let total = 0;
  for (const g of facts.games) {
    if (!played(g)) continue;
    add(g.homeGoals!);
    add(g.awayGoals!);
    add(g.homeGoals! + g.awayGoals!);
    add(Math.abs(g.homeGoals! - g.awayGoals!));
    total += g.homeGoals! + g.awayGoals!;
    for (const s of [...g.homeScorers, ...g.awayScorers]) add(s.goals);
  }
  add(total);
  for (const r of facts.table) {
    add(r.pos);
    add(r.games);
    add(r.points);
  }
  const top = facts.table.slice(0, Math.max(6, Math.ceil(facts.table.length / 2)));
  for (const a of top) for (const b of facts.table) add(Math.abs(a.points - b.points));
  return out;
}

/** Muž kola od Vency, jen když v kole skóroval (jméno a tým, bez ohledu na diakritiku). */
export function findHero(facts: KotelFacts, pick: unknown): { name: string; team: string } | null {
  const o = (pick && typeof pick === 'object' ? pick : { jmeno: pick }) as Record<string, unknown>;
  const name = str(o.jmeno ?? o.name);
  const team = str(o.tym ?? o.team);
  if (!name) return null;
  const all = roundScorers(facts.games);
  const hit = all.find((s) => s.name === name && (!team || s.team === team)) ?? all.find((s) => ascii(s.name) === ascii(name) && (!team || ascii(s.team) === ascii(team)));
  return hit ? { name: hit.name, team: hit.team } : null;
}

/**
 * Převezme výstup Vency a zkontroluje ho proti datům. Nikdy nevyhodí chybu kvůli obsahu:
 * co nesedí, opraví na bezpečnou hodnotu a zapíše do `pozor`.
 */
export function checkKotelVenca(raw: unknown, facts: KotelFacts, date: string): KotelVencaOut {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pozor = vencaNotes(o.pozor);

  let hero = findHero(facts, o.muz_kola);
  if (!hero) {
    const fallback = defaultHero(facts.games);
    const picked = typeof o.muz_kola === 'string' ? o.muz_kola : str((o.muz_kola as Record<string, unknown> | null)?.jmeno);
    if (picked && fallback) pozor.push(`Muž kola „${picked}“ v kole neskóroval, vybral ho kód.`);
    hero = fallback ?? null;
  }

  const vyraz = checkExpression(o.vyraz, pozor);
  const titulek = str(o.titulek);
  const hlaska = str(o.hlaska);
  const popisek = str(o.popisek);
  if (!titulek) pozor.push('Chybí titulek.');
  if (!hlaska) pozor.push('Chybí hláška.');
  if (!popisek) pozor.push('Chybí popisek.');
  if (titulek && words(titulek) > LIMITS.titulekWords) pozor.push(`Titulek je delší než ${LIMITS.titulekWords} slov.`);
  if (hlaska && words(hlaska) > LIMITS.hlaskaWords) pozor.push(`Hláška je delší než ${LIMITS.hlaskaWords} slov.`);

  const allowed = kotelAllowedNumbers(facts, date);
  for (const [label, text] of [['titulku', titulek], ['hlášce', hlaska], ['popisku', popisek]] as const) {
    const bad = numbersIn(text).filter((n) => !allowed.has(n.replace(/^0+(?=\d)/, '')));
    if (bad.length) pozor.push(`Čísla v ${label} nejsou v datech: ${[...new Set(bad)].join(', ')}.`);
  }
  pozor.push(...sponsorNotes({ titulku: titulek, hlášce: hlaska, popisku: popisek }));

  return { muz_kola: hero, titulek, hlaska, popisek, hashtagy: cleanHashtags(o.hashtagy), vyraz, pozor };
}

/** Texty bez AI (zkouška bez klíče): suché, ale z dat. */
export function fallbackKotelVenca(facts: KotelFacts, league: League = LEAGUES.extraliga): KotelVencaOut {
  const name = league.sport === 'hokej' ? 'extraliga' : '1. liga';
  return {
    muz_kola: defaultHero(facts.games) ?? null,
    titulek: `${name === 'extraliga' ? 'Extraliga' : '1. liga'} po ${facts.round}. kole`,
    hlaska: 'Dneska bez komentáře, Venca si dal volno. Výsledky ale sedí.',
    popisek: `Výsledky ${facts.round}. kola (${name}) a špička tabulky. Kdo vás tohle kolo potěšil?`,
    hashtagy: league.hashtags,
    vyraz: 'klid',
    pozor: ['Texty jsou bez AI (zkouška bez klíče ANTHROPIC_API_KEY).'],
  };
}

/** Označení postavy a zdrojů dat (grafika i popisek). */
export function kotelDisclaimer(sources: readonly Pick<Source, 'url'>[]): string {
  const labels = [...new Set(sources.map((s) => sourceLabel(s.url)))];
  return labels.length ? `Fiktivní AI postava. Výsledky z TheSportsDB, střelci ze zpráv ${labels.join(', ')}.` : 'Fiktivní AI postava. Výsledky z TheSportsDB.';
}

/** Popisek na Instagram: Vencův text, hashtagy a označení postavy se zdroji. */
export function kotelCaption(v: Pick<KotelVencaOut, 'popisek' | 'hashtagy'>, sources: readonly Pick<Source, 'url'>[]): string {
  return [v.popisek, v.hashtagy.join(' '), kotelDisclaimer(sources)].filter(Boolean).join('\n\n');
}
