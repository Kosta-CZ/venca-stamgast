// Šablona přehledu (styl v2): legionáři, Češi v cizině, tenis. Hrdina nahoře, pod ním hráči s výkony,
// co se nevejde, jde do popisku. Čistá funkce: fakta + Vencovy texty → HTML 1080 × 1350.

import type { DigestFacts } from '../digest.ts';
import type { VencaOut } from '../venca.ts';
import { vencaSvg } from './avatar.ts';
import { esc, SIZE } from './ranniPivo.ts';

export { SIZE };

const BG = '#10291F', CARD = '#17382B', LINE = '#23473A', MUTED = '#9FB8AC', SOFT = '#C9D6CE', INK = '#F4EFE4', ACC = '#F5B027';
const MONO = "font-family:'JetBrains Mono',monospace;";
const COND = 'font-stretch:75%;';

/** Kolik hráčů se vejde pod hrdinu; ostatní jdou do popisku. */
export const MAX_ROWS = 6;

const KICKER: Record<DigestFacts['sport'], string> = {
  hokej: 'ČEŠI V EVROPĚ A AHL',
  fotbal: 'ČEŠI V ZAHRANIČNÍCH KLUBECH',
  tenis: 'ČEŠI NA TURNAJÍCH ATP A WTA',
};

export interface DigestInput {
  facts: DigestFacts;
  venca: Pick<VencaOut, 'titulek' | 'hlaska' | 'vyraz'>;
  disclaimer: string;
}

export function digestHtml({ facts, venca, disclaimer }: DigestInput): string {
  const heroRow = facts.rows.find((r) => r.player === facts.hero) ?? facts.rows[0];
  const others = facts.rows.filter((r) => r !== heroRow);
  const shown = others.slice(0, MAX_ROWS);
  const more = others.length - shown.length;
  const rows = shown.map((r) => `
<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:center;padding:13px 0;border-top:2px solid ${LINE}">
  <div style="display:flex;flex-direction:column;gap:2px;min-width:0">
    <div style="display:flex;align-items:baseline;gap:14px;min-width:0">
      <span style="font-size:31px;font-weight:800;white-space:nowrap">${esc(r.player)}</span>
      <span style="${MONO}font-size:17px;color:${MUTED};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.where)}</span>
    </div>
    <div style="font-size:21px;color:${SOFT};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.detail)}</div>
  </div>
  <div style="${MONO}font-size:${r.value.length > 9 ? 24 : 34}px;font-weight:700;color:${ACC};white-space:nowrap">${esc(r.value)}</div>
</div>`).join('');

  const hero = heroRow
    ? `<div style="position:relative;background:${CARD};border-radius:22px;padding:26px 34px;display:flex;flex-direction:column;gap:10px">
    <div style="${MONO}font-size:20px;letter-spacing:3px;color:${ACC}">${facts.sport === 'tenis' ? 'ZÁPAS DNE' : 'HRÁČ TÝDNE'}</div>
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:24px">
      <div id="hero-name" style="font-size:64px;font-weight:900;${COND}line-height:0.95;white-space:nowrap;overflow:hidden">${esc(heroRow.player.toUpperCase())}</div>
      <div style="${MONO}font-size:${heroRow.value.length > 9 ? 32 : 56}px;font-weight:700;color:${ACC};white-space:nowrap">${esc(heroRow.value)}</div>
    </div>
    <div style="${MONO}font-size:19px;color:${MUTED}">${esc(heroRow.where)}</div>
    <div style="font-size:24px;color:${SOFT};line-height:1.3">${esc(heroRow.detail)}</div>
  </div>`
    : '';

  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<title>${esc(facts.nazev)} ${esc(facts.periodLabel)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>html,body{margin:0;background:${BG}}</style>
</head>
<body>
<div id="root" style="width:${SIZE.w}px;height:${SIZE.h}px;box-sizing:border-box;position:relative;overflow:hidden;padding:56px 72px;background:${BG};color:${INK};font-family:'Archivo',sans-serif;display:flex;flex-direction:column;gap:24px">
  <div aria-hidden="true" style="position:absolute;top:-170px;right:-150px;width:460px;height:460px;border-radius:50%;border:16px solid rgba(245,176,39,0.10)"></div>
  <div aria-hidden="true" style="position:absolute;top:-120px;right:-60px;width:400px;height:400px;border-radius:50%;border:6px solid rgba(245,176,39,0.07)"></div>

  <div style="position:relative;display:flex;justify-content:space-between;align-items:center">
    <div style="display:flex;align-items:center;gap:14px">
      <div style="background:${ACC};color:${BG};font-weight:900;${COND}font-size:34px;letter-spacing:1px;padding:6px 16px;border-radius:8px">ŠTAMGAST</div>
      <div style="${MONO}font-size:20px;color:${MUTED};letter-spacing:2px">SPORT OD STOLU</div>
    </div>
    <div style="${MONO}font-size:22px;letter-spacing:2px;border:2px solid #2C5A47;padding:8px 14px;border-radius:8px">${esc(facts.nazev.toUpperCase())} · <span style="color:${ACC}">${esc(facts.periodLabel)}</span></div>
  </div>

  <div style="position:relative;display:flex;flex-direction:column;gap:8px">
    <div style="${MONO}font-size:22px;letter-spacing:3px;color:${ACC}">${KICKER[facts.sport]}</div>
    <div style="font-size:66px;font-weight:900;${COND}line-height:0.98;letter-spacing:-1px">${esc(venca.titulek)}</div>
  </div>

  ${hero}

  <div style="position:relative;display:flex;flex-direction:column">
    ${rows}
    ${more > 0 ? `<div style="${MONO}font-size:20px;color:${MUTED};padding-top:10px">+ ${more} další v popisku</div>` : ''}
  </div>

  <div style="margin-top:auto;position:relative;display:flex;align-items:flex-end;gap:22px">
    ${vencaSvg(venca.vyraz, 130)}
    <div style="flex:1;background:${INK};color:#1C1C1A;border-radius:26px 26px 26px 6px;padding:22px 28px;display:flex;flex-direction:column;gap:6px">
      <div style="${MONO}font-size:17px;font-weight:700;letter-spacing:2px;color:#6B655A">VENCA ŠTAMGAST · AI POSTAVA</div>
      <div style="font-size:29px;font-weight:800;line-height:1.25">„${esc(venca.hlaska)}“</div>
    </div>
  </div>
  <div style="${MONO}font-size:17px;color:${MUTED};text-align:right">${esc(disclaimer)}</div>
</div>
<script>
// Pojistka: dlouhé jméno hrdiny se zmenší, dokud se nevejde.
window.fit = () => {
  const el = document.getElementById('hero-name');
  if (!el) return;
  let size = parseFloat(getComputedStyle(el).fontSize);
  while (el.scrollWidth > el.clientWidth && size > 32) { size -= 2; el.style.fontSize = size + 'px'; }
};
</script>
</body>
</html>`;
}
