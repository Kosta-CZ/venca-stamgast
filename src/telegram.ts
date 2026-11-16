// Telegram: ranní zpráva ke schválení (obrázek, popisek, tlačítka ✅ Vydat / 🗑 Zahodit)
// a hlášení výsledku vydání. Tlačítka zachytí Worker (worker/src/index.ts) a spustí vydat.yml.
// Token bota se nikdy nevypisuje: chyby ho maskují.

import type { Draft } from './draft.ts';

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

/** Hlavička zprávy: druh, den, muž noci a výraz. */
export function approvalHeader(d: Pick<Draft, 'dayLabel' | 'facts' | 'venca'>): string {
  return `🍺 <b>Ranní pivo · ${tgEscape(d.dayLabel)}</b>\n<i>Muž noci: ${tgEscape(d.facts.hero.jmeno)} · výraz ${tgEscape(d.venca.vyraz)}</i>`;
}

/** Celý text ke schválení: hlavička, popisek na Instagram a co zkontrolovat. */
export function approvalText(d: Pick<Draft, 'dayLabel' | 'facts' | 'venca' | 'caption' | 'pozor'>): string {
  const check = d.pozor.length
    ? `⚠️ <b>Ke kontrole</b>\n${d.pozor.map((p) => `• ${tgEscape(p)}`).join('\n')}`
    : '✅ Kontrola čísel prošla.';
  return `${approvalHeader(d)}\n\n${tgEscape(d.caption)}\n\n${check}`;
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
