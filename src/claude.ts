// Claude API přes oficiální SDK: texty Vency (bez nástrojů) a dohledávání faktů s vyhledáváním
// omezeným na vybrané domény (střelci Kotle, fakta k MMA). Klíč se nikdy nevypisuje. Když model
// odpověď odmítne (refusal), API samo zkusí záložní model (server-side fallback).

import Anthropic from '@anthropic-ai/sdk';

export interface ClaudeIo {
  fetch: typeof fetch;
  apiKey: string;
  model: string;
}

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

/** Záložní model při odmítnutí: API ho vybere samo podle druhu odmítnutí. */
const BETAS = ['server-side-fallback-2026-07-01'];

type Message = Anthropic.Beta.BetaMessage;
type Block = Anthropic.Beta.BetaContentBlock;

function client(io: ClaudeIo, maxRetries = 4): Anthropic {
  return new Anthropic({ apiKey: io.apiKey, fetch: io.fetch, maxRetries });
}

const describe = (m: Message, text: string) =>
  `Claude (${m.model}): konec ${m.stop_reason ?? '?'}, bloky ${[...new Set(m.content.map((c) => c.type))].join(', ') || 'žádné'}, ${text.length} znaků textu.`;

const textOf = (blocks: readonly Block[]) => blocks.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('');

/** Jednoduchý dotaz bez nástrojů: vrátí text odpovědi. */
export async function askClaude(io: ClaudeIo, system: string, user: string, log: (line: string) => void = () => {}): Promise<string> {
  const m = await client(io).beta.messages.create({
    model: io.model,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content: user }],
    betas: BETAS,
    fallbacks: 'default',
  });
  const text = textOf(m.content);
  log(describe(m, text));
  return text;
}

export interface SearchAsk {
  system: string;
  user: string;
  /** Jen tyhle domény (i jejich subdomény) smí vyhledávání a stahování stránek použít. */
  domains: string[];
  maxSearches?: number;
  maxFetches?: number;
}

export interface SearchAnswer {
  /** Text po posledním výsledku nástroje (tam je odpověď, např. JSON). */
  text: string;
  /** Adresy, které Claude opravdu dostal z vyhledávání nebo stáhl (pro kontrolu odkazů v odpovědi). */
  seen: string[];
  searches: number;
  fetches: number;
  model: string;
  stopReason: string | null;
}

/** Výsledky nástrojů v odpovědi: adresy z vyhledávání, stažených stránek a citací. */
export function seenUrls(blocks: readonly Block[]): string[] {
  const out = new Set<string>();
  for (const b of blocks) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content) if (r.url) out.add(r.url);
    } else if (b.type === 'web_fetch_tool_result' && b.content.type === 'web_fetch_result') {
      out.add(b.content.url);
    } else if (b.type === 'text') {
      for (const c of b.citations ?? []) if ('url' in c && typeof c.url === 'string') out.add(c.url);
    }
  }
  return [...out];
}

/** Text za posledním blokem nástroje (Claude před hledáním občas napíše, co bude dělat). */
export function finalText(blocks: readonly Block[]): string {
  let start = 0;
  blocks.forEach((b, i) => {
    if (b.type !== 'text' && b.type !== 'thinking' && b.type !== 'redacted_thinking') start = i + 1;
  });
  return textOf(blocks.slice(start)) || textOf(blocks);
}

/**
 * Weby, které API odmítne, protože blokují vyhledávacího robota Anthropicu
 * („The following domains are not accessible to our user agent: ['idnes.cz']“).
 */
export function blockedDomains(err: unknown): string[] {
  const m = /domains are not accessible to our user agent: \[([^\]]*)\]/.exec(err instanceof Error ? err.message : String(err));
  return m ? [...(m[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]!).filter(Boolean) : [];
}

/**
 * Dotaz s vyhledáváním (web_search) a stahováním stránek (web_fetch), obojí jen na `domains`.
 * Web, který vyhledávání blokuje, se vyřadí a hledá se bez něj. Dlouhé hledání API přeruší
 * (`pause_turn`): odpověď se pošle zpátky a pokračuje se, nejvýš 5×.
 */
export async function askWithSearch(io: ClaudeIo, ask: SearchAsk, log: (line: string) => void = () => {}): Promise<SearchAnswer> {
  const c = client(io, 2);
  let domains = [...ask.domains];
  const tools = () => [
    { type: 'web_search_20260209' as const, name: 'web_search' as const, max_uses: ask.maxSearches ?? 8, allowed_domains: domains },
    { type: 'web_fetch_20260209' as const, name: 'web_fetch' as const, max_uses: ask.maxFetches ?? 8, allowed_domains: domains, max_content_tokens: 40000 },
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: ask.user }];
  const all: Block[] = [];
  let searches = 0;
  let fetches = 0;
  let m: Message | undefined;
  for (let turn = 0; turn < 6; turn++) {
    try {
      m = await c.beta.messages.create({
        model: io.model,
        max_tokens: 16000,
        system: ask.system,
        messages,
        tools: tools(),
        betas: BETAS,
        fallbacks: 'default',
      });
    } catch (err) {
      const blocked = blockedDomains(err);
      const left = domains.filter((d) => !blocked.includes(d));
      if (!all.length && blocked.length && left.length && left.length < domains.length) {
        log(`Weby ${blocked.join(', ')} blokují vyhledávání Claude, hledám bez nich.`);
        domains = left;
        turn--;
        continue;
      }
      throw err;
    }
    all.push(...m.content);
    searches += m.usage.server_tool_use?.web_search_requests ?? 0;
    fetches += m.usage.server_tool_use?.web_fetch_requests ?? 0;
    if (m.stop_reason !== 'pause_turn') break;
    log('Claude hledá dlouho (pause_turn), pokračuji.');
    messages.push({ role: 'assistant', content: m.content });
  }
  if (!m) throw new Error('Claude neodpověděl.');
  const text = finalText(all);
  log(`${describe(m, text)} Hledání ${searches}×, stažené stránky ${fetches}×.`);
  return { text, seen: seenUrls(all), searches, fetches, model: m.model, stopReason: m.stop_reason };
}

/** Patří adresa na některou z domén (nebo jejich subdoménu)? */
export function onDomains(url: string, domains: readonly string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Adresa bez kotvy a koncového lomítka, ať se dají porovnat odkazy z odpovědi s výsledky hledání. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    u.protocol = 'https:';
    return u.toString().replace(/\/$/, '');
  } catch {
    return url.trim();
  }
}
