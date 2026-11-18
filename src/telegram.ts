// Telegram: ranní zpráva ke schválení (obrázek, popisek, tlačítka ✅ Vydat / 🗑 Zahodit)
// a hlášení výsledku vydání. Tlačítka zachytí Worker (worker/src/index.ts) a spustí vydat.yml.
// Token bota se nikdy nevypisuje: chyby ho maskují.

import { KC_PER_USD } from './claude.ts';
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

async function tgSend<T>(io: TgIo, method: string, init: RequestInit): Promise<T> {
  const safe = (t: string) => t.split(io.token).join('***');
  let res: Response;
  try {
    res = await io.fetch(`${TG_API}/bot${io.token}/${method}`, { method: 'POST', ...init });
  } catch (e) {
    throw new Error(safe(`Telegram neodpověděl: ${e instanceof Error ? e.message : String(e)}`));
  }
  const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
  if (!res.ok || !json?.ok) throw new Error(safe(`Telegram odmítl ${method}: ${json?.description ?? `stav ${res.status}`}`));
  return json.result as T;
}

export const tgCall = <T = unknown>(io: TgIo, method: string, body: Record<string, unknown>): Promise<T> =>
  tgSend<T>(io, method, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/**
 * Volání s nahráním souboru (multipart): obrázek jde přímo z běhu úlohy. Telegram si ho pak nemusí
 * stahovat z veřejné adresy R2 (r2.dev je omezená a 18. 11. ráno ji Telegram nestáhl).
 */
export function tgUpload<T = unknown>(io: TgIo, method: string, fields: Record<string, unknown>, file: { field: string; name: string; data: Uint8Array; type: string }): Promise<T> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  form.append(file.field, new Blob([file.data.slice()], { type: file.type }), file.name);
  return tgSend<T>(io, method, { body: form });
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
  const cost = d.costUsd !== undefined ? `💰 Claude API: asi ${(d.costUsd * KC_PER_USD).toFixed(1).replace('.', ',')} Kč` : '';
  return [approvalHeader(d), tgEscape(d.caption), sources, check, cost].filter(Boolean).join('\n\n');
}

/**
 * Pošle koncept ke schválení. Krátký text jde jako popisek fotky s tlačítky; delší jako fotka
 * s hlavičkou a pod ní samostatná zpráva s celým textem a tlačítky.
 *
 * Fotka jde přednostně jako soubor z běhu (`photo`), jinak z veřejné adresy R2. Když si ji Telegram
 * z adresy nestáhne, přijde koncept aspoň jako text s tlačítky a odkazem na obrázek: schválit jde i tak.
 */
export async function sendApproval(io: TgIo, chatId: string, d: Draft, photo?: Uint8Array): Promise<void> {
  if (!photo && !d.imageUrl) throw new Error('Koncept nemá obrázek (soubor ani veřejnou adresu), do Telegramu ho nejde poslat.');
  const text = approvalText(d);
  const keyboard = approvalKeyboard(d.id);
  const short = text.length <= PHOTO_CAPTION_MAX;
  const fields = short
    ? { chat_id: chatId, caption: text, parse_mode: 'HTML', reply_markup: keyboard }
    : { chat_id: chatId, caption: approvalHeader(d), parse_mode: 'HTML' };
  try {
    if (photo) await tgUpload(io, 'sendPhoto', fields, { field: 'photo', name: `${d.id}.jpg`, data: photo, type: 'image/jpeg' });
    else await tgCall(io, 'sendPhoto', { ...fields, photo: d.imageUrl });
  } catch (e) {
    if (photo || !d.imageUrl) throw e;
    console.log(`Fotku z adresy Telegram nevzal (${e instanceof Error ? e.message : String(e)}), posílám koncept jako text.`);
    await tgCall(io, 'sendMessage', { chat_id: chatId, text: `${text}\n\n🖼 <a href="${tgAttr(d.imageUrl)}">Obrázek konceptu</a>`, parse_mode: 'HTML', reply_markup: keyboard });
    return;
  }
  if (!short) await tgCall(io, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_markup: keyboard, link_preview_options: { is_disabled: true } });
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
