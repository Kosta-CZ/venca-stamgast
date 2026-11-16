// Telegram: ranní zpráva ke schválení (obrázek, popisek, tlačítka ✅ Vydat / 🗑 Zahodit)
// a hlášení výsledku vydání. Tlačítka zachytí Worker (worker/src/index.ts) a spustí vydat.yml.
// Token bota se nikdy nevypisuje: chyby ho maskují.

import type { Draft } from './draft.ts';
import { DIGEST_EMOJI } from './digest.ts';
import { leagueOf } from './leagues.ts';

export const TG_API = 'https://api.telegram.org';

/** Limit popisku u fotky v Telegramu; delší text jde do samostatné zprávy. */
export const PHOTO_CAPTION_MAX = 1024;

export interface TgIo {
  fetch: typeof fetch;
  token: string;
}

export function tgEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function tgCall<T = unknown>(io: TgIo, method: string, body: Record<string, unknown>): Promise<T> {
  const safe = (t: string) => t.split(io.token).join('***');
  let res: Response;
  try {
    res = await io.fetch(`${TG_API}/bot${io.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(safe(`Telegram neodpověděl: ${e instanceof Error ? e.message : String(e)}`));
  }
  const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
  if (!res.ok || !json?.ok) throw new Error(safe(`Telegram odmítl ${method}: ${json?.description ?? `stav ${res.status}`}`));
  return json.result as T;
}

/** Tlačítka pod konceptem. Data tlačítka čte Worker (`vydat:<id>`, `zahodit:<id>`), limit Telegramu je 64 bajtů. */
export function approvalKeyboard(id: string): { inline_keyboard: { text: string; callback_data: string }[][] } {
  return { inline_keyboard: [[{ text: '✅ Vydat', callback_data: `vydat:${id}` }, { text: '🗑 Zahodit', callback_data: `zahodit:${id}` }]] };
}

/** Hodnota atributu v HTML Telegramu (odkaz). */
export const tgAttr = (text: string): string => tgEscape(text).replace(/"/g, '&quot;');

/** Hlavička zprávy: druh, den nebo kolo, muž noci/kola a výraz. */
export function approvalHeader(d: Draft): string {
  if (d.kind === 'kotel') {
    const hero = d.venca.muz_kola ? `muž kola: ${d.venca.muz_kola.name} (${d.venca.muz_kola.team})` : 'bez muže kola';
    const l = leagueOf(d);
    return `${l.emoji} <b>${tgEscape(l.title)} · ${d.facts.round}. kolo</b>\n<i>${tgEscape(d.dayLabel)} · ${tgEscape(hero)} · výraz ${tgEscape(d.venca.vyraz)}</i>`;
  }
  if (d.kind === 'prehled') {
    const f = d.facts;
    return `${DIGEST_EMOJI[f.sport]} <b>${tgEscape(f.nazev)} · ${tgEscape(f.periodLabel)}</b>\n<i>${f.rows.length} ${f.rows.length === 1 ? 'hráč' : f.rows.length < 5 ? 'hráči' : 'hráčů'} · hrdina: ${tgEscape(d.venca.hrdina ?? '–')} · výraz ${tgEscape(d.venca.vyraz)}</i>`;
  }
  if (d.kind === 'special') {
    const f = d.facts;
    const what = d.stage === 'pozvanka' ? 'pozvánka' : `výsledek${f.winner ? `: vítěz ${f.winner}` : ''}`;
    return `🥊 <b>Speciál ${tgEscape(f.stitek)} · ${tgEscape(what)}</b>\n<i>${tgEscape(f.czech.name)} – ${tgEscape(f.opponent.name)} · ${tgEscape(d.dayLabel)} · výraz ${tgEscape(d.venca.vyraz)}</i>`;
  }
  return `🍺 <b>Ranní pivo · ${tgEscape(d.dayLabel)}</b>\n<i>Muž noci: ${tgEscape(d.facts.hero.jmeno)} · výraz ${tgEscape(d.venca.vyraz)}</i>`;
}

/** Zdroje (střelci Kotle, fakta speciálu): odkaz a u Kotle zápasy, které z něj jsou. */
export function sourcesText(sources: readonly { url: string; games: string[] }[], title = 'Zdroje střelců'): string {
  if (!sources.length) return '';
  const short = (url: string) => {
    try {
      const u = new URL(url);
      const path = u.pathname.length > 28 ? `${u.pathname.slice(0, 27)}…` : u.pathname;
      return `${u.hostname.replace(/^www\./, '')}${path === '/' ? '' : path}`;
    } catch {
      return url;
    }
  };
  return `📰 <b>${tgEscape(title)}</b>\n${sources.map((s) => `• <a href="${tgAttr(s.url)}">${tgEscape(short(s.url))}</a>${s.games.length ? `: ${tgEscape(s.games.join(', '))}` : ''}`).join('\n')}`;
}

/** Celý text ke schválení: hlavička, popisek na Instagram, zdroje (Kotel) a co zkontrolovat. */
export function approvalText(d: Draft): string {
  const check = d.pozor.length
    ? `⚠️ <b>Ke kontrole</b>\n${d.pozor.map((p) => `• ${tgEscape(p)}`).join('\n')}`
    : '✅ Kontrola čísel prošla.';
  const sources = d.kind === 'kotel'
    ? sourcesText(d.sources)
    : d.kind === 'special' || d.kind === 'prehled'
      ? sourcesText(d.facts.sources.map((url) => ({ url, games: [] })), 'Zdroje (dvě nezávislá hledání)')
      : '';
  return [approvalHeader(d), tgEscape(d.caption), sources, check].filter(Boolean).join('\n\n');
}

/**
 * Pošle koncept ke schválení. Krátký text jde jako popisek fotky s tlačítky; delší jako fotka
 * s hlavičkou a pod ní samostatná zpráva s celým textem a tlačítky.
 */
export async function sendApproval(io: TgIo, chatId: string, d: Draft): Promise<void> {
  if (!d.imageUrl) throw new Error('Koncept nemá veřejný obrázek, do Telegramu ho nejde poslat.');
  const text = approvalText(d);
  const keyboard = approvalKeyboard(d.id);
  if (text.length <= PHOTO_CAPTION_MAX) {
    await tgCall(io, 'sendPhoto', { chat_id: chatId, photo: d.imageUrl, caption: text, parse_mode: 'HTML', reply_markup: keyboard });
    return;
  }
  await tgCall(io, 'sendPhoto', { chat_id: chatId, photo: d.imageUrl, caption: approvalHeader(d), parse_mode: 'HTML' });
  await tgCall(io, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_markup: keyboard, link_preview_options: { is_disabled: true } });
}

/** Krátká zpráva (volitelně jako odpověď na zprávu s konceptem, volitelně s tlačítky). */
export async function sendNote(io: TgIo, chatId: string, html: string, opts: { replyTo?: string; keyboardFor?: string } = {}): Promise<void> {
  await tgCall(io, 'sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(opts.replyTo ? { reply_parameters: { message_id: Number(opts.replyTo), allow_sending_without_reply: true } } : {}),
    ...(opts.keyboardFor ? { reply_markup: approvalKeyboard(opts.keyboardFor) } : {}),
  });
}

/** Je Telegram nastavený? (token bota a id majitele) */
export function tgFromEnv(env: NodeJS.ProcessEnv = process.env): { token: string; chatId: string } | null {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  return token && chatId ? { token, chatId } : null;
}
