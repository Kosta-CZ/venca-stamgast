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
| Variable | `R2_ENDPOINT` | Adresa pro nahrávání (S3 API) z nastavení bucketu, např. `https://<účet>.eu.r2.cloudflarestorage.com`. Nutná u bucketu v EU. |
| Variable | `R2_ACCOUNT_ID` | Id účtu Cloudflare; stačí místo `R2_ENDPOINT` jen u bucketu mimo EU. |
| Variable | `R2_BUCKET` | Název bucketu, např. `venca-stamgast`. |
| Variable | `R2_PUBLIC_URL` | Veřejná adresa bucketu, např. `https://pub-xxxx.r2.dev` (bez lomítka na konci). |
| Variable | `VENCA_MODEL` | Volitelné: model Claude (výchozí `claude-sonnet-5-5`). |
| Variable | `AUTO_RANNI_PIVO` | `true` = Ranní pivo vyjde samo, když kontrola nic nenajde. Bez toho čeká na schválení. |
| Secret | `TELEGRAM_BOT_TOKEN` | Token bota z @BotFather (schvalování v Telegramu). |
| Variable (nebo Secret) | `TELEGRAM_CHAT_ID` | Tvoje Telegram ID (číslo): jen ty smíš schvalovat. |
| Secret | `CLOUDFLARE_API_TOKEN` | Token Cloudflare (šablona „Edit Cloudflare Workers“) pro nasazení bota. |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | Id účtu Cloudflare. |
| Secret | `BOT_GITHUB_TOKEN` | Token GitHubu jen s právem **Actions** na tento repozitář: bot jím spouští vydání. |
| Secret | `API_SPORTS_KEY` | Klíč z api-sports.io (Account → My Access), jeden pro fotbal i hokej. Tarif Free má jen sezóny 2022–2024, na aktuální je potřeba placený. Co klíč vrací, ukáže ruční úloha **Zdroje dat (kontrola)**. |

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
   secrets `R2_ACCESS_KEY_ID` a `R2_SECRET_ACCESS_KEY`. Adresu S3 API z nastavení bucketu ulož jako variable
   `R2_ENDPOINT` (u bucketu v EU má v adrese `.eu.`, bez ní by nahrávání selhalo).

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

## 5. Telegram (schvalování tlačítkem)

Ráno přijde do Telegramu obrázek s popiskem a tlačítky **✅ Vydat** / **🗑 Zahodit**. Ťuknutí zachytí
malý Worker v Cloudflare (`worker/`) a spustí vydání; bot pak odpoví odkazem na příspěvek.
Bez nastaveného bota chodí koncepty dál jako issue.

1. **Bot:** v Telegramu napiš **@BotFather** → `/newbot` → jméno `Venca Štamgast` → uživatelské jméno
   končící na `bot` (např. `venca_stamgast_bot`). Token, který dostaneš, ulož jako secret `TELEGRAM_BOT_TOKEN`.
2. **Tvoje ID:** napiš **@userinfobot** → Start. Číslo za `Id` ulož jako variable `TELEGRAM_CHAT_ID`.
3. **Otevři svého nového bota a dej Start.** Bot nemůže napsat jako první, dokud ho nespustíš.
4. **Cloudflare:** vpravo nahoře ikona účtu → **Profile** → **API Tokens** → **Create Token** → šablona
   **Edit Cloudflare Workers** → Account Resources: tvůj účet, Zone Resources: All zones → **Create Token**.
   Ulož jako secret `CLOUDFLARE_API_TOKEN`; id účtu (je v adrese R2 před `.r2.cloudflarestorage.com`)
   jako variable `CLOUDFLARE_ACCOUNT_ID`.
5. **GitHub token pro bota:** ikona účtu na GitHubu → **Settings** → **Developer settings** → **Personal access
   tokens** → **Fine-grained tokens** → **Generate new token**. Repository access: **Only select repositories** →
   `venca-stamgast`; Permissions → **Actions: Read and write**. Ulož jako secret `BOT_GITHUB_TOKEN`.
6. **Actions → Telegram bot (nasazení) → Run workflow.** Úloha nasadí Worker, předá mu klíče a nastaví webhook.
   Bot ti napíše „Venca je připojený“.

Tlačítka poslechne jen ten, jehož ID je v `TELEGRAM_CHAT_ID`. Po ťuknutí tlačítka hned zmizí a vydání má
pojistku (`published/<id>.json` v úložišti), takže dvojí ťuknutí nevydá příspěvek dvakrát.

## 6. Extraligový kotel

Nic nového se nenastavuje: Kotel používá stejné klíče jako Ranní pivo (Claude API, R2, Telegram).

- **Kdy:** v sobotu v 6:41 UTC (7:41 v zimě). Když v datech ještě chybí páteční výsledky, zkusí to záložní běh
  v 9:41 UTC. Když se od minulé soboty nehrálo nové kolo, přijde jen krátká zpráva.
- **Ručně:** Actions → **Extraligový kotel** → Run workflow, volitelně číslo kola (prázdné = poslední odehrané).
- **Data:** výsledky z TheSportsDB (zdarma, asi 10 dotazů za minutu). Kola se ukládají do R2
  (`kotel/<sezóna>/kolo-NN.json`), první běh sezóny stáhne celý rozpis (asi 7 minut), další jen nová kola.
  Tabulka se počítá z uložených výsledků (3-2-1-0; při rovnosti bodů rozdíl skóre a vstřelené góly, stejně jako
  tabulka ČTK; po základní části rozhodují vzájemné zápasy).
- **Střelci:** dohledá je Claude API s vyhledáváním jen na ceskenoviny.cz, hokej.cz a sport.ceskatelevize.cz.
  Kód je porovná se skóre z TheSportsDB; rozpory jdou do „Ke kontrole“ a odkazy na zdroje do zprávy v Telegramu.
- **Názvy týmů:** `data/extraliga-tymy.json`. Neznámý tým (třeba nováček) se ukáže ke kontrole, stačí ho připsat.
- **Schválení a vydání:** stejně jako Ranní pivo (✅ Vydat / 🗑 Zahodit). Kotel nikdy nevychází sám.

## 7. Speciál k velké akci (Procházka v UFC a další)

Taky bez nového nastavení. Akce se popisuje souborem v `data/specialy/` (kdo, proti komu, kdy, pásmo místa
a dvě skupiny zdrojů) a v `.github/workflows/specialy.yml` dostane řádky `cron`.

- **Procházka – Stirling, sobota 21. 11. 2026** (hlavní karta v 19:00 našeho času): pozvánka v 13:23,
  výsledek ve 23:23 a záloha v 0:53. Když výsledek ještě nesedí ve dvou zdrojích, přijde zpráva a zkusí se to znovu.
- **Fakta:** Claude API hledá dvakrát nezávisle, jednou jen v mezinárodních zdrojích (UFC, ESPN…) a jednou jen
  v českých (iSport, ČTK, ČT sport…). Kód obě verze porovná; každý údaj musí sedět v obou, jinak je „Ke kontrole“.
  Časy převádí na náš čas kód.
- **Ručně:** Actions → **Speciál (velké akce)** → Run workflow: druh (pozvánka / výsledek), případně název souboru akce.
  Zkouška na minulém zápase: akce `zkouska-2026-04-11-ufc327`, odeslání vypnuté (nic se nenahraje ani nepošle).
- **Schválení:** obě verze chodí do Telegramu s tlačítky ✅ Vydat / 🗑 Zahodit, nikdy nevychází samy.

## 8. Fotbalová 1. liga a přehledy

Bez nového nastavení (Claude API, R2, Telegram jako u ostatních).

- **1. liga:** Actions → **Fotbalová liga**. V pondělí 7:53 (když se kolo ještě dohrává, zkusí to v úterý 7:53).
  Kolo starší než 3 dny (po reprezentační pauze) se neposílá, v pondělí přijde jen krátká zpráva.
  V příspěvcích se soutěž píše „1. liga“: oficiální název nese jméno sázkové kanceláře. Týmy: `data/fotbal-tymy.json`.
- **Přehledy:** Actions → **Přehledy**. Češi ve fotbale v cizině v pondělí v 11:23 (minulý týden): góly, asistence a čistá konta brankářů. České zdroje
  hledají po hráčích ze seznamu v `data/prehledy/cizina.json` (po přestupech ho uprav), mezinárodní zdroje pak
  ověří nalezené zápasy; do grafiky jde jen to, co sedí v obou.
  Vypnuté: tenis (kvůli ceně) a hokejoví legionáři (česká média o nich zápas po zápasu nepíšou). Ručně jdou spustit,
  zapnou se vrácením řádku `cron` v `prehledy.yml`.
- Zkouška na minulém dni: Run workflow s datem a vypnutým odesláním (nic se nenahraje ani nepošle).

## Token

- **Token Facebooku (začíná `EAA`, Unified login):** nevyprší, ranní úloha jen ověří, že platí.
  `SOCIAL_ADMIN_TOKEN` není potřeba.
- **Token Instagramu (začíná `IG`):** platí 60 dní a ranní úloha ho prodlužuje. Když Instagram vydá nový
  a chybí `SOCIAL_ADMIN_TOKEN`, založí úloha issue a token je potřeba uložit ručně.

V obou případech úloha založí issue „Token Instagramu je potřeba obnovit“, když token přestane platit
(změna hesla, odebraný přístup aplikace). Nový se vystaví stejně jako v kroku 1.

## Když se něco pokazí

- **Issue nevzniklo:** v běhu úlohy je vidět proč. „Žádný Čech v noci nehrál“ je v pořádku.
- **V issue je ⚠️:** Venca napsal číslo, které není v datech, nebo zápas nebyl dohraný. Zkontroluj a buď `/vydat`, nebo `/zahodit`.
- **Vydání selhalo:** komentář v issue odkáže na běh; koncept čeká dál a `/vydat` jde zkusit znovu.
