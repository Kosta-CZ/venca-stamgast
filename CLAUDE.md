# Venca Štamgast – pravidla projektu

AI postava sportovního účtu na Instagramu (@venca_stamgast): Venca, štamgast od třetího stolu,
komentuje fotbal a hokej s důrazem na Čechy. Česky komunikujeme, kód a identifikátory anglicky,
komentáře česky.

## Jak to funguje

1. `.github/workflows/ranni-pivo.yml` každé ráno stáhne noc z NHL (`src/nhl.ts`), spočítá fakta
   (`src/facts.ts`), nechá Vencu napsat texty přes Claude API (`src/venca.ts`, prompt `prompts/system.md`),
   vykreslí obrázek (`src/render/`) a nahraje koncept do Cloudflare R2 (`src/storage.ts`).
2. Založí issue „Ke schválení…“ s náhledem (`src/draft.ts`). Majitel komentářem `/vydat` spustí
   `.github/workflows/vydat.yml`, které koncept vydá přes Instagram API (`src/instagram.ts`).
3. Nastavení (secrets, R2, token) je v `docs/nastaveni.md`.

## Pravidla (povinná)

1. **Čísla dělá kód, ne AI.** Jména, body, výsledky a úspěšnost jdou do grafiky jen z dat (`facts.ts`).
   Venca dodává titulek, hlášku, popisek, výraz a výběr muže noci. `checkVenca` hlídá čísla v jeho textech;
   co nesedí, jde do `pozor` a koncept čeká na člověka.
2. **Nic nevychází bez schválení**, dokud majitel nezapne `AUTO_RANNI_PIVO`. I pak jen při `pozor = 0`.
   Názorové formáty (hodnocení, Venca vs. Jarda) se vždy schvalují.
3. **Bible postavy je `prompts/system.md`.** Výkon ano, člověk ne; žádné soukromí, zranění, sázení
   ani politika; postava je vždy označená jako AI (popisek i grafika).
4. **Výrazy Vency** jsou v `src/render/avatar.ts` (stejná kresba jako charakterový list). Gesta rukou
   jen taková, která nejdou vyložit jako urážka.
5. **Tajné údaje jen v GitHub Secrets.** Nikdy je nevypisovat; chyby od Instagramu token maskují.
6. Repozitář je veřejný: úloha `vydat.yml` musí poslouchat jen majitele (`github.repository_owner`).
7. Nový Čech v NHL se připíše do `data/czech-nhl.json` (hledá se podle iniciály a příjmení bez diakritiky).
8. Po změně kódu `npm test` a `npm run typecheck`.

## Příkazy

```bash
npm run venca -- make --demo                # ukázka z 9. 11. bez sítě (out/)
npm run venca -- make --date 2026-11-17     # skutečná noc (potřebuje síť, bez klíče suché texty)
npm run venca -- upload --id 2026-11-17-ranni-pivo
npm run venca -- publish --id 2026-11-17-ranni-pivo --dry-run
npm test
```

Místní vykreslení bez Playwright prohlížeče: `CHROME_PATH=/cesta/k/chrome npm run venca -- make --demo`.

## Co bude dál

Další formáty z plánu (Víkendová účtenka, Extraligový kotel, Štamgast hodnotí, Venca vs. Jarda) potřebují
zdroj dat pro fotbal a extraligu; šablony v2 jsou na plátně „Štamgast – ukázkové příspěvky“.
Plán příspěvků se dá ukázat na publeague.eu/venca_stamgast/ (statická stránka čtoucí koncepty z R2).
