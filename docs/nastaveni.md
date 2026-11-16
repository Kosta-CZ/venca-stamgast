# Nastavení (jednorázově, majitel)

Úlohy běží v GitHub Actions. Repozitář je veřejný, takže běhy jsou zdarma a nečerpají minuty
soukromých repozitářů (Pub League). Tajné údaje jsou jen v **Settings → Secrets and variables →
Actions**, nikdy v kódu ani v chatu.

## Co kam patří

| Druh | Jméno | Co to je |
| --- | --- | --- |
| Secret | `ANTHROPIC_API_KEY` | Klíč Claude API z console.anthropic.com. Bez něj vyjdou suché texty bez Vency. |
| Secret | `IG_ACCESS_TOKEN` | Token Instagramu pro **@venca_stamgast** (ne token Pub League). |
| Secret | `IG_USER_ID` | Jen když token vidí víc účtů; úloha na to upozorní. |
| Secret | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Klíč k bucketu R2 (jen tenhle bucket, čtení a zápis). |
| Secret | `SOCIAL_ADMIN_TOKEN` | Volitelné: osobní token GitHubu s právem Secrets, aby se prodloužený token Instagramu uložil sám. |
| Variable | `R2_ACCOUNT_ID` | Id účtu Cloudflare (je v adrese i v přehledu R2). |
| Variable | `R2_BUCKET` | Název bucketu, např. `venca-stamgast`. |
| Variable | `R2_PUBLIC_URL` | Veřejná adresa bucketu, např. `https://pub-xxxx.r2.dev` (bez lomítka na konci). |
| Variable | `VENCA_MODEL` | Volitelné: model Claude (výchozí `claude-sonnet-5-5`). |
| Variable | `AUTO_RANNI_PIVO` | `true` = Ranní pivo vyjde samo, když kontrola nic nenajde. Bez toho čeká na `/vydat`. |

## 1. Instagram @venca_stamgast

Stejně jako u Pub League (`docs/social.md` v repozitáři hry):

1. Založ účet a přepni ho na **profesionální** (Tvůrce nebo Firma). Do bia napiš, že jde o AI postavu.
2. Na developers.facebook.com použij aplikaci Pub League, nebo založ novou, s případem užití Instagram API
   a **API setup with Unified login**. Přidej účet @venca_stamgast s oprávněním vydávat obsah.
3. Vystav token a ulož ho jako secret `IG_ACCESS_TOKEN` **v tomto repozitáři**.

## 2. Úložiště Cloudflare R2

1. Cloudflare → R2 → Create bucket `venca-stamgast`.
2. V nastavení bucketu zapni **Public access** (r2.dev subdomain, nebo vlastní doména) a adresu ulož
   jako variable `R2_PUBLIC_URL`.
3. R2 → Manage API tokens → Create token: **Object Read & Write**, jen pro tenhle bucket. Klíče ulož jako
   secrets `R2_ACCESS_KEY_ID` a `R2_SECRET_ACCESS_KEY`, id účtu jako variable `R2_ACCOUNT_ID`.

## 3. Claude API

console.anthropic.com → API Keys → Create key → secret `ANTHROPIC_API_KEY`. Jeden příspěvek je jedno
krátké volání (řádově tisíce tokenů).

## 4. Zkouška

1. **Actions → Ranní pivo → Run workflow** (datum třeba `2026-11-09`). Vznikne issue „Ke schválení: Ranní
   pivo …“ s náhledem, popiskem a seznamem věcí ke kontrole.
2. **Actions → Vydání na Instagram → Run workflow** s id konceptu a zaškrtnutou zkouškou: Instagram obrázek
   přijme a zpracuje, ale nevydá.
3. Ostré vydání: v issue napiš komentář `/vydat` (nebo `/zahodit`).

Od té chvíle úloha běží každé ráno v 6:10 UTC (7:10 v zimě, 8:10 v létě).

## Token

Token Instagramu platí 60 dní a ranní úloha ho prodlužuje. Když Instagram vydá nový a chybí
`SOCIAL_ADMIN_TOKEN`, založí úloha issue a token je potřeba uložit ručně. Postup vystavení je stejný jako v kroku 1.

## Když se něco pokazí

- **Issue nevzniklo:** v běhu úlohy je vidět proč. „Žádný Čech v noci nehrál“ je v pořádku.
- **V issue je ⚠️:** Venca napsal číslo, které není v datech, nebo zápas nebyl dohraný. Zkontroluj a buď `/vydat`, nebo `/zahodit`.
- **Vydání selhalo:** komentář v issue odkáže na běh; koncept čeká dál a `/vydat` jde zkusit znovu.
