import { describe, expect, it, vi } from 'vitest';
import { apiError, askClaude, askWithSearch, blockedDomains, costUsd, normalizeUrl, onDomains, spend, usdText } from '../src/claude.ts';
import { SCORER_DOMAINS } from '../src/scorers.ts';

const usage = (search = 0, fetch = 0) => ({ input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: search, web_fetch_requests: fetch } });
const message = (content: unknown[], stop_reason: string, u = usage()) => ({
  id: `msg_${Math.random().toString(36).slice(2)}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5',
  content, stop_reason, stop_sequence: null, usage: u,
});

/** Falešné Claude API: vrací připravené odpovědi a zapisuje požadavky. */
function fakeApi(responses: unknown[]) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return { f: f as unknown as typeof fetch, calls };
}

describe('Claude API', () => {
  it('text odpovědi, záložní model při odmítnutí, klíč jen v hlavičce', async () => {
    const { f, calls } = fakeApi([message([{ type: 'text', text: '{"ok":true}' }], 'end_turn')]);
    expect(await askClaude({ fetch: f, apiKey: 'sk-test', model: 'claude-sonnet-5-5' }, 'systém', 'dotaz')).toBe('{"ok":true}');
    expect(calls[0]!.body.fallbacks).toBe('default');
    expect(calls[0]!.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer sk-test');
    expect(JSON.stringify(calls[0]!.body)).not.toContain('sk-test');
  });

  it('vyhledávání jen na povolených doménách, po pause_turn pokračuje a sbírá adresy, které Claude viděl', async () => {
    const { f, calls } = fakeApi([
      message([
        { type: 'text', text: 'Hledám souhrn kola.' },
        { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'extraliga 19. kolo' } },
        { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: 'https://www.ceskenoviny.cz/zpravy/1', title: 'Souhrn', encrypted_content: 'x', page_age: null }] },
      ], 'pause_turn', usage(1, 0)),
      message([
        { type: 'server_tool_use', id: 'srvtoolu_2', name: 'web_fetch', input: { url: 'https://www.hokej.cz/zapas/2' } },
        { type: 'web_fetch_tool_result', tool_use_id: 'srvtoolu_2', content: { type: 'web_fetch_result', url: 'https://www.hokej.cz/zapas/2', retrieved_at: null, content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'Branky: …' } } } },
        { type: 'text', text: '{"kolo":19,"zapasy":[]}' },
      ], 'end_turn', usage(0, 1)),
    ]);
    const a = await askWithSearch({ fetch: f, apiKey: 'k', model: 'claude-sonnet-5-5' }, { system: 's', user: 'u', domains: SCORER_DOMAINS });
    expect(a.text).toBe('{"kolo":19,"zapasy":[]}');
    expect(a.seen).toEqual(['https://www.ceskenoviny.cz/zpravy/1', 'https://www.hokej.cz/zapas/2']);
    expect(a.searches).toBe(1);
    expect(a.fetches).toBe(1);
    expect(calls).toHaveLength(2);
    const tools = calls[0]!.body.tools as { type: string; allowed_domains: string[] }[];
    expect(tools.map((t) => t.type)).toEqual(['web_search_20260209', 'web_fetch_20260209']);
    // Cache: opakované čtení nalezených stránek v dalších krocích hledání se platí za zlomek ceny.
    expect(calls[0]!.body.cache_control).toEqual({ type: 'ephemeral' });
    expect(calls[1]!.body.cache_control).toEqual({ type: 'ephemeral' });
    for (const t of tools) expect(t.allowed_domains).toEqual(['ceskenoviny.cz', 'hokej.cz', 'sport.ceskatelevize.cz']);
    const second = calls[1]!.body.messages as { role: string }[];
    expect(second.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('web, který blokuje vyhledávání Claude, se vyřadí a hledá se bez něj', async () => {
    const calls: string[][] = [];
    const f = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { tools: { allowed_domains: string[] }[] };
      calls.push(body.tools[0]!.allowed_domains);
      if (calls.length === 1) {
        return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: "The following domains are not accessible to our user agent: ['idnes.cz']. Read more: https://support.anthropic.com/x" } }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify(message([{ type: 'text', text: '{}' }], 'end_turn')), { headers: { 'content-type': 'application/json' } });
    });
    const logs: string[] = [];
    const a = await askWithSearch({ fetch: f as unknown as typeof fetch, apiKey: 'k', model: 'm' }, { system: 's', user: 'u', domains: ['idnes.cz', 'sport.cz'] }, (l) => logs.push(l));
    expect(a.text).toBe('{}');
    expect(calls).toEqual([['idnes.cz', 'sport.cz'], ['sport.cz']]);
    expect(logs.join(' ')).toContain('idnes.cz');
    expect(blockedDomains(new Error(`400 {"message":"The following domains are not accessible to our user agent: ['a.cz', 'b.com']."}`))).toEqual(['a.cz', 'b.com']);
  });

  it('došlý kredit je srozumitelná chyba, spotřeba tokenů jde do logu', async () => {
    const credit = () => new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } }), { status: 400, headers: { 'content-type': 'application/json' } });
    const f = vi.fn(async () => credit()) as unknown as typeof fetch;
    await expect(askClaude({ fetch: f, apiKey: 'k', model: 'm' }, 's', 'u')).rejects.toThrow('Došel kredit Claude API');
    await expect(askWithSearch({ fetch: f, apiKey: 'k', model: 'm' }, { system: 's', user: 'u', domains: ['sport.cz'] })).rejects.toThrow('Došel kredit Claude API');
    expect(apiError(new Error('boom')).message).toBe('boom');

    const { f: ok, calls } = fakeApi([message([{ type: 'text', text: '{}' }], 'end_turn', { input_tokens: 12345, output_tokens: 678, server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } })]);
    const logs: string[] = [];
    const before = spend.usd;
    await askClaude({ fetch: ok, apiKey: 'k', model: 'm' }, 's', 'u', (l) => logs.push(l));
    // 12 345 × $2 + 678 × $10 za milion tokenů = $0.031
    expect(logs[0]).toContain('Tokeny: vstup 12 tis., výstup 678. Cena $0.031 (asi 0,7 Kč).');
    expect(spend.usd - before).toBeCloseTo(0.03147, 5);
    // Jednorázový text bez cache (zápis do cache by se jen připlatil).
    expect(calls[0]!.body.cache_control).toBeUndefined();
  });

  it('cena: vstup, zápis a čtení cache, výstup a hledání; neznámý model nemá cenu', () => {
    const u = { input_tokens: 1000, cache_creation_input_tokens: 2000, cache_read_input_tokens: 100000, output_tokens: 5000, server_tool_use: { web_search_requests: 3, web_fetch_requests: 4 } };
    // 1000×2 + 2000×2.5 + 100000×0.1 + 5000×10 = 67 000 → $0.067, k tomu 3 hledání po $0.01
    expect(costUsd('claude-sonnet-5-5', u as never)).toBeCloseTo(0.097, 6);
    expect(costUsd('neznamy-model', u as never)).toBeNull();
    expect(usdText(0.5)).toBe('$0.500 (asi 11,0 Kč)');
  });

  it('domény a porovnání adres', () => {
    expect(onDomains('https://www.ceskenoviny.cz/zpravy/1', SCORER_DOMAINS)).toBe(true);
    expect(onDomains('https://sport.ceskatelevize.cz/clanek', SCORER_DOMAINS)).toBe(true);
    expect(onDomains('https://www.ceskatelevize.cz/porady', SCORER_DOMAINS)).toBe(false);
    expect(onDomains('https://ceskenoviny.cz.evil.com/x', SCORER_DOMAINS)).toBe(false);
    expect(normalizeUrl('http://www.hokej.cz/zapas/2/#top')).toBe(normalizeUrl('https://hokej.cz/zapas/2'));
  });
});
