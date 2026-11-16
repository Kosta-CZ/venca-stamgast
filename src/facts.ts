// Fakta příspěvku Ranní pivo: co ukáže grafika (muž noci, další Češi, výsledky) a jaká čísla
// smí Venca v textech použít. Všechno se počítá z dat, AI do čísel nesahá.

import { lineText, type NightPlayer } from './nhl.ts';

/** Český tvar podle počtu: 1 gól, 2 góly, 5 gólů. */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n);
  if (a === 1) return one;
  if (a >= 2 && a <= 4) return few;
  return many;
}

/** Úspěšnost jako „88,5 %“. */
export function pctText(p: number | null): string {
  if (p === null) return '–';
  return `${(p * 100).toFixed(1).replace('.', ',')} %`;
}

/** Hodnota do řádku: „2+0“ u hráče, „88,5 %“ u brankáře. */
export function valueText(p: NightPlayer): string {
  return p.goalie ? pctText(p.savePct) : `${p.goals}+${p.assists}`;
}

/** Jak výrazná byla noc hráče (pro výchozí výběr muže noci a pořadí). */
export function weight(p: NightPlayer): number {
  if (p.goalie) {
    const pct = p.savePct ?? 0;
    const shutout = p.goalsAgainst === 0 && p.shotsAgainst > 0 ? 3 : 0;
    return (pct >= 0.93 ? 3 : pct >= 0.9 ? 1.5 : 0.5) + shutout + (p.won ? 0.5 : 0);
  }
  return p.goals * 3 + p.assists * 2 + (p.won ? 0.5 : 0) + p.shots * 0.05;
}

export interface HeroFacts {
  id: string;
  jmeno: string;
  team: string;
  big: number;
  unit: string;
  lines: string[];
}

export interface Row {
  id: string;
  jmeno: string;
  team: string;
  context: string;
  value: string;
}

export interface PostFacts {
  hero: HeroFacts;
  others: Row[];
  /** Kolik dalších Čechů hrálo a do grafiky se nevešlo. */
  more: number;
  /** Ti, kdo se do grafiky nevešli (jdou do popisku). */
  hidden: Row[];
}

export const MAX_OTHERS = 4;

function heroFacts(p: NightPlayer): HeroFacts {
  const game = lineText(p.game);
  if (p.goalie) {
    return {
      id: p.id, jmeno: p.jmeno, team: p.team,
      big: p.saves, unit: plural(p.saves, 'zákrok', 'zákroky', 'zákroků'),
      lines: [game, `Úspěšnost ${pctText(p.savePct)}, ${p.goalsAgainst} ${plural(p.goalsAgainst, 'obdržený gól', 'obdržené góly', 'obdržených gólů')}`, p.won ? 'Výhra' : 'Prohra'],
    };
  }
  const [big, unit] = p.goals > 0
    ? [p.goals, plural(p.goals, 'gól', 'góly', 'gólů')]
    : p.assists > 0
      ? [p.assists, plural(p.assists, 'asistence', 'asistence', 'asistencí')]
      : [p.points, plural(p.points, 'bod', 'body', 'bodů')];
  const detail = [`${p.goals} ${plural(p.goals, 'gól', 'góly', 'gólů')}`, `${p.assists} ${plural(p.assists, 'asistence', 'asistence', 'asistencí')}`];
  if (p.shots > 0) detail.push(`${p.shots} ${plural(p.shots, 'střela', 'střely', 'střel')}`);
  return { id: p.id, jmeno: p.jmeno, team: p.team, big, unit, lines: [game, detail.join(', '), p.won ? 'Výhra' : 'Prohra'] };
}

function row(p: NightPlayer): Row {
  const game = lineText(p.game);
  const context = p.goalie ? `${p.saves} ${plural(p.saves, 'zákrok', 'zákroky', 'zákroků')}. ${game}` : game;
  return { id: p.id, jmeno: p.jmeno, team: p.team, context, value: valueText(p) };
}

/** Výchozí muž noci, když Venca žádného nevybere (nebo vybere někoho, kdo nehrál). */
export function defaultHero(players: readonly NightPlayer[]): NightPlayer | undefined {
  return [...players].sort((a, b) => weight(b) - weight(a))[0];
}

/** Grafika: muž noci a další Češi seřazení podle výraznosti, nejvýš `MAX_OTHERS`. */
export function postFacts(players: readonly NightPlayer[], heroId?: string): PostFacts | null {
  if (players.length === 0) return null;
  const hero = players.find((p) => p.id === heroId) ?? defaultHero(players);
  if (!hero) return null;
  const rest = players.filter((p) => p !== hero).sort((a, b) => weight(b) - weight(a));
  const hidden = rest.slice(MAX_OTHERS).map(row);
  return { hero: heroFacts(hero), others: rest.slice(0, MAX_OTHERS).map(row), more: hidden.length, hidden };
}

/**
 * Čísla, která smí Venca v textech použít: všechno z dat noci, datum příspěvku, čísla třetin (1–3)
 * a rok jeho sezóny ’91 z popisu postavy.
 */
export function allowedNumbers(players: readonly NightPlayer[], pragueDate: string): Set<string> {
  const out = new Set<string>(['1', '2', '3', '91']);
  const add = (n: number | string) => out.add(String(n));
  const [, m, d] = pragueDate.split('-');
  if (m && d) {
    add(Number(m));
    add(Number(d));
    add(Number(d) - 1);
  }
  for (const p of players) {
    for (const n of [p.goals, p.assists, p.points, p.shots, p.saves, p.shotsAgainst, p.goalsAgainst, p.game.homeScore, p.game.awayScore]) add(n);
    if (p.savePct !== null) {
      const pct = (p.savePct * 100).toFixed(1);
      add(pct);
      add(pct.replace('.', ','));
      add(Math.round(p.savePct * 100));
    }
  }
  return out;
}

/** Čísla v textu („1:4“ dá 1 a 4, „88,5“ zůstane celé). */
export function numbersIn(text: string): string[] {
  return text.match(/\d+(?:[.,]\d+)?/g) ?? [];
}
