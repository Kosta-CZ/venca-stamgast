// Příkazy úlohy: npm run venca -- <příkaz> [volby]
//
//   make     [--date YYYY-MM-DD] [--demo] [--no-ai]   vyrobí koncept Ranního piva do out/
//   upload   --id ID                                    nahraje koncept do R2 (obrázek + JSON)
//   issue    --id ID [--title]                          vypíše tělo (nebo název) issue ke schválení
//   telegram --id ID                                    pošle koncept ke schválení do Telegramu
//   notify   --text TEXT                                krátká zpráva majiteli do Telegramu
//   publish  --id ID [--dry-run] [--tg-chat C] [--tg-reply M]
//                                                       vydá koncept z R2 na Instagram (a ohlásí to v Telegramu)
//   refresh  --out SOUBOR                               prodlouží token Instagramu
//
// Výstupy pro GitHub Actions jdou do $GITHUB_OUTPUT. Tajné klíče se nikdy nevypisují.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { postFacts } from './facts.ts';
import { fetchNight, nhlDateFor, type CzPlayer, type Night } from './nhl.ts';
import { askClaude, caption, checkVenca, dayLabel, DEFAULT_MODEL, fallbackVenca, parseJsonLoose, userMessage, type VencaOut } from './venca.ts';
import { draftId, issueBody, issueTitle, type Draft } from './draft.ts';
import { ranniPivoHtml, SIZE } from './render/ranniPivo.ts';
import { SAMPLE_DATE, SAMPLE_NIGHT, SAMPLE_VENCA } from './sample.ts';
import { checkImage, publishImage, prepareContainer, refreshToken } from './instagram.ts';
import { putObject, r2FromEnv } from './storage.ts';
import { sendApproval, sendNote, tgEscape, tgFromEnv } from './telegram.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'out');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function output(key: string, value: string): void {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

export function pragueToday(at = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(at);
}

const readDraft = (id: string): Draft => JSON.parse(readFileSync(join(OUT, `${id}.json`), 'utf8')) as Draft;
const writeDraft = (d: Draft) => writeFileSync(join(OUT, `${d.id}.json`), JSON.stringify(d, null, 2));

async function make(): Promise<void> {
  const demo = flag('demo');
  const date = demo ? SAMPLE_DATE : arg('date') ?? pragueToday();
  mkdirSync(OUT, { recursive: true });

  let night: Night;
  if (demo) {
    night = SAMPLE_NIGHT;
  } else {
    const czechs = (JSON.parse(readFileSync(join(ROOT, 'data/czech-nhl.json'), 'utf8')) as { hraci: CzPlayer[] }).hraci;
    night = await fetchNight({ fetch }, nhlDateFor(date), czechs);
  }
  console.log(`Noc na ${dayLabel(date)} (NHL ${night.nhlDate}): ${night.players.length} Čechů, nedohráno ${night.unfinished.length}.`);
  if (night.players.length === 0) {
    console.log('Žádný Čech v noci nehrál: Ranní pivo dnes nebude.');
    output('has_post', 'false');
    return;
  }

  let venca: VencaOut;
  let model: string | null = null;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (demo) {
    venca = checkVenca(SAMPLE_VENCA, night, date);
  } else if (!apiKey || flag('no-ai')) {
    venca = fallbackVenca(night);
  } else {
    model = process.env.VENCA_MODEL || DEFAULT_MODEL;
    const system = readFileSync(join(ROOT, 'prompts/system.md'), 'utf8');
    const text = await askClaude({ fetch, apiKey, model }, system, userMessage(night, date), console.log);
    let raw: unknown;
    try {
      raw = parseJsonLoose(text);
    } catch (e) {
      raw = {};
      console.log(`Venca vrátil nečitelnou odpověď: ${e instanceof Error ? e.message : String(e)}`);
      console.log(`Začátek odpovědi: ${JSON.stringify(text.slice(0, 600))}`);
    }
    venca = checkVenca(raw, night, date);
    if ((raw as { prazdne?: boolean }).prazdne) venca.pozor.push('Venca tvrdí, že nikdo nehrál, ale data říkají něco jiného.');
  }

  const facts = postFacts(night.players, venca.muz_noci ?? undefined);
  if (!facts) throw new Error('Nepodařilo se sestavit fakta příspěvku.');
  const id = draftId(date, 'ranni-pivo');
  const label = dayLabel(date);
  const draft: Draft = {
    id, kind: 'ranni-pivo', date, dayLabel: label,
    caption: caption(venca, facts.hidden), venca, facts, pozor: venca.pozor, model,
    createdAt: new Date().toISOString(),
  };

  const html = ranniPivoHtml({ dayLabel: label, facts, venca });
  writeFileSync(join(OUT, `${id}.html`), html);
  const { htmlToJpeg } = await import('./render/shot.ts');
  await htmlToJpeg(html, SIZE, join(OUT, `${id}.jpg`));
  writeDraft(draft);

  console.log(`Koncept ${id}: muž noci ${facts.hero.jmeno}, výraz ${venca.vyraz}, ke kontrole ${draft.pozor.length}.`);
  for (const p of draft.pozor) console.log(`  ⚠ ${p}`);
  output('has_post', 'true');
  output('id', id);
  output('pozor', String(draft.pozor.length));
}

async function upload(): Promise<void> {
  const id = arg('id');
  if (!id) throw new Error('Chybí --id.');
  const cfg = r2FromEnv();
  const draft = readDraft(id);
  // Obrázek má pokaždé nové jméno: po opakované výrobě téhož dne nedostane Instagram ani Telegram starou kopii z mezipaměti.
  draft.imageUrl = await putObject(cfg, `drafts/${id}-${Date.now().toString(36)}.jpg`, readFileSync(join(OUT, `${id}.jpg`)), 'image/jpeg');
  writeDraft(draft);
  await putObject(cfg, `drafts/${id}.json`, JSON.stringify(draft, null, 2), 'application/json');
  console.log(`Nahráno: ${draft.imageUrl}`);
  output('image_url', draft.imageUrl);
}

function issue(): void {
  const id = arg('id');
  if (!id) throw new Error('Chybí --id.');
  const d = readDraft(id);
  process.stdout.write(flag('title') ? issueTitle(d) : issueBody(d));
}

/** Veřejná adresa v úložišti s obejitím mezipaměti (r2.dev klíč objektu dotazem nemění). */
const fresh = (url: string) => `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;

async function publish(): Promise<void> {
  const id = arg('id');
  if (!id) throw new Error('Chybí --id.');
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) throw new Error('Chybí tajemství IG_ACCESS_TOKEN (postup je v docs/nastaveni.md).');
  const base = (process.env.R2_PUBLIC_URL ?? '').replace(/\/+$/, '');
  if (!base) throw new Error('Chybí R2_PUBLIC_URL.');
  const dry = flag('dry-run');
  const tg = tgFromEnv();
  const tgChat = arg('tg-chat') ?? '';
  const tgReply = arg('tg-reply');
  const tell = async (html: string, keyboardFor?: string) => {
    if (!tg || !tgChat) return;
    await sendNote({ fetch, token: tg.token }, tgChat, html, { replyTo: tgReply, keyboardFor }).catch((e: unknown) => console.log(`Telegram: ${e instanceof Error ? e.message : String(e)}`));
  };

  try {
    // Pojistka proti dvojímu vydání (dvě ťuknutí, opakovaný komentář): značka published/<id>.json v úložišti.
    if (!dry) {
      const mark = await fetch(fresh(`${base}/published/${id}.json`)).catch(() => null);
      if (mark?.ok) {
        const done = (await mark.json().catch(() => ({}))) as { permalink?: string };
        console.log(`Koncept ${id} už vyšel: ${done.permalink ?? ''}`);
        output('permalink', done.permalink ?? '');
        await tell(`ℹ️ Tenhle příspěvek už vyšel${done.permalink ? `: ${tgEscape(done.permalink)}` : '.'}`);
        return;
      }
    }

    const res = await fetch(fresh(`${base}/drafts/${id}.json`));
    if (!res.ok) throw new Error(`Koncept ${id} v úložišti není (stav ${res.status}).`);
    const draft = (await res.json()) as Draft;
    if (!draft.imageUrl) throw new Error('Koncept nemá nahraný obrázek.');
    const io = { fetch, token, userId: process.env.IG_USER_ID || undefined };
    await checkImage(io, draft.imageUrl);
    const post = { url: draft.imageUrl, caption: draft.caption };
    if (dry) {
      await prepareContainer(io, post);
      console.log('Zkouška: Instagram obrázek přijal a zpracoval, nic se nevydalo.');
      await tell('🧪 Zkouška prošla: Instagram obrázek přijal, nic se nevydalo.');
      return;
    }
    const done = await publishImage(io, post);
    const link = done.permalink ?? '';
    console.log(`Vydáno: ${link || done.id}`);
    output('permalink', link);
    // Značka vydání: jen když je k úložišti klíč (v úloze vydat.yml je).
    try {
      await putObject(r2FromEnv(), `published/${id}.json`, JSON.stringify({ id, permalink: link, mediaId: done.id, at: new Date().toISOString() }), 'application/json');
    } catch (e) {
      console.log(`Značku vydání se nepodařilo uložit: ${e instanceof Error ? e.message : String(e)}`);
    }
    await tell(tgReply ? `✅ Vydáno na Instagram${link ? `: ${tgEscape(link)}` : '.'}` : `✅ Vyšlo automaticky (${tgEscape(draft.dayLabel)})${link ? `: ${tgEscape(link)}` : '.'}`);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    await tell(`❌ Vydání se nepovedlo: ${tgEscape(why)}\nKoncept čeká dál, můžeš to zkusit znovu.`, dry ? undefined : id);
    throw e;
  }
}

async function telegram(): Promise<void> {
  const id = arg('id');
  if (!id) throw new Error('Chybí --id.');
  const tg = tgFromEnv();
  if (!tg) throw new Error('Telegram není nastavený (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID).');
  await sendApproval({ fetch, token: tg.token }, tg.chatId, readDraft(id));
  console.log('Koncept je v Telegramu ke schválení.');
}

async function notify(): Promise<void> {
  const text = arg('text');
  if (!text) throw new Error('Chybí --text.');
  const tg = tgFromEnv();
  if (!tg) {
    console.log('Telegram není nastavený, zpráva se neposílá.');
    return;
  }
  await sendNote({ fetch, token: tg.token }, tg.chatId, tgEscape(text));
}

async function refresh(): Promise<void> {
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) throw new Error('Chybí IG_ACCESS_TOKEN.');
  const r = await refreshToken({ fetch, token });
  const file = arg('out');
  if (r.changed && file) writeFileSync(file, r.token);
  output('changed', String(r.changed));
  output('days', r.days === null ? '' : String(r.days));
  console.log(`Token ${r.changed ? 'je nový' : 'zůstává'}, platí ještě ${r.days ?? '∞'} dní.`);
}

const commands: Record<string, () => Promise<void> | void> = { make, upload, issue, telegram, notify, publish, refresh };

const cmd = process.argv[2] ?? '';
const run = commands[cmd];
if (!run) {
  console.error(`Neznámý příkaz „${cmd}“. Příkazy: ${Object.keys(commands).join(', ')}.`);
  process.exit(2);
}
Promise.resolve(run()).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
