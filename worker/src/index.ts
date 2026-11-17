// Telegram bot Vency (Cloudflare Worker „venca-bot“). Zachytí ťuknutí na tlačítka pod ranním
// konceptem: ✅ Vydat spustí v GitHubu úlohu vydat.yml (ta příspěvek vydá a ohlásí výsledek),
// 🗑 Zahodit jen uklidí tlačítka. Poslouchá jen majitele (TELEGRAM_CHAT_ID) a jen zprávy,
// které opravdu poslal Telegram (tajná hlavička webhooku, odvozená z tokenu bota).
//
// Je to i plánovač: podle rozvrhu PLAN spouští úlohy v GitHubu (Ranní pivo, Kotel, 1. liga, přehledy,
// speciály). Plánované běhy GitHubu (on: schedule) se v tomto repozitáři nespouštěly vůbec (17. 11. 2026
// ráno nic), Cloudflare Cron Trigger je spolehlivý a zdarma.
//
// Nasazuje ho úloha .github/workflows/bot.yml, ta mu nahraje i tajné údaje a nastaví webhook.

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  /** Telegram id majitele: jen on smí schvalovat. */
  TELEGRAM_CHAT_ID: string;
  /** Token GitHubu s právem Actions (jen tento repozitář): spouští vydat.yml. */
  BOT_GITHUB_TOKEN: string;
  /** Repozitář ve tvaru vlastník/název. */
  GITHUB_REPO: string;
}

interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}

interface TgUser {
  id: number;
}
interface TgMessage {
  message_id: number;
  chat: { id: number };
  from?: TgUser;
  text?: string;
}
interface TgUpdate {
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage };
}

const TG_API = 'https://api.telegram.org';

/** Tajemství webhooku: SHA-256 z tokenu bota. Stejně ho spočítá úloha bot.yml při nastavení webhooku. */
export async function webhookSecret(token: string): Promise<string> {
  const data = new TextEncoder().encode(`venca-webhook:${token}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Data tlačítka: `vydat:<id>` nebo `zahodit:<id>` (id konceptu jako 2026-11-17-ranni-pivo). */
export function parseCallback(data: string): { action: 'vydat' | 'zahodit'; id: string } | null {
  const m = /^(vydat|zahodit):([0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z-]+)$/.exec(data);
  return m ? { action: m[1] as 'vydat' | 'zahodit', id: m[2] as string } : null;
}

export const keyboard = (id: string) => ({ inline_keyboard: [[{ text: '✅ Vydat', callback_data: `vydat:${id}` }, { text: '🗑 Zahodit', callback_data: `zahodit:${id}` }]] });

async function tg(env: Env, method: string, body: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(`${TG_API}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.log(`Telegram ${method}: stav ${res.status}`);
  return res.ok;
}

const reply = (env: Env, msg: TgMessage, text: string, extra: Record<string, unknown> = {}) =>
  tg(env, 'sendMessage', { chat_id: msg.chat.id, text, reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true }, ...extra });

/** Spustí v GitHubu úlohu (workflow_dispatch) na větvi main se vstupy. */
export async function dispatchWorkflow(env: Env, workflow: string, inputs: Record<string, string | boolean>): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.BOT_GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'venca-bot',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main', inputs }),
  });
  return { ok: res.status === 204 || res.ok, status: res.status };
}

/** Spustí v GitHubu vydání konceptu; úloha pak sama odpoví do Telegramu. */
export const dispatchPublish = (env: Env, id: string, chatId: number, messageId: number) =>
  dispatchWorkflow(env, 'vydat.yml', { id, dry_run: false, tg_chat: String(chatId), tg_message: String(messageId) });

// ---- Rozvrh ----

export interface PlanEntry {
  /** Kdy (cron v UTC: minuta hodina den měsíc den_v_týdnu; čísla, čárky, rozsahy a *). */
  cron: string;
  workflow: string;
  /** Další vstupy úlohy; `plan` (= cron) se přidá vždy, podle něj úloha pozná plánovaný běh. */
  inputs?: Record<string, string>;
  /** Pro lidi: co a kdy našeho času (v zimě UTC+1). */
  note: string;
}

/**
 * Rozvrh úloh. Minuty musí být v `triggers.crons` ve worker/wrangler.jsonc (bot se budí jen v těch
 * minutách). Nová akce (speciál) = nový řádek tady; v létě se čas našeho času posune o hodinu.
 */
export const PLAN: PlanEntry[] = [
  { cron: '10 6 * * *', workflow: 'ranni-pivo.yml', note: 'Ranní pivo denně 7:10' },
  { cron: '41 6 * * 6', workflow: 'kotel.yml', note: 'Extraligový kotel sobota 7:41' },
  { cron: '41 9 * * 6', workflow: 'kotel.yml', note: 'Kotel záloha sobota 10:41' },
  { cron: '53 6 * * 1', workflow: 'fotbal.yml', note: '1. liga pondělí 7:53' },
  { cron: '53 6 * * 2', workflow: 'fotbal.yml', note: '1. liga záloha úterý 7:53' },
  { cron: '23 10 * * 1', workflow: 'prehledy.yml', inputs: { prehled: 'cizina' }, note: 'Češi v cizině pondělí 11:23' },
  // Procházka v UFC, sobota 21. 11. 2026 (hlavní karta 19:00 našeho času).
  { cron: '23 12 21 11 *', workflow: 'specialy.yml', inputs: { stage: 'pozvanka' }, note: 'Procházka pozvánka 13:23' },
  { cron: '23 22 21 11 *', workflow: 'specialy.yml', inputs: { stage: 'vysledek' }, note: 'Procházka výsledek 23:23' },
  { cron: '53 23 21 11 *', workflow: 'specialy.yml', inputs: { stage: 'vysledek' }, note: 'Procházka výsledek záloha 0:53' },
];

/** Sedí hodnota na pole cronu („*“, „5“, „1,3“, „1-5“, „*\/10“)? */
function fieldMatches(field: string, value: number): boolean {
  return field.split(',').some((part) => {
    const [range, stepText] = part.split('/');
    const step = stepText ? Number(stepText) : 1;
    let lo: number;
    let hi: number;
    if (range === '*') {
      lo = 0;
      hi = 59;
    } else if (range!.includes('-')) {
      [lo, hi] = range!.split('-').map(Number) as [number, number];
    } else {
      lo = hi = Number(range);
    }
    return value >= lo && value <= hi && (value - lo) % step === 0;
  });
}

/** Odpovídá čas (UTC) cronu? Den v měsíci i v týdnu se kontrolují oba (rozvrh nikdy neomezuje oba zároveň). */
export function cronMatches(cron: string, at: Date): boolean {
  const [min, hour, dom, month, dow] = cron.trim().split(/\s+/);
  if (!min || !hour || !dom || !month || !dow) return false;
  return fieldMatches(min, at.getUTCMinutes()) && fieldMatches(hour, at.getUTCHours()) && fieldMatches(dom, at.getUTCDate())
    && fieldMatches(month, at.getUTCMonth() + 1) && fieldMatches(dow, at.getUTCDay());
}

/** Co se má spustit v danou minutu. */
export const dueAt = (at: Date): PlanEntry[] => PLAN.filter((p) => cronMatches(p.cron, at));

/** Plánované spuštění: úlohy z rozvrhu; když GitHub úlohu nespustí, dá bot vědět majiteli. */
export async function runPlan(at: Date, env: Env): Promise<string[]> {
  const done: string[] = [];
  for (const p of dueAt(at)) {
    const r = await dispatchWorkflow(env, p.workflow, { ...p.inputs, plan: p.cron });
    console.log(`Plán ${p.note}: ${p.workflow} ${r.ok ? 'spuštěno' : `GitHub ${r.status}`}`);
    if (r.ok) done.push(p.workflow);
    else await tg(env, 'sendMessage', { chat_id: env.TELEGRAM_CHAT_ID, text: `❌ ${p.note}: úlohu ${p.workflow} se nepodařilo spustit (GitHub odpověděl ${r.status}). Zkontroluj BOT_GITHUB_TOKEN.` });
  }
  return done;
}

export async function handleUpdate(update: TgUpdate, env: Env): Promise<void> {
  const owner = String(env.TELEGRAM_CHAT_ID);

  if (update.message) {
    const m = update.message;
    const from = String(m.from?.id ?? '');
    if (from !== owner) {
      if ((m.text ?? '').startsWith('/start')) {
        await tg(env, 'sendMessage', { chat_id: m.chat.id, text: `Ahoj, tohle je soukromý bot Vency Štamgasta. Tvoje Telegram ID je ${from}.` });
      }
      return;
    }
    await tg(env, 'sendMessage', {
      chat_id: m.chat.id,
      text: 'Jsem tady. Každé ráno ti pošlu Ranní pivo ke schválení: ✅ Vydat, nebo 🗑 Zahodit.',
    });
    return;
  }

  const q = update.callback_query;
  if (!q) return;
  if (String(q.from.id) !== owner) {
    await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Tohle smí jen majitel.' });
    return;
  }
  const cb = parseCallback(q.data ?? '');
  const msg = q.message;
  if (!cb || !msg) {
    await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Tohle tlačítko neznám.' });
    return;
  }

  // Tlačítka pryč hned: druhé ťuknutí už nic nespustí.
  await tg(env, 'editMessageReplyMarkup', { chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } });

  if (cb.action === 'zahodit') {
    await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Zahozeno' });
    await reply(env, msg, '🗑 Zahozeno, na Instagram nic nejde.');
    return;
  }

  const r = await dispatchPublish(env, cb.id, msg.chat.id, msg.message_id);
  if (r.ok) {
    await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Vydávám…' });
    await reply(env, msg, '⏳ Vydávám na Instagram, za chvilku pošlu odkaz.');
  } else {
    await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Vydání se nepodařilo spustit.' });
    await tg(env, 'editMessageReplyMarkup', { chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: keyboard(cb.id) });
    await reply(env, msg, `❌ Vydání se nepodařilo spustit (GitHub odpověděl ${r.status}). Zkontroluj BOT_GITHUB_TOKEN a zkus to znovu.`);
  }
}

export default {
  /** Cloudflare Cron Trigger (worker/wrangler.jsonc): v plánovanou minutu spustí úlohy z rozvrhu. */
  async scheduled(event: { scheduledTime: number; cron: string }, env: Env, ctx: Ctx): Promise<void> {
    ctx.waitUntil(runPlan(new Date(event.scheduledTime), env).catch((e: unknown) => console.log(`Chyba plánu: ${e instanceof Error ? e.message : String(e)}`)));
  },

  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/') return new Response('Venca bot běží.');
    if (req.method !== 'POST' || url.pathname !== '/telegram') return new Response('Nenalezeno', { status: 404 });
    if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== (await webhookSecret(env.TELEGRAM_BOT_TOKEN))) {
      return new Response('Zakázáno', { status: 403 });
    }
    const update = (await req.json().catch(() => null)) as TgUpdate | null;
    // Telegramu se odpoví hned, práce doběhne na pozadí (pár volání, pár vteřin).
    if (update) ctx.waitUntil(handleUpdate(update, env).catch((e: unknown) => console.log(`Chyba bota: ${e instanceof Error ? e.message : String(e)}`)));
    return new Response('ok');
  },
};
