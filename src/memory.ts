// Paměť Vency: posledních pár hlášek z odeslaných konceptů (v R2 venca/posledni-hlasky.json).
// Každé volání Claude je samostatné; bez paměti Venca sahal pořád po stejné podpisové hlášce
// („Jardo, ani nic neříkej“ třikrát za sebou, 17.–19. 11. 2026). Hlášky dostane do zadání
// a kód navíc pohlídá, aby nový text neopakoval jejich obraty.

import { ascii } from './nhl.ts';
import type { Store } from './storage.ts';

export const RECENT_KEY = 'venca/posledni-hlasky.json';
export const RECENT_MAX = 12;

export interface RecentLine {
  /** Id konceptu, např. 2026-11-19-ranni-pivo. */
  id: string;
  hlaska: string;
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Poslední hlášky. Když paměť ještě není (první běh po zavedení), poskládá ji z konceptů posledních
 * `days` dní (Ranní pivo, Kotel, 1. liga), ať Venca hned nezopakuje, co psal minulý týden.
 */
export async function loadRecent(store: Store, today?: string, days = 7): Promise<RecentLine[]> {
  let text: string | null;
  try {
    text = await store.get(RECENT_KEY);
  } catch {
    return [];
  }
  if (text === null) return today ? seedRecent(store, today, days) : [];
  try {
    const data: unknown = JSON.parse(text);
    return Array.isArray(data)
      ? data.filter((x): x is RecentLine => Boolean(x) && typeof x.id === 'string' && typeof x.hlaska === 'string')
      : [];
  } catch {
    return [];
  }
}

async function seedRecent(store: Store, today: string, days: number): Promise<RecentLine[]> {
  const out: RecentLine[] = [];
  for (let i = 0; i <= days && out.length < RECENT_MAX; i++) {
    for (const kind of ['ranni-pivo', 'kotel', 'liga']) {
      const id = `${addDays(today, -i)}-${kind}`;
      try {
        const body = await store.get(`drafts/${id}.json`);
        const hlaska = body ? (JSON.parse(body) as { venca?: { hlaska?: unknown } }).venca?.hlaska : undefined;
        if (typeof hlaska === 'string' && hlaska) out.push({ id, hlaska });
      } catch {
        // Chybějící nebo rozbitý koncept paměť jen nedoplní.
      }
    }
  }
  return out.slice(0, RECENT_MAX);
}

/** Přidá hlášku konceptu na začátek; stejné id se nahradí (opakovaná výroba téhož dne). */
export function withLine(list: readonly RecentLine[], line: RecentLine, max = RECENT_MAX): RecentLine[] {
  return [line, ...list.filter((x) => x.id !== line.id)].slice(0, max);
}

/** Blok do zadání pro Vencu: co psal naposledy a co už nesmí opakovat. */
export function recentBlock(list: readonly RecentLine[]): string {
  if (!list.length) return '';
  return `\n\nPOSLEDNÍ HLÁŠKY (od nejnovější). Žádný jejich obrat ani podpisovou hlášku, která v nich je, znovu nepoužij:\n${list.map((x) => `- „${x.hlaska}“`).join('\n')}`;
}

/** Slova textu: původní podoba a podoba pro porovnání (bez diakritiky a interpunkce). */
function tokens(text: string): { raw: string; key: string }[] {
  return text.split(/\s+/).map((raw) => ({ raw, key: ascii(raw).replace(/[^a-z0-9]/g, '') })).filter((t) => t.key);
}

/**
 * Obraty (aspoň `n` slov po sobě), které hláška sdílí s posledními hláškami, v původní podobě
 * a sloučené do souvislých úseků („Jardo, ani nic neříkej.“).
 */
export function repeatedPhrases(hlaska: string, list: readonly RecentLine[], n = 4): string[] {
  const words = tokens(hlaska);
  const hit = new Array<boolean>(words.length).fill(false);
  const recent = list.map((r) => ` ${tokens(r.hlaska).map((t) => t.key).join(' ')} `);
  for (let i = 0; i + n <= words.length; i++) {
    const gram = ` ${words.slice(i, i + n).map((t) => t.key).join(' ')} `;
    if (recent.some((r) => r.includes(gram))) for (let j = i; j < i + n; j++) hit[j] = true;
  }
  const out: string[] = [];
  let span: string[] = [];
  words.forEach((t, i) => {
    if (hit[i]) span.push(t.raw);
    else if (span.length) {
      out.push(span.join(' '));
      span = [];
    }
  });
  if (span.length) out.push(span.join(' '));
  return out;
}

/** Poznámky do „pozor“: hláška opakuje obrat z minulých příspěvků. */
export const repeatNotes = (hlaska: string, list: readonly RecentLine[]): string[] =>
  repeatedPhrases(hlaska, list).map((p) => `Hláška opakuje obrat z minulých příspěvků: „${p}“.`);
