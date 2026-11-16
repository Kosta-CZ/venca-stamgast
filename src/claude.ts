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

// ---- Spotřeba a cena ----

/**
 * Ceník Claude API v dolarech za milion tokenů (zápis do cache na 5 minut). Hledání stojí $10 za 1000,
 * stažení stránky jen tokeny. Model mimo ceník se v logu ukáže jako „cena neznámá“.
 */
const PRICES: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
};
const SEARCH_USD = 0.01;
/** Hrubý přepočet do korun, jen pro log a zprávu ke schválení. */
export const KC_PER_USD = 22;

type Usage = Anthropic.Beta.BetaUsage;

/** Cena jedné odpovědi v dolarech, nebo null, když model není v ceníku. */
export function costUsd(model: string, u: Usage): number | null {
  const p = PRICES[model];
  if (!p) return null;
  const tokens = u.input_tokens * p.input + (u.cache_creation_input_tokens ?? 0) * p.cacheWrite + (u.cache_read_input_tokens ?? 0) * p.cacheRead + u.output_tokens * p.output;
  return tokens / 1e6 + (u.server_tool_use?.web_search_requests ?? 0) * SEARCH_USD;
}

/** Útrata celého běhu (všechna volání Claude API); `priced` je false, když některý model nebyl v ceníku. */
export const spend = { usd: 0, priced: true };

interface Tally {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  thinking: number;
  searches: number;
  fetches: number;
  usd: number;
  priced: boolean;
}

const newTally = (): Tally => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0, searches: 0, fetches: 0, usd: 0, priced: true });

function addUsage(t: Tally, model: string, u: Usage): void {
  t.input += u.input_tokens;
  t.cacheWrite += u.cache_creation_input_tokens ?? 0;
  t.cacheRead += u.cache_read_input_tokens ?? 0;
  t.output += u.output_tokens;
  t.thinking += u.output_tokens_details?.thinking_tokens ?? 0;
  t.searches += u.server_tool_use?.web_search_requests ?? 0;
  t.fetches += u.server_tool_use?.web_fetch_requests ?? 0;
  const c = costUsd(model, u);
  if (c === null) {
    t.priced = false;
    spend.priced = false;
  } else {
    t.usd += c;
    spend.usd += c;
  }
}

const kilo = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)} tis.` : String(n));

/** Cena v dolarech a hrubě v korunách: „$0.123 (asi 2,7 Kč)“. */
export const usdText = (usd: number) => `$${usd.toFixed(3)} (asi ${(usd * KC_PER_USD).toFixed(1).replace('.', ',')} Kč)`;

function tallyText(t: Tally): string {
  const cache = t.cacheRead ? ` (z cache ${kilo(t.cacheRead)})` : '';
  const think = t.thinking ? ` (přemýšlení ${kilo(t.thinking)})` : '';
  return `Tokeny: vstup ${kilo(t.input + t.cacheWrite + t.cacheRead)}${cache}, výstup ${kilo(t.output)}${think}. Cena ${t.priced ? usdText(t.usd) : 'neznámá (model mimo ceník)'}.`;
}

/** Srozumitelná chyba API (došlý kredit, odmítnutý klíč); klíč samotný se nikdy nevypisuje. */
export function apiError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (/credit balance is too low/i.test(msg)) return new Error('Došel kredit Claude API (dobití: console.anthropic.com, Plans & Billing).');
  if (/authentication_error|invalid x-api-key/i.test(msg)) return new Error('Claude API odmítlo klíč ANTHROPIC_API_KEY.');
  return err instanceof Error ? err : new Error(msg);
}

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
  }).catch((err: unknown) => {
    throw apiError(err);
  });
  const text = textOf(m.content);
  const t = newTally();
  addUsage(t, m.model, m.usage);
  log(`${describe(m, text)} ${tallyText(t)}`);
  return text;
}

export interface SearchAsk {
  system: string;
  user: string;
  /** Jen tyhle domény (i jejich subdomény) smí vyhledávání a stahování stránek použít. */
  domains: string[];
  maxSearches?: number;
  maxFetches?: number;
  /**
   * Nejvýš tokenů z jedné stažené stránky (výchozí 40 000). Stránka zůstává v kontextu po celé hledání
   * a každý další krok ji znovu čte, takže menší strop výrazně zlevní hledání s mnoha kroky.
   */
  maxPageTokens?: number;
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
 *
 * Cache: při hledání Claude každý další krok znovu čte všechno, co už našel. S cache (`cache_control`)
 * se to opakované čtení platí za 5 % ceny, jinak by byla většina útraty za čtení stejných stránek.
 */
export async function askWithSearch(io: ClaudeIo, ask: SearchAsk, log: (line: string) => void = () => {}): Promise<SearchAnswer> {
  const c = client(io, 2);
  let domains = [...ask.domains];
  const tools = () => [
    { type: 'web_search_20260209' as const, name: 'web_search' as const, max_uses: ask.maxSearches ?? 8, allowed_domains: domains },
    { type: 'web_fetch_20260209' as const, name: 'web_fetch' as const, max_uses: ask.maxFetches ?? 8, allowed_domains: domains, max_content_tokens: ask.maxPageTokens ?? 40000 },
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: ask.user }];
  const all: Block[] = [];
  const t = newTally();
  let m: Message | undefined;
  for (let turn = 0; turn < 6; turn++) {
    try {
      m = await c.beta.messages.create({
        model: io.model,
        max_tokens: 16000,
        system: ask.system,
        messages,
        tools: tools(),
        cache_control: { type: 'ephemeral' },
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
      throw apiError(err);
    }
    all.push(...m.content);
    addUsage(t, m.model, m.usage);
    if (m.stop_reason !== 'pause_turn') break;
    log('Claude hledá dlouho (pause_turn), pokračuji.');
    messages.push({ role: 'assistant', content: m.content });
  }
  if (!m) throw new Error('Claude neodpověděl.');
  const text = finalText(all);
  // Velikost kontextu v posledním kroku hledání (podle ní se ladí strop stránek a hledání).
  const steps = (m.usage.iterations ?? []).filter((i): i is Anthropic.Beta.BetaMessageIterationUsage => i.type === 'message');
  const last = steps[steps.length - 1];
  const context = last ? ` Kontext na konci ${kilo(last.input_tokens + last.cache_creation_input_tokens + last.cache_read_input_tokens)}, kroků ${steps.length}.` : '';
  log(`${describe(m, text)} Hledání ${t.searches}×, stažené stránky ${t.fetches}×. ${tallyText(t)}${context}`);
  return { text, seen: seenUrls(all), searches: t.searches, fetches: t.fetches, model: m.model, stopReason: m.stop_reason };
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
