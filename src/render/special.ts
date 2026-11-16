// Šablona speciálu k velké akci (styl v2): pozvánka (soupeř, bilance, místo, čas) a výsledek
// (vítěz, způsob ukončení, kolo, čas). Hodí se pro MMA i další souboje jeden na jednoho (tenis).
// Čistá funkce: fakta + Vencovy texty → HTML 1080 × 1350.

import { STAGE_LABEL, type SpecialFacts } from '../special.ts';
import type { VencaOut } from '../venca.ts';
import { vencaSvg } from './avatar.ts';
import { esc, SIZE } from './ranniPivo.ts';

export { SIZE };

const BG = '#10291F', CARD = '#17382B', LINE = '#23473A', MUTED = '#9FB8AC', SOFT = '#C9D6CE', INK = '#F4EFE4', ACC = '#F5B027';
const MONO = "font-family:'JetBrains Mono',monospace;";
const COND = 'font-stretch:75%;';

export interface SpecialInput {
  facts: SpecialFacts;
  venca: Pick<VencaOut, 'titulek' | 'hlaska' | 'vyraz'>;
  disclaimer: string;
}

/** Jméno na dva řádky: křestní malé, příjmení velké. */
function splitName(name: string): [string, string] {
  const parts = name.trim().split(/\s+/);
  const last = parts.pop() ?? name;
  return [parts.join(' '), last];
}

/** Velikost příjmení, aby se vešlo do půlky karty (úzké verzálky ≈ 0,5 em na znak). */
export const surnameSize = (surname: string, width = 370, max = 104): number => Math.min(max, Math.floor(width / (surname.length * 0.5)));

function fighter(p: { name: string; record: string | null }, side: 'l' | 'r', winner: boolean, size: number): string {
  const [first, last] = splitName(p.name);
  const align = side === 'l' ? 'flex-start' : 'flex-end';
  const badge = `<div style="${MONO}background:${winner ? ACC : 'transparent'};color:${BG};font-size:20px;font-weight:700;letter-spacing:3px;padding:4px 12px;border-radius:6px;height:26px">${winner ? 'VÍTĚZ' : ''}</div>`;
  return `<div style="display:flex;flex-direction:column;align-items:${align};gap:8px;min-width:0;text-align:${side === 'l' ? 'left' : 'right'}">
    ${badge}
    <div style="font-size:34px;font-weight:700;color:${SOFT}">${esc(first)}</div>
    <div class="nm" style="font-size:${size}px;font-weight:900;${COND}line-height:0.92;letter-spacing:-1px;white-space:nowrap;color:${winner ? ACC : INK}">${esc(last.toUpperCase())}</div>
    <div style="${MONO}font-size:30px;color:${winner ? ACC : MUTED};padding-top:6px;min-height:36px">${esc(p.record ?? '')}</div>
  </div>`;
}

export function specialHtml({ facts, venca, disclaimer }: SpecialInput): string {
  const result = facts.stage === 'vysledek';
  const czWon = result && Boolean(facts.winner) && facts.winner === facts.czech.name;
  const oppWon = result && Boolean(facts.winner) && facts.winner === facts.opponent.name;
  const kicker = `${STAGE_LABEL[facts.stage]} · ${facts.dayLabel}`.toUpperCase();
  const size = Math.min(surnameSize(splitName(facts.czech.name)[1]), surnameSize(splitName(facts.opponent.name)[1]));

  const rows = result
    ? `<div style="display:grid;grid-template-columns:repeat(${Math.max(facts.rows.length, 1)},minmax(0,1fr));gap:14px">
  ${facts.rows.map((r) => `<div style="background:${CARD};border-radius:18px;padding:26px 26px 30px;display:flex;flex-direction:column;gap:10px;min-width:0">
    <div style="${MONO}font-size:20px;letter-spacing:3px;color:${MUTED}">${esc(r.label.toUpperCase())}</div>
    <div style="font-size:${r.value.length > 10 ? 44 : 76}px;font-weight:900;${COND}line-height:1">${esc(r.value)}</div>
  </div>`).join('')}
</div>
${!facts.winner ? `<div style="${MONO}font-size:22px;color:${ACC}">BEZ VÍTĚZE</div>` : ''}`
    : `<div style="display:flex;flex-direction:column">
  ${facts.rows.map((r) => `<div style="display:grid;grid-template-columns:240px minmax(0,1fr);gap:20px;align-items:baseline;padding:20px 0;border-top:2px solid ${LINE}">
    <div style="${MONO}font-size:20px;letter-spacing:3px;color:${MUTED}">${esc(r.label.toUpperCase())}</div>
    <div style="font-size:36px;font-weight:800">${esc(r.value)}</div>
  </div>`).join('')}
</div>`;

  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<title>${esc(facts.akce)} · ${esc(STAGE_LABEL[facts.stage])}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>html,body{margin:0;background:${BG}}</style>
</head>
<body>
<div id="root" style="width:${SIZE.w}px;height:${SIZE.h}px;box-sizing:border-box;position:relative;overflow:hidden;padding:56px 72px;background:${BG};color:${INK};font-family:'Archivo',sans-serif;display:flex;flex-direction:column;gap:26px">
  <div aria-hidden="true" style="position:absolute;top:-170px;right:-150px;width:460px;height:460px;border-radius:50%;border:16px solid rgba(245,176,39,0.10)"></div>
  <div aria-hidden="true" style="position:absolute;top:-120px;right:-60px;width:400px;height:400px;border-radius:50%;border:6px solid rgba(245,176,39,0.07)"></div>

  <div style="position:relative;display:flex;justify-content:space-between;align-items:center">
    <div style="display:flex;align-items:center;gap:14px">
      <div style="background:${ACC};color:${BG};font-weight:900;${COND}font-size:34px;letter-spacing:1px;padding:6px 16px;border-radius:8px">ŠTAMGAST</div>
      <div style="${MONO}font-size:20px;color:${MUTED};letter-spacing:2px">SPORT OD STOLU</div>
    </div>
    <div style="${MONO}font-size:22px;letter-spacing:2px;border:2px solid #2C5A47;padding:8px 14px;border-radius:8px">SPECIÁL · <span style="color:${ACC}">${esc(facts.stitek.toUpperCase())}</span></div>
  </div>

  <div style="position:relative;display:flex;flex-direction:column;gap:8px">
    <div style="${MONO}font-size:22px;letter-spacing:3px;color:${ACC}">${esc(kicker)}</div>
    <div style="font-size:80px;font-weight:900;${COND}line-height:0.98;letter-spacing:-1px">${esc(venca.titulek)}</div>
  </div>

  <div style="position:relative;background:${CARD};border-radius:24px;padding:34px 40px 38px;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:18px;align-items:end">
    ${fighter(facts.czech, 'l', czWon, size)}
    <div style="font-size:48px;font-weight:900;${COND}color:${MUTED};padding-bottom:58px">VS</div>
    ${fighter(facts.opponent, 'r', oppWon, size)}
  </div>

  <div style="position:relative;display:flex;flex-direction:column;gap:14px">${rows}</div>

  <div style="margin-top:auto;position:relative;display:flex;align-items:flex-end;gap:22px">
    ${vencaSvg(venca.vyraz, 140)}
    <div style="flex:1;background:${INK};color:#1C1C1A;border-radius:26px 26px 26px 6px;padding:24px 30px;display:flex;flex-direction:column;gap:6px">
      <div style="${MONO}font-size:18px;font-weight:700;letter-spacing:2px;color:#6B655A">VENCA ŠTAMGAST · AI POSTAVA</div>
      <div style="font-size:31px;font-weight:800;line-height:1.25">„${esc(venca.hlaska)}“</div>
    </div>
  </div>
  <div style="${MONO}font-size:17px;color:${MUTED};text-align:right">${esc(disclaimer)}</div>
</div>
<script>
// Pojistka: dlouhá příjmení se po načtení písem zmenší, dokud se nevejdou.
window.fit = () => {
  const names = [...document.querySelectorAll('.nm')];
  let size = parseFloat(getComputedStyle(names[0]).fontSize);
  while (names.some((el) => el.scrollWidth > el.parentElement.clientWidth) && size > 36) {
    size -= 2;
    for (const el of names) el.style.fontSize = size + 'px';
  }
};
</script>
</body>
</html>`;
}
