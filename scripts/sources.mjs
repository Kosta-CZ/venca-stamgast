// Kontrola zdrojů dat: co vrací API-Sports s klíčem API_SPORTS_KEY pro extraligu, Chance Ligu a reprezentace.
// Spouští ji ručně úloha .github/workflows/zdroje.yml. Repozitář je veřejný: vypisuje jen sportovní data
// a tarif, nikdy klíč ani údaje o účtu.

const KEY = process.env.API_SPORTS_KEY;
if (!KEY) {
  console.error('Chybí tajemství API_SPORTS_KEY.');
  process.exit(1);
}

const HOST = {
  hockey: 'https://v1.hockey.api-sports.io',
  football: 'https://v3.football.api-sports.io',
};
const FINISHED = new Set(['FT', 'AOT', 'AP', 'AET', 'PEN']);
const byTime = (t) => (a, b) => t(a) - t(b);

async function get(sport, path) {
  let res, body;
  try {
    res = await fetch(`${HOST[sport]}/${path}`, { headers: { 'x-apisports-key': KEY } });
    body = await res.json();
  } catch (e) {
    console.log(`\n[${sport}] /${path} → nedostupné: ${e.message}`);
    return null;
  }
  const errs = body.errors && Object.keys(body.errors).length ? body.errors : null;
  console.log(`\n[${sport}] /${path} → HTTP ${res.status}, výsledků ${body.results ?? '?'}${errs ? `\n  CHYBA: ${JSON.stringify(errs)}` : ''}`);
  return body.response ?? null;
}

// Jen tarif a počet dotazů, odpověď obsahuje i jméno a e-mail majitele účtu.
async function plan(sport) {
  const s = await get(sport, 'status');
  if (s && !Array.isArray(s)) {
    console.log(`  tarif ${s.subscription?.plan ?? '?'}, aktivní ${s.subscription?.active ?? '?'}, dnes dotazů ${s.requests?.current ?? '?'} z ${s.requests?.limit_day ?? '?'}`);
  }
}

async function hockey() {
  console.log('\n===== HOKEJ (API-Hockey) =====');
  await plan('hockey');
  const leagues = (await get('hockey', 'leagues?country=Czech-Republic')) ?? [];
  for (const l of leagues) {
    console.log(`  ${l.id} ${l.name} (${l.type}), sezóny ${(l.seasons ?? []).map((s) => s.season + (s.current ? '*' : '')).join(', ')}`);
  }
  const ext = leagues.find((l) => l.name === 'Extraliga');
  if (!ext) return;
  const cur = ext.seasons.find((s) => s.current) ?? ext.seasons.at(-1);
  console.log(`  Extraliga: id ${ext.id}, sezóna ${cur.season} (${cur.start} – ${cur.end}), pokrytí ${JSON.stringify(cur.coverage ?? {})}`);

  const games = (await get('hockey', `games?league=${ext.id}&season=${cur.season}`)) ?? [];
  const done = games.filter((g) => FINISHED.has(g.status?.short)).sort(byTime((g) => g.timestamp));
  const next = games.filter((g) => g.status?.short === 'NS').sort(byTime((g) => g.timestamp));
  console.log(`  zápasů ${games.length}, odehráno ${done.length}`);
  for (const g of done.slice(-6)) {
    console.log(`  ${g.date?.slice(0, 10)} ${g.teams.home.name} – ${g.teams.away.name} ${g.scores.home}:${g.scores.away} ${g.status.short}, třetiny ${JSON.stringify(g.periods)}, události ${g.events}`);
  }
  for (const g of next.slice(0, 3)) console.log(`  příště ${g.date?.slice(0, 16)} ${g.teams.home.name} – ${g.teams.away.name}`);

  const last = done.at(-1);
  if (last) {
    const ev = (await get('hockey', `games/events?game=${last.id}`)) ?? [];
    for (const e of ev.slice(0, 14)) {
      console.log(`  ${e.period} ${e.minute}' ${e.type} ${e.team?.name}: ${(e.players ?? []).join(', ')}${e.assists?.length ? ` (asistence ${e.assists.join(', ')})` : ''} ${e.comment ?? ''}`);
    }
  }

  const st = (await get('hockey', `standings?league=${ext.id}&season=${cur.season}`)) ?? [];
  const table = Array.isArray(st[0]) ? st[0] : st;
  for (const r of table.slice(0, 5)) console.log(`  ${r.position}. ${r.team?.name} ${r.games?.played} z., ${r.points} b. ${r.group?.name ?? ''}`);

  const teams = (await get('hockey', 'teams?search=Czech')) ?? [];
  for (const t of teams.slice(0, 8)) console.log(`  tým ${t.id} ${t.name}, národní ${t.national}`);
  const nat = teams.find((t) => t.national && /^Czech/.test(t.name));
  if (nat) {
    const ng = (await get('hockey', `games?team=${nat.id}&season=${cur.season}`)) ?? [];
    for (const g of ng.sort(byTime((g) => g.timestamp)).slice(-6)) {
      console.log(`  repre ${g.date?.slice(0, 10)} ${g.league?.name}: ${g.teams.home.name} – ${g.teams.away.name} ${g.scores.home ?? '-'}:${g.scores.away ?? '-'} ${g.status.short}`);
    }
  }
}

async function football() {
  console.log('\n===== FOTBAL (API-Football) =====');
  await plan('football');
  const leagues = (await get('football', 'leagues?country=Czech-Republic')) ?? [];
  for (const l of leagues) {
    console.log(`  ${l.league.id} ${l.league.name} (${l.league.type}), aktuální sezóna ${l.seasons?.find((s) => s.current)?.year ?? '-'}`);
  }
  const liga = leagues.find((l) => l.league.name === 'Czech Liga') ?? leagues.find((l) => l.league.type === 'League');
  if (!liga) return;
  const cur = liga.seasons.find((s) => s.current) ?? liga.seasons.at(-1);
  console.log(`  ${liga.league.name}: id ${liga.league.id}, sezóna ${cur.year} (${cur.start} – ${cur.end}), pokrytí ${JSON.stringify(cur.coverage ?? {})}`);

  const fx = (await get('football', `fixtures?league=${liga.league.id}&season=${cur.year}`)) ?? [];
  const done = fx.filter((f) => FINISHED.has(f.fixture.status.short)).sort(byTime((f) => f.fixture.timestamp));
  const next = fx.filter((f) => f.fixture.status.short === 'NS').sort(byTime((f) => f.fixture.timestamp));
  console.log(`  zápasů ${fx.length}, odehráno ${done.length}`);
  for (const f of done.slice(-6)) console.log(`  ${f.fixture.date.slice(0, 10)} ${f.league.round}: ${f.teams.home.name} – ${f.teams.away.name} ${f.goals.home}:${f.goals.away}`);
  for (const f of next.slice(0, 3)) console.log(`  příště ${f.fixture.date.slice(0, 16)} ${f.teams.home.name} – ${f.teams.away.name}`);

  const last = done.at(-1);
  if (last) {
    const ev = (await get('football', `fixtures/events?fixture=${last.fixture.id}`)) ?? [];
    for (const e of ev.filter((x) => x.type !== 'subst')) {
      console.log(`  ${e.time.elapsed}${e.time.extra ? `+${e.time.extra}` : ''}' ${e.type} ${e.detail} – ${e.team?.name}: ${e.player?.name ?? ''}${e.assist?.name ? ` (${e.assist.name})` : ''}${e.comments ? ` [${e.comments}]` : ''}`);
    }
  }

  const st = (await get('football', `standings?league=${liga.league.id}&season=${cur.year}`)) ?? [];
  for (const r of (st[0]?.league?.standings?.[0] ?? []).slice(0, 5)) console.log(`  ${r.rank}. ${r.team.name} ${r.all.played} z., ${r.points} b.`);

  const teams = (await get('football', 'teams?search=Czech')) ?? [];
  for (const t of teams.slice(0, 8)) console.log(`  tým ${t.team.id} ${t.team.name}, národní ${t.team.national}`);
  const nat = teams.find((t) => t.team.national && /^Czech/.test(t.team.name) && !/U\d/.test(t.team.name));
  if (nat) {
    const nf = (await get('football', `fixtures?team=${nat.team.id}&season=${new Date().getUTCFullYear()}`)) ?? [];
    for (const f of nf.sort(byTime((f) => f.fixture.timestamp)).slice(-6)) {
      console.log(`  repre ${f.fixture.date.slice(0, 10)} ${f.league.name}: ${f.teams.home.name} – ${f.teams.away.name} ${f.goals.home ?? '-'}:${f.goals.away ?? '-'} ${f.fixture.status.short}`);
    }
  }
}

await hockey();
await football();
