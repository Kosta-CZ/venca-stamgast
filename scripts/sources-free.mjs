// Kontrola volného zdroje: TheSportsDB (veřejný klíč 123, bez registrace). Co má k extralize a Chance Lize:
// poslední zápasy, celé kolo, sezónu, tabulku a detail zápasu. Spouští ji ruční úloha .github/workflows/zdroje.yml.

const BASE = 'https://www.thesportsdb.com/api/v1/json/123';
const UA = { 'user-agent': 'venca-stamgast (https://github.com/Kosta-CZ/venca-stamgast)' };
const EXTRALIGA = 4923;

async function get(path) {
  try {
    const res = await fetch(`${BASE}/${path}`, { headers: UA });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* není JSON */ }
    console.log(`\n/${path} → HTTP ${res.status}${body ? '' : `, ne-JSON: ${text.slice(0, 120)}`}`);
    return body;
  } catch (e) {
    console.log(`\n/${path} → nedostupné: ${e.message}`);
    return null;
  }
}

const line = (e) =>
  `  ${e.dateEvent} ${e.strTime ?? ''} kolo ${e.intRound ?? '?'}: ${e.strHomeTeam} – ${e.strAwayTeam} ${e.intHomeScore ?? '-'}:${e.intAwayScore ?? '-'} ${e.strStatus ?? ''}${e.strPostponed === 'yes' ? ' ODLOŽENO' : ''}`;

function summary(events, label) {
  const list = events ?? [];
  const done = list.filter((e) => e.intHomeScore != null && e.intHomeScore !== '');
  console.log(`  ${label}: ${list.length} zápasů, se skóre ${done.length}`);
  const rounds = {};
  for (const e of list) rounds[e.intRound] = (rounds[e.intRound] ?? 0) + 1;
  console.log(`  zápasů v kolech: ${JSON.stringify(rounds)}`);
  return list;
}

async function league(id, season, name) {
  console.log(`\n===== ${name} (TheSportsDB ${id}, sezóna ${season}) =====`);
  const past = (await get(`eventspastleague.php?id=${id}`))?.events ?? [];
  console.log(`  posledních zápasů: ${past.length}`);
  for (const e of past) console.log(line(e));

  const round = past[0]?.intRound;
  if (round) {
    const r = (await get(`eventsround.php?id=${id}&r=${round}&s=${season}`))?.events ?? [];
    summary(r, `kolo ${round}`);
    for (const e of r) console.log(line(e));
  }

  const all = summary((await get(`eventsseason.php?id=${id}&s=${season}`))?.events, 'celá sezóna');
  for (const e of all.slice(-3)) console.log(line(e));

  const table = (await get(`lookuptable.php?l=${id}&s=${season}`))?.table ?? [];
  console.log(`  tabulka: ${table.length} řádků`);
  for (const t of table.slice(0, 6)) {
    console.log(`  ${t.intRank}. ${t.strTeam} z ${t.intPlayed}, v ${t.intWin}, r ${t.intDraw}, p ${t.intLoss}, skóre ${t.intGoalsFor}:${t.intGoalsAgainst}, ${t.intPoints} b. ${t.strForm ?? ''} (${t.dateUpdated ?? ''})`);
  }

  const last = past[0];
  if (last) {
    const ev = (await get(`lookupevent.php?id=${last.idEvent}`))?.events?.[0];
    if (ev) {
      const keys = Object.entries(ev).filter(([k, v]) => v && /Goal|Card|Detail|Shots|Lineup|Result|Spectators|Venue|Official/i.test(k));
      console.log(`  detail zápasu ${last.idEvent}: ${keys.map(([k, v]) => `${k}=${String(v).slice(0, 80)}`).join(' | ') || 'jen základní údaje'}`);
    }
    const tl = await get(`lookuptimeline.php?id=${last.idEvent}`);
    console.log(`  průběh zápasu: ${tl?.timeline ? `${tl.timeline.length} událostí` : JSON.stringify(tl)?.slice(0, 120)}`);
  }
}

// Fotbalová liga: id najde podle země.
async function czechFootball() {
  for (const c of ['Czech Republic', 'Czechia']) {
    const res = (await get(`search_all_leagues.php?c=${encodeURIComponent(c)}&s=Soccer`))?.countries ?? [];
    for (const l of res) console.log(`  ${l.idLeague} ${l.strLeague} (${l.strCurrentSeason ?? '?'})`);
    const top = res.find((l) => /First League|1\. ?Liga|Chance/i.test(l.strLeague) && !/Women|U19|National/i.test(l.strLeague));
    if (top) return top;
  }
  return null;
}

await league(EXTRALIGA, '2026-2027', 'EXTRALIGA');
const fb = await czechFootball();
if (fb) await league(fb.idLeague, fb.strCurrentSeason || '2026-2027', fb.strLeague);
else console.log('\nČeskou fotbalovou ligu jsem v TheSportsDB nenašel.');
