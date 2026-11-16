// Venca: texty příspěvku z Claude API a jejich kontrola. Fakta do grafiky dává kód (facts.ts),
// Venca dodá titulek, hlášku, popisek, výraz a výběr muže noci. Kontrola (`checkVenca`) hlídá,
// že čísla v textech jsou v datech a že výstup má správný tvar; co nesedí, jde do `pozor`
// a příspěvek pak čeká na schválení člověkem.

import { allowedNumbers, numbersIn } from './facts.ts';
import { lineText, type Night } from './nhl.ts';

export const EXPRESSIONS = ['klid', 'radost', 'nadseni', 'zklamani', 'vztek', 'rikal', 'nevericne', 'nervozita'] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export interface VencaOut {
  muz_noci: string | null;
  titulek: string;
  hlaska: string;
  popisek: string;
  hashtagy: string[];
  vyraz: Expression;
  pozor: string[];
}

export const LIMITS = { titulekWords: 6, hlaskaWords: 34, hashtags: 5 };

const DAYS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];

/** „pondělí 9. 11.“ */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()}. ${d.getUTCMonth() + 1}.`;
}

/** Data pro Vencu: jen to, co je v grafice, česky pojmenované. */
export function vencaData(night: Night, pragueDate: string): Record<string, unknown> {
  return {
    noc_na: dayLabel(pragueDate),
    hraci: night.players.map((p) => ({
      id: p.id,
      jmeno: p.jmeno,
      tym: p.team,
      brankar: p.goalie,
      ...(p.goalie
        ? { zakroky: p.saves, strely_na_branu: p.shotsAgainst, obdrzene_goly: p.goalsAgainst, uspesnost_procent: p.savePct === null ? null : Number((p.savePct * 100).toFixed(1)) }
        : { goly: p.goals, asistence: p.assists, body: p.points, strely: p.shots }),
      zapas: lineText(p.game),
      vysledek_tymu: p.won ? 'výhra' : 'prohra',
    })),
    nedohrane_zapasy: night.unfinished,
  };
}

export function userMessage(night: Night, pragueDate: string): string {
  return `FORMÁT: ranni_pivo\nDATUM: ${pragueDate}\nDATA:\n${JSON.stringify(vencaData(night, pragueDate), null, 2)}`;
}

export interface ClaudeIo {
  fetch: typeof fetch;
  apiKey: string;
  model: string;
}

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

/** Zavolá Claude API a vrátí text odpovědi. Klíč se nikdy nevypisuje. */
export async function askClaude(io: ClaudeIo, system: string, user: string): Promise<string> {
  const res = await io.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': io.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: io.model, max_tokens: 1200, system, messages: [{ role: 'user', content: user }] }),
  });
  const json = (await res.json().catch(() => null)) as { content?: { type: string; text?: string }[]; error?: { message?: string } } | null;
  if (!res.ok || !json) throw new Error(`Claude API odmítlo dotaz: ${json?.error?.message ?? `stav ${res.status}`}`);
  return (json.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
}

/** JSON z odpovědi, i když ho model obalí do ``` nebo přidá větu navíc. */
export function parseJsonLoose(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Venca nevrátil JSON.');
  return JSON.parse(body.slice(start, end + 1));
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * Převezme výstup Vency a zkontroluje ho proti datům. Nikdy nevyhodí chybu kvůli obsahu: co nesedí,
 * opraví na bezpečnou hodnotu a zapíše do `pozor`.
 */
export function checkVenca(raw: unknown, night: Night, pragueDate: string): VencaOut {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pozor: string[] = Array.isArray(o.pozor) ? o.pozor.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => `Venca: ${x.trim()}`) : [];

  const ids = new Set(night.players.map((p) => p.id));
  let muz = str(o.muz_noci) || null;
  if (muz && !ids.has(muz)) {
    pozor.push(`Muž noci „${muz}“ v datech není, vybral ho kód.`);
    muz = null;
  }

  let vyraz = str(o.vyraz) as Expression;
  if (!EXPRESSIONS.includes(vyraz)) {
    if (o.vyraz !== undefined) pozor.push(`Neznámý výraz „${String(o.vyraz)}“, použit klid.`);
    vyraz = 'klid';
  }

  const titulek = str(o.titulek);
  const hlaska = str(o.hlaska);
  const popisek = str(o.popisek);
  if (!titulek) pozor.push('Chybí titulek.');
  if (!hlaska) pozor.push('Chybí hláška.');
  if (!popisek) pozor.push('Chybí popisek.');
  if (titulek && words(titulek) > LIMITS.titulekWords) pozor.push(`Titulek je delší než ${LIMITS.titulekWords} slov.`);
  if (hlaska && words(hlaska) > LIMITS.hlaskaWords) pozor.push(`Hláška je delší než ${LIMITS.hlaskaWords} slov.`);

  const allowed = allowedNumbers(night.players, pragueDate);
  for (const [label, text] of [['titulku', titulek], ['hlášce', hlaska], ['popisku', popisek]] as const) {
    const bad = numbersIn(text).filter((n) => !allowed.has(n));
    if (bad.length) pozor.push(`Čísla v ${label} nejsou v datech: ${[...new Set(bad)].join(', ')}.`);
  }

  const hashtagy = (Array.isArray(o.hashtagy) ? o.hashtagy : [])
    .filter((h): h is string => typeof h === 'string')
    .map((h) => h.trim().replace(/^#?/, '#').replace(/\s+/g, ''))
    .filter((h) => /^#[\p{L}\p{N}_]+$/u.test(h) && !/tip|kurz|sazk|sázk|bet/i.test(h))
    .slice(0, LIMITS.hashtags);

  if (night.unfinished.length) pozor.push(`Při výrobě nebyly dohrané zápasy: ${night.unfinished.join(', ')}. Mohli v nich hrát Češi.`);

  return { muz_noci: muz, titulek, hlaska, popisek, hashtagy, vyraz, pozor };
}

/** Texty bez AI (zkouška bez klíče): suché, ale z dat. */
export function fallbackVenca(night: Night): VencaOut {
  return {
    muz_noci: null,
    titulek: 'Češi v NHL přes noc',
    hlaska: 'Dneska bez komentáře, Venca si dal volno. Čísla ale sedí.',
    popisek: 'Noční přehled Čechů v NHL. Kdo vás potěšil nejvíc?',
    hashtagy: ['#NHL', '#CesiVNHL', '#hokej'],
    vyraz: 'klid',
    pozor: ['Texty jsou bez AI (zkouška bez klíče ANTHROPIC_API_KEY).', ...(night.unfinished.length ? [`Nedohrané zápasy: ${night.unfinished.join(', ')}.`] : [])],
  };
}

export const DISCLAIMER = 'Fiktivní AI postava. Výsledky z dat NHL.';

/** Popisek na Instagram: Vencův text, případně Češi, kteří se nevešli do grafiky, hashtagy a označení postavy. */
export function caption(v: Pick<VencaOut, 'popisek' | 'hashtagy'>, hidden: readonly { jmeno: string; team: string; value: string }[] = []): string {
  const extra = hidden.length ? `Další Češi přes noc: ${hidden.map((h) => `${h.jmeno} (${h.team}) ${h.value}`).join(', ')}.` : '';
  return [v.popisek, extra, v.hashtagy.join(' '), DISCLAIMER].filter(Boolean).join('\n\n');
}
