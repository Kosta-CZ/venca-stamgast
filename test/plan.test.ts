// Rozvrh bota venca-bot: Cloudflare Cron Trigger spouští úlohy v GitHubu (on: schedule se v repozitáři
// nespouštěl). Testy hlídají časy, soulad s worker/wrangler.jsonc a se vstupy úloh.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { cronMatches, dueAt, PLAN, runPlan, type Env } from '../worker/src/index.ts';

const env: Env = { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '42', BOT_GITHUB_TOKEN: 'gh', GITHUB_REPO: 'Kosta-CZ/venca-stamgast' };
const utc = (iso: string) => new Date(`${iso}Z`);

afterEach(() => vi.unstubAllGlobals());

describe('rozvrh bota', () => {
  it('cron: čísla, seznamy, rozsahy a kroky (UTC)', () => {
    expect(cronMatches('10 6 * * *', utc('2026-11-17T06:10:00'))).toBe(true);
    expect(cronMatches('10 6 * * *', utc('2026-11-17T06:11:00'))).toBe(false);
    expect(cronMatches('53 6 * * 2', utc('2026-11-17T06:53:00'))).toBe(true); // úterý
    expect(cronMatches('53 6 * * 1', utc('2026-11-17T06:53:00'))).toBe(false);
    expect(cronMatches('10,23,41,53 * * * *', utc('2026-11-17T13:41:00'))).toBe(true);
    expect(cronMatches('0 9-17 * * 1-5', utc('2026-11-17T12:00:00'))).toBe(true);
    expect(cronMatches('*/15 * * * *', utc('2026-11-17T12:30:00'))).toBe(true);
    expect(cronMatches('23 12 21 11 *', utc('2026-11-21T12:23:00'))).toBe(true);
    expect(cronMatches('nesmysl', utc('2026-11-21T12:23:00'))).toBe(false);
  });

  it('co se kdy spustí', () => {
    const names = (iso: string) => dueAt(utc(iso)).map((p) => p.workflow);
    expect(names('2026-11-17T06:10:00')).toEqual(['ranni-pivo.yml']);
    expect(names('2026-11-17T06:53:00')).toEqual(['fotbal.yml']); // úterní záloha
    expect(names('2026-11-21T06:10:00')).toEqual(['ranni-pivo.yml']);
    expect(names('2026-11-21T06:41:00')).toEqual(['kotel.yml']); // sobota
    expect(names('2026-11-21T09:41:00')).toEqual(['kotel.yml']);
    expect(names('2026-11-23T06:53:00')).toEqual(['fotbal.yml']); // pondělí
    expect(names('2026-11-17T06:11:00')).toEqual([]);
    expect(dueAt(utc('2026-11-23T10:23:00'))).toEqual([expect.objectContaining({ workflow: 'prehledy.yml', inputs: { prehled: 'cizina' } })]);
    expect(dueAt(utc('2026-11-21T12:23:00'))).toEqual([expect.objectContaining({ workflow: 'specialy.yml', inputs: { stage: 'pozvanka' } })]);
    expect(dueAt(utc('2026-11-21T23:53:00'))).toEqual([expect.objectContaining({ workflow: 'specialy.yml', inputs: { stage: 'vysledek' } })]);
  });

  it('rozvrh sedí s nastavením bota a s úlohami (minuty v triggers, vstup plan, žádný GitHub cron)', () => {
    const crons = /"crons":\s*\[\s*"([^"]+)"/.exec(readFileSync(new URL('../worker/wrangler.jsonc', import.meta.url), 'utf8'))![1]!;
    for (const p of PLAN) {
      const minute = Number(p.cron.split(' ')[0]);
      expect(cronMatches(crons, new Date(Date.UTC(2026, 10, 17, 3, minute))), `${p.note}: minuta ${minute} chybí v triggers`).toBe(true);
      const wf = readFileSync(new URL(`../.github/workflows/${p.workflow}`, import.meta.url), 'utf8');
      expect(wf).toContain('\n      plan:\n');
      expect(wf).toContain('PLAN: ${{ github.event.schedule || inputs.plan }}');
      // Žádné on: schedule, jinak by se úloha spustila dvakrát, kdyby ho GitHub jednou začal pouštět.
      expect(wf).not.toMatch(/^\s+schedule:/m);
      for (const k of Object.keys(p.inputs ?? {})) expect(wf).toContain(`\n      ${k}:\n`);
    }
  });

  it('plánovaný běh spustí úlohu se vstupem plan; když GitHub odmítne, napíše majiteli', async () => {
    const calls: { url: string; body: { ref?: string; inputs?: Record<string, unknown>; text?: string } }[] = [];
    const fake = (githubStatus: number) => vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(githubStatus === 204 ? null : '{}', { status: String(url).includes('api.github.com') ? githubStatus : 200 });
    });

    vi.stubGlobal('fetch', fake(204));
    expect(await runPlan(utc('2026-11-23T10:23:00'), env)).toEqual(['prehledy.yml']);
    expect(calls).toEqual([{
      url: 'https://api.github.com/repos/Kosta-CZ/venca-stamgast/actions/workflows/prehledy.yml/dispatches',
      body: { ref: 'main', inputs: { prehled: 'cizina', plan: '23 10 * * 1' } },
    }]);

    calls.length = 0;
    vi.stubGlobal('fetch', fake(403));
    expect(await runPlan(utc('2026-11-17T06:10:00'), env)).toEqual([]);
    expect(calls[1]!.url).toBe('https://api.telegram.org/bott/sendMessage');
    expect(calls[1]!.body.text).toContain('Ranní pivo');
    expect(calls[1]!.body.text).toContain('403');
  });

  it('pozastavený rozvrh: Cron Trigger nic nespustí', async () => {
    const tasks: Promise<unknown>[] = [];
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', f);
    await worker.scheduled({ scheduledTime: Date.parse('2026-11-20T06:10:00Z'), cron: '10,23,41,53 * * * *' }, { ...env, PAUSED: 'true' }, { waitUntil: (p) => tasks.push(p) });
    await Promise.all(tasks);
    expect(f).not.toHaveBeenCalled();
    expect(readFileSync(new URL('../worker/wrangler.jsonc', import.meta.url), 'utf8')).toContain('"PAUSED": "true"');
  });

  it('Cron Trigger: scheduled spustí rozvrh na pozadí', async () => {
    const tasks: Promise<unknown>[] = [];
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', f);
    await worker.scheduled({ scheduledTime: Date.parse('2026-11-17T06:10:00Z'), cron: '10,23,41,53 * * * *' }, env, { waitUntil: (p) => tasks.push(p) });
    await Promise.all(tasks);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
