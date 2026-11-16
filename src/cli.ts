// Příkazy úlohy: npm run venca -- <příkaz> [volby]
//
//   make     [--date YYYY-MM-DD] [--demo] [--no-ai]   vyrobí koncept Ranního piva do out/
//   kotel    [--round N] [--date YYYY-MM-DD] [--no-ai] [--early] [--skip-existing] [--demo]
//                                                       vyrobí koncept Extraligového kotle (poslední odehrané kolo)
//   special  --stage pozvanka|vysledek [--event SOUBOR] [--date YYYY-MM-DD] [--no-ai] [--skip-existing]
//                                                       speciál k velké akci z data/specialy (fakta ze dvou zdrojů)
//   upload   --id ID                                    nahraje koncept do R2 (obrázek + JSON)
//   issue    --id ID [--title]                          vypíše tělo (nebo název) issue ke schválení
//   telegram --id ID                                    pošle koncept ke schválení do Telegramu
//   notify   --text TEXT                                krátká zpráva majiteli do Telegramu
//   publish  --id ID [--dry-run] [--tg-chat C] [--tg-reply M]
//                                                       vydá koncept z R2 na Instagram (a ohlásí to v Telegramu)
//   refresh  --out SOUBOR                               prodlouží token Instagramu
//
// Výstupy pro GitHub Actions jdou do $GITHUB_OUTPUT. Tajné klíče se nikdy nevypisují.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { postFacts } from './facts.ts';
import { fetchNight, nhlDateFor, type CzPlayer, type Night } from './nhl.ts';
import { caption, checkVenca, dayLabel, fallbackVenca, parseJsonLoose, userMessage, type VencaOut } from './venca.ts';
import { askClaude, DEFAULT_MODEL, type ClaudeIo } from './claude.ts';
import { draftId, issueBody, issueTitle, type Draft } from './draft.ts';
import { ranniPivoHtml, SIZE } from './render/ranniPivo.ts';
import { SAMPLE_DATE, SAMPLE_NIGHT, SAMPLE_VENCA } from './sample.ts';
import { checkScorers, latestRound, roundView, scoreText, scorersText, tableAsOf, teamNamer, type KotelFacts, type TeamEntry } from './kotel.ts';
import { SAMPLE_KOTEL, SAMPLE_KOTEL_VENCA } from './kotelSample.ts';
import { kotelHtml } from './render/kotel.ts';
import { checkKotelVenca, fallbackKotelVenca, kotelCaption, kotelDisclaimer, kotelUserMessage, type KotelVencaOut } from './kotelVenca.ts';
import { findScorers, type Source } from './scorers.ts';
import { seasonFor, syncRounds, tsdbGetter } from './sportsdb.ts';
import {
  checkSpecialVenca, fallbackSpecialVenca, findInvite, findResult, pickEvent, specialCaption, specialDisclaimer, specialId, specialUserMessage,
  type SpecialEvent, type SpecialFacts, type SpecialVencaOut, type Stage,
} from './special.ts';
import { specialHtml } from './render/special.ts';
import { checkImage, publishImage, prepareContainer, refreshToken } from './instagram.ts';
import { dirStore, putObject, r2FromEnv, r2Store, type Store } from './storage.ts';
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

async function kotelDemo(): Promise<void> {
  const problems = SAMPLE_KOTEL.games.flatMap(checkScorers);
  if (problems.length) console.log(`Ke kontrole:\n${problems.join('\n')}`);
  const html = kotelHtml({ facts: SAMPLE_KOTEL, venca: SAMPLE_KOTEL_VENCA });
  const id = `kotel-${SAMPLE_KOTEL.round}-demo`;
  writeFileSync(join(OUT, `${id}.html`), html);
  const { htmlToJpeg } = await import('./render/shot.ts');
  await htmlToJpeg(html, SIZE, join(OUT, `${id}.jpg`));
  console.log(`Ukázka Kotle: out/${id}.jpg`);
}

/** Úložiště kol: R2, když je nastavené, jinak místní složka out/kola. */
function roundStore(): Store {
  try {
    return r2Store(r2FromEnv());
  } catch {
    console.log('R2 není nastavené: kola ukládám jen do out/kola.');
    return dirStore(join(OUT, 'kola'));
  }
}

// Extraligový kotel: kolo z TheSportsDB (kola uložená v R2), střelci přes Claude API s vyhledáváním
// v českých zdrojích, texty Vency a grafika. Bez --round vezme poslední odehrané kolo.
async function kotel(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  if (flag('demo')) return kotelDemo();

  const today = arg('date') ?? pragueToday();
  const season = arg('season') ?? seasonFor(today);
  const want = arg('round') ? Number(arg('round')) : undefined;
  if (want !== undefined && !(Number.isInteger(want) && want > 0)) throw new Error('--round musí být číslo kola.');
  const teams = teamNamer((JSON.parse(readFileSync(join(ROOT, 'data/extraliga-tymy.json'), 'utf8')) as { tymy: TeamEntry[] }).tymy);
  const store = roundStore();

  const get = tsdbGetter({ fetch, log: console.log, gapMs: Number(process.env.TSDB_GAP_MS) || undefined });
  const rounds = await syncRounds(get, store, season, { today, force: want ? [want] : [], log: console.log });
  if (!rounds.size) throw new Error(`TheSportsDB nemá pro sezónu ${season} žádná kola.`);
  const views = [...rounds.values()].map((r) => roundView(r, teams, today));
  const view = want ? views.find((v) => v.round === want) : latestRound(views, today);
  if (!view) {
    if (want) throw new Error(`Kolo ${want} v datech sezóny ${season} není.`);
    console.log('Zatím se neodehrálo žádné kolo: Kotel nebude.');
    output('has_post', 'false');
    return;
  }
  const id = draftId(view.date, 'kotel');
  output('round', String(view.round));
  console.log(`Kolo ${view.round} (${view.dayLabel}): zápasů ${view.games.length}, bez výsledku ${view.missing.length}.`);

  if (flag('skip-existing') && (await store.get(`drafts/${id}.json`))) {
    console.log(`Koncept ${id} už existuje (nové kolo zatím není), nic nevyrábím.`);
    output('has_post', 'false');
    output('reason', 'exists');
    return;
  }
  if (view.missing.length && flag('early')) {
    console.log(`V datech ještě chybí výsledky: ${view.missing.join(', ')}. Zkusí to záložní běh.`);
    output('has_post', 'false');
    output('reason', 'waiting');
    return;
  }

  const pozor: string[] = [];
  if (view.missing.length) pozor.push(`V datech chybí výsledek: ${view.missing.join(', ')}.`);
  if (view.unknownTeams.length) pozor.push(`Neznámé týmy (doplň je do data/extraliga-tymy.json): ${view.unknownTeams.join(', ')}.`);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.VENCA_MODEL || DEFAULT_MODEL;
  const io: ClaudeIo | null = apiKey && !flag('no-ai') ? { fetch, apiKey, model } : null;

  let games = view.games;
  let sources: Source[] = [];
  if (io) {
    const found = await findScorers(io, { round: view.round, dayLabel: view.dayLabel, season, games }, teams, console.log);
    games = found.games;
    sources = found.sources;
    pozor.push(...found.pozor);
  } else {
    pozor.push('Střelci chybí: bez klíče ANTHROPIC_API_KEY se nehledají.');
  }

  const facts: KotelFacts = { round: view.round, dayLabel: view.dayLabel, games, table: tableAsOf(rounds.values(), view.date, teams) };
  let venca: KotelVencaOut;
  if (io) {
    const system = readFileSync(join(ROOT, 'prompts/system.md'), 'utf8');
    const text = await askClaude(io, system, kotelUserMessage(facts, view.date), console.log);
    let raw: unknown = {};
    try {
      raw = parseJsonLoose(text);
    } catch (e) {
      console.log(`Venca vrátil nečitelnou odpověď: ${e instanceof Error ? e.message : String(e)}`);
      console.log(`Začátek odpovědi: ${JSON.stringify(text.slice(0, 600))}`);
    }
    venca = checkKotelVenca(raw, facts, view.date);
  } else {
    venca = fallbackKotelVenca(facts);
  }
  if (venca.muz_kola) facts.hero = venca.muz_kola;

  const draft: Draft = {
    id, kind: 'kotel', season, date: view.date, dayLabel: view.dayLabel,
    caption: kotelCaption(venca, sources), venca, facts, sources, pozor: [...pozor, ...venca.pozor],
    model: io ? model : null, createdAt: new Date().toISOString(),
  };
  const html = kotelHtml({ facts, venca, disclaimer: kotelDisclaimer(sources) });
  writeFileSync(join(OUT, `${id}.html`), html);
  const { htmlToJpeg } = await import('./render/shot.ts');
  await htmlToJpeg(html, SIZE, join(OUT, `${id}.jpg`));
  writeDraft(draft);

  for (const g of games) console.log(`  ${g.home} – ${g.away} ${scoreText(g) || (g.postponedTo ? `odloženo na ${g.postponedTo}` : 'bez výsledku')}  ${scorersText(g.homeScorers)} | ${scorersText(g.awayScorers)}${g.shootoutWinner ? ` | sn ${g.shootoutWinner}` : ''}`);
  console.log(`Tabulka: ${facts.table.map((r) => `${r.pos}. ${r.team} ${r.points} (${r.games})`).join(', ')}`);
  for (const s of sources) console.log(`  zdroj ${s.url}: ${s.games.join(', ')}`);
  console.log(`Titulek: ${venca.titulek}\nHláška: ${venca.hlaska}\nPopisek: ${venca.popisek}`);
  console.log(`Koncept ${id}: muž kola ${facts.hero ? `${facts.hero.name} (${facts.hero.team})` : '–'}, výraz ${venca.vyraz}, ke kontrole ${draft.pozor.length}.`);
  for (const p of draft.pozor) console.log(`  ⚠ ${p}`);
  output('has_post', 'true');
  output('id', id);
  output('pozor', String(draft.pozor.length));
}

function loadEvents(): { file: string; event: SpecialEvent }[] {
  const dir = join(ROOT, 'data/specialy');
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => ({ file: f.replace(/\.json$/, ''), event: JSON.parse(readFileSync(join(dir, f), 'utf8')) as SpecialEvent }));
}

// Speciál k velké akci (data/specialy/*.json): pozvánka odpoledne, výsledek po zápase. Fakta ze dvou
// nezávislých hledání (A mezinárodní, B české zdroje), každý údaj musí sedět v obou.
async function special(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const stage = arg('stage') as Stage;
  if (stage !== 'pozvanka' && stage !== 'vysledek') throw new Error('--stage musí být pozvanka nebo vysledek.');
  const today = arg('date') ?? pragueToday();
  const events = loadEvents();
  const wanted = arg('event');
  const e = wanted ? events.find((x) => x.file === wanted)?.event : pickEvent(events.map((x) => x.event), stage, today);
  if (!e) {
    if (wanted) throw new Error(`Akce ${wanted} v data/specialy není.`);
    console.log('Dnes žádná velká akce není.');
    output('has_post', 'false');
    return;
  }
  const id = specialId(e, stage);
  const store = roundStore();
  if (flag('skip-existing') && (await store.get(`drafts/${id}.json`))) {
    console.log(`Koncept ${id} už existuje, nic nevyrábím.`);
    output('has_post', 'false');
    output('reason', 'exists');
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.VENCA_MODEL || DEFAULT_MODEL;
  const io: ClaudeIo | null = apiKey && !flag('no-ai') ? { fetch, apiKey, model } : null;
  const pozor: string[] = [];
  let facts: SpecialFacts;

  if (stage === 'pozvanka') {
    if (io) {
      const r = await findInvite(io, e, console.log);
      facts = r.facts;
      pozor.push(...r.pozor);
    } else {
      facts = { stage, akce: e.akce, popis: e.zadani, sport: e.sport, stitek: e.stitek, datum: e.datum, dayLabel: dayLabel(e.datum), czech: { name: e.cech, record: null }, opponent: { name: e.souper, record: null }, rows: [{ label: 'Akce', value: e.akce }], sources: [] };
      pozor.push('Fakta chybí: bez klíče ANTHROPIC_API_KEY se nehledají.');
    }
  } else {
    if (!io) throw new Error('Výsledek bez Claude API dohledat nejde (chybí ANTHROPIC_API_KEY).');
    // Bilance z pozvánky (pokud vyšla), ať je výsledek ve stejné podobě.
    const inviteText = (await store.get(`drafts/${specialId(e, 'pozvanka')}.json`).catch(() => null)) ?? (existsSync(join(OUT, `${specialId(e, 'pozvanka')}.json`)) ? readFileSync(join(OUT, `${specialId(e, 'pozvanka')}.json`), 'utf8') : null);
    const invite = inviteText ? (JSON.parse(inviteText) as { facts?: SpecialFacts }).facts : undefined;
    const r = await findResult(io, e, invite, console.log);
    if ('waiting' in r) {
      console.log(`Výsledek zatím není potvrzený: ${r.waiting}`);
      output('has_post', 'false');
      output('reason', 'waiting');
      output('why', r.waiting.replace(/\n/g, ' '));
      return;
    }
    facts = r.facts;
    pozor.push(...r.pozor);
  }

  let venca: SpecialVencaOut;
  if (io) {
    const system = readFileSync(join(ROOT, 'prompts/system.md'), 'utf8');
    const text = await askClaude(io, system, specialUserMessage(facts), console.log);
    let raw: unknown = {};
    try {
      raw = parseJsonLoose(text);
    } catch (err) {
      console.log(`Venca vrátil nečitelnou odpověď: ${err instanceof Error ? err.message : String(err)}`);
    }
    venca = checkSpecialVenca(raw, facts, e.hashtagy);
  } else {
    venca = fallbackSpecialVenca(facts, e.hashtagy);
  }

  const draft: Draft = {
    id, kind: 'special', stage, date: e.datum, dayLabel: dayLabel(e.datum), caption: specialCaption(venca, facts.sources),
    venca, facts, pozor: [...pozor, ...venca.pozor], model: io ? model : null, createdAt: new Date().toISOString(),
  };
  const html = specialHtml({ facts, venca, disclaimer: specialDisclaimer(facts.sources) });
  writeFileSync(join(OUT, `${id}.html`), html);
  const { htmlToJpeg } = await import('./render/shot.ts');
  await htmlToJpeg(html, SIZE, join(OUT, `${id}.jpg`));
  writeDraft(draft);

  console.log(`${facts.czech.name} (${facts.czech.record ?? '?'}) – ${facts.opponent.name} (${facts.opponent.record ?? '?'})${facts.winner !== undefined ? `, vítěz ${facts.winner ?? '–'}` : ''}`);
  for (const r of facts.rows) console.log(`  ${r.label}: ${r.value}`);
  for (const u of facts.sources) console.log(`  zdroj ${u}`);
  console.log(`Titulek: ${venca.titulek}\nHláška: ${venca.hlaska}\nPopisek: ${venca.popisek}`);
  console.log(`Koncept ${id}: výraz ${venca.vyraz}, ke kontrole ${draft.pozor.length}.`);
  for (const p of draft.pozor) console.log(`  ⚠ ${p}`);
  output('has_post', 'true');
  output('id', id);
  output('pozor', String(draft.pozor.length));
}

const commands: Record<string, () => Promise<void> | void> = { make, kotel, special, upload, issue, telegram, notify, publish, refresh };

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
