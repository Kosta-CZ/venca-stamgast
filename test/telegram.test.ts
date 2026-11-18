import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { approvalKeyboard, approvalText, PHOTO_CAPTION_MAX, sendApproval, tgCall, tgEscape } from '../src/telegram.ts';
import { postFacts } from '../src/facts.ts';
import { caption } from '../src/venca.ts';
import { draftIdFromIssue, issueBody, issueTitle, type Draft } from '../src/draft.ts';
import { SAMPLE_DATE, SAMPLE_NIGHT, SAMPLE_VENCA } from '../src/sample.ts';
import { SAMPLE_KOTEL } from '../src/kotelSample.ts';
import worker, { dispatchPublish, handleUpdate, parseCallback, webhookSecret, type Env } from '../worker/src/index.ts';

const facts = postFacts(SAMPLE_NIGHT.players, '1')!;
const draft: Draft = {
  id: '2026-11-09-ranni-pivo', kind: 'ranni-pivo', date: SAMPLE_DATE, dayLabel: 'pondělí 9. 11.',
  caption: caption(SAMPLE_VENCA), venca: SAMPLE_VENCA, facts, pozor: ['Rozpor <v> datech & tak'], model: null, createdAt: '',
  imageUrl: 'https://pub-x.r2.dev/drafts/2026-11-09-ranni-pivo-abc.jpg',
};

/** Falešný fetch: zapisuje volání a vrací úspěch. */
function fakeFetch(status = 200, body: unknown = { ok: true, result: {} }) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} });
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  });
  return { f: f as unknown as typeof fetch, calls };
}

afterEach(() => vi.unstubAllGlobals());

describe('Telegram: zpráva ke schválení', () => {
  it('escapuje HTML a ukáže, co zkontrolovat', () => {
    const t = approvalText(draft);
    expect(t).toContain('Ranní pivo · pondělí 9. 11.');
    expect(t).toContain('Muž noci: Tomáš Hertl');
    expect(t).toContain('Rozpor &lt;v&gt; datech &amp; tak');
    expect(tgEscape('<b>')).toBe('&lt;b&gt;');
  });

  it('bez výhrad píše, že kontrola prošla', () => {
    expect(approvalText({ ...draft, pozor: [] })).toContain('Kontrola čísel prošla');
  });

  it('ukáže, kolik výroba stála za Claude API (jen když se AI volala)', () => {
    expect(approvalText({ ...draft, costUsd: 0.4123 })).toContain('💰 Claude API: asi 9,1 Kč');
    expect(approvalText(draft)).not.toContain('Claude API');
  });

  it('data tlačítek se vejdou do limitu Telegramu a Worker jim rozumí', () => {
    const kb = approvalKeyboard(draft.id).inline_keyboard[0]!;
    for (const b of kb) {
      expect(new TextEncoder().encode(b.callback_data).length).toBeLessThanOrEqual(64);
      expect(parseCallback(b.callback_data)?.id).toBe(draft.id);
    }
  });

  it('krátký text jde jako popisek fotky s tlačítky', async () => {
    const { f, calls } = fakeFetch();
    await sendApproval({ fetch: f, token: 'T0K' }, '42', draft);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/sendPhoto');
    expect(calls[0]!.body.photo).toBe(draft.imageUrl);
    expect(calls[0]!.body.reply_markup).toBeTruthy();
  });

  it('obrázek z běhu jde jako soubor (Telegram si nic nestahuje z r2.dev)', async () => {
    const sent: { url: string; form: FormData }[] = [];
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(url), form: init!.body as FormData });
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    }) as unknown as typeof fetch;
    await sendApproval({ fetch: f, token: 'T0K' }, '42', draft, new Uint8Array([0xff, 0xd8, 0xff]));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toContain('/sendPhoto');
    const photo = sent[0]!.form.get('photo') as File;
    expect(photo.name).toBe(`${draft.id}.jpg`);
    expect(photo.type).toBe('image/jpeg');
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
    expect(sent[0]!.form.get('chat_id')).toBe('42');
    expect(JSON.parse(String(sent[0]!.form.get('reply_markup')))).toEqual(approvalKeyboard(draft.id));
  });

  it('když si Telegram fotku z adresy nestáhne, přijde koncept jako text s tlačítky a odkazem', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      const photoFails = String(url).endsWith('/sendPhoto');
      return new Response(JSON.stringify(photoFails ? { ok: false, description: 'Bad Request: failed to get HTTP URL content' } : { ok: true, result: {} }), { status: photoFails ? 400 : 200 });
    }) as unknown as typeof fetch;
    await sendApproval({ fetch: f, token: 'T0K' }, '42', draft);
    expect(calls.map((c) => c.url.split('/').pop())).toEqual(['sendPhoto', 'sendMessage']);
    expect(calls[1]!.body.reply_markup).toEqual(approvalKeyboard(draft.id));
    expect(String(calls[1]!.body.text)).toContain(`<a href="${draft.imageUrl}">Obrázek konceptu</a>`);
  });

  it('dlouhý text jde do druhé zprávy s tlačítky', async () => {
    const { f, calls } = fakeFetch();
    await sendApproval({ fetch: f, token: 'T0K' }, '42', { ...draft, caption: 'x'.repeat(PHOTO_CAPTION_MAX) });
    expect(calls.map((c) => c.url.split('/').pop())).toEqual(['sendPhoto', 'sendMessage']);
    expect(calls[0]!.body.reply_markup).toBeUndefined();
    expect(calls[1]!.body.reply_markup).toBeTruthy();
  });

  it('Kotel: kolo, muž kola, zdroje střelců jako odkazy a co zkontrolovat', () => {
    const kotel: Draft = {
      id: '2026-11-15-kotel', kind: 'kotel', season: '2026-2027', date: '2026-11-15', dayLabel: 'neděle 15. 11.',
      caption: 'Popisek', venca: { muz_kola: { name: 'Daňo', team: 'Třinec' }, titulek: 'T', hlaska: 'H', popisek: 'Popisek', hashtagy: [], vyraz: 'rikal', pozor: [] },
      facts: SAMPLE_KOTEL, sources: [{ url: 'https://www.ceskenoviny.cz/zpravy/2700000?a=1&b="2"', games: ['Kladno – Třinec'] }],
      pozor: ['Odkaz <x>'], model: null, createdAt: '', imageUrl: 'https://pub-x.r2.dev/drafts/k.jpg',
    };
    const t = approvalText(kotel);
    expect(t).toContain('Extraligový kotel · 19. kolo');
    expect(t).toContain('muž kola: Daňo (Třinec)');
    expect(t).toContain('<a href="https://www.ceskenoviny.cz/zpravy/2700000?a=1&amp;b=&quot;2&quot;">ceskenoviny.cz/zpravy/2700000</a>: Kladno – Třinec');
    expect(t).toContain('Odkaz &lt;x&gt;');
    expect(issueTitle(kotel)).toBe('Ke schválení: Extraligový kotel 19. kolo');
    expect(draftIdFromIssue(issueBody(kotel))).toBe('2026-11-15-kotel');
    for (const b of approvalKeyboard(kotel.id).inline_keyboard[0]!) expect(parseCallback(b.callback_data)?.id).toBe('2026-11-15-kotel');
  });

  it('chyba Telegramu neprozradí token', async () => {
    const f = (async () => new Response(JSON.stringify({ ok: false, description: 'bad token SECRET123' }), { status: 401 })) as unknown as typeof fetch;
    await expect(tgCall({ fetch: f, token: 'SECRET123' }, 'getMe', {})).rejects.toThrow(/\*\*\*/);
  });
});

describe('Worker bota', () => {
  const env: Env = { TELEGRAM_BOT_TOKEN: 'bot:TOKEN', TELEGRAM_CHAT_ID: '42', BOT_GITHUB_TOKEN: 'ghp_x', GITHUB_REPO: 'Kosta-CZ/venca-stamgast' };
  const msg = { message_id: 7, chat: { id: 42 } };

  it('tajemství webhooku je stejné jako v úloze bot.yml (sha256sum)', async () => {
    const expected = createHash('sha256').update('venca-webhook:bot:TOKEN').digest('hex');
    expect(await webhookSecret('bot:TOKEN')).toBe(expected);
  });

  it('cizí tlačítka a neplatná data odmítne', () => {
    expect(parseCallback('vydat:2026-11-17-ranni-pivo')).toEqual({ action: 'vydat', id: '2026-11-17-ranni-pivo' });
    expect(parseCallback('vydat:../../etc')).toBeNull();
    expect(parseCallback('smazat:2026-11-17-ranni-pivo')).toBeNull();
  });

  it('bez správné hlavičky Telegramu nic neudělá', async () => {
    const { f, calls } = fakeFetch();
    vi.stubGlobal('fetch', f);
    const res = await worker.fetch(new Request('https://venca-bot.x.workers.dev/telegram', { method: 'POST', body: '{}' }), env, { waitUntil: () => {} });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('cizí člověk tlačítkem nic nevydá', async () => {
    const { f, calls } = fakeFetch();
    vi.stubGlobal('fetch', f);
    await handleUpdate({ callback_query: { id: 'q', from: { id: 999 }, data: 'vydat:2026-11-17-ranni-pivo', message: msg } }, env);
    expect(calls.some((c) => c.url.includes('api.github.com'))).toBe(false);
    expect(calls[0]!.url).toContain('answerCallbackQuery');
  });

  it('✅ Vydat od majitele: nejdřív zmizí tlačítka, pak se spustí vydání s odkazem na zprávu', async () => {
    const { f, calls } = fakeFetch(204);
    vi.stubGlobal('fetch', f);
    await handleUpdate({ callback_query: { id: 'q', from: { id: 42 }, data: 'vydat:2026-11-17-ranni-pivo', message: msg } }, env);
    const order = calls.map((c) => (c.url.includes('api.github.com') ? 'github' : c.url.split('/').pop()));
    expect(order[0]).toBe('editMessageReplyMarkup');
    expect(order).toContain('github');
    const gh = calls.find((c) => c.url.includes('api.github.com'))!;
    expect(gh.url).toContain('/repos/Kosta-CZ/venca-stamgast/actions/workflows/vydat.yml/dispatches');
    expect(gh.body).toEqual({ ref: 'main', inputs: { id: '2026-11-17-ranni-pivo', dry_run: false, tg_chat: '42', tg_message: '7' } });
  });

  it('🗑 Zahodit od majitele nic nevydává', async () => {
    const { f, calls } = fakeFetch();
    vi.stubGlobal('fetch', f);
    await handleUpdate({ callback_query: { id: 'q', from: { id: 42 }, data: 'zahodit:2026-11-17-ranni-pivo', message: msg } }, env);
    expect(calls.some((c) => c.url.includes('api.github.com'))).toBe(false);
    expect(calls.some((c) => (c.body.text as string | undefined)?.includes('Zahozeno'))).toBe(true);
  });

  it('když GitHub vydání odmítne, tlačítka se vrátí', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${String(url).split('/').pop()} ${init?.body ?? ''}`);
      return new Response('{}', { status: String(url).includes('api.github.com') ? 401 : 200 });
    }));
    await handleUpdate({ callback_query: { id: 'q', from: { id: 42 }, data: 'vydat:2026-11-17-ranni-pivo', message: msg } }, env);
    const restores = calls.filter((c) => c.startsWith('editMessageReplyMarkup') && c.includes('vydat:2026-11-17-ranni-pivo'));
    expect(restores).toHaveLength(1);
  });

  it('dispatch vrací stav GitHubu', async () => {
    vi.stubGlobal('fetch', fakeFetch(204).f);
    expect(await dispatchPublish(env, '2026-11-17-ranni-pivo', 42, 7)).toEqual({ ok: true, status: 204 });
  });
});
