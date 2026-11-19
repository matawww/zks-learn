# Plan (na čekanju): »Slušaj« + AI odgovor za sugovornika (Claude API)

> Status: odobren kao ideja, čeka potvrdu za izradu. Kad bude potvrđeno, izraditi prema ovom planu.

## Kontekst
Lokalne natuknice (bez AI-ja) sada rade. Korisnik želi korak dalje: kad sugovornik postavi pitanje o ZKS-u ili Uredbi, aplikacija treba pripremiti **gotov odgovor koji korisnik može izgovoriti**, prilagođen baš tom pitanju i kontekstu razgovora (npr. ranije spomenuti sektor ili veličina tvrtke), s točnim izvorom.

Odlučeno: govornici se ne razlikuju po glasu. **Claude iz teksta transkripta prepoznaje zadnje postavljeno stručno pitanje.** Šalje se samo tekst, nikad zvuk.

## Kako bi radilo (tijek)
1. Preglednik kao i sada pretvara govor u tekst (Chrome, hr-HR), a lokalni slojevi odmah prikazuju natuknice (0 s, besplatno).
2. Kad lokalni sloj prepozna stručnu temu ili pitanje, aplikacija nakon ~1,5 s tišine šalje **zadnje ~2 minute teksta** našem malom poslužitelju. Uvjeti slanja:
   - lokalni sloj je pronašao temu, ili postoji upitna riječ uz stručni pojam;
   - najviše 1 upit istodobno, isto pitanje se ne šalje dvaput.
3. Poslužitelj (**Cloudflare Worker**, besplatan plan) dodaje API ključ i šalje upit **Claude API-ju**.
4. Uz upit ide **cijela baza znanja**: izvorni tekst Zakona, Uredbe i Priloga B te sažeci iz aplikacije, otprilike 150k tokena. Baza se **predmemorira** (prompt caching), pa je svaki sljedeći upit brz i jeftin.
5. Claude vraća:
   - **prepoznato pitanje**;
   - **»Možete reći:«** 1–3 rečenice za izgovoriti;
   - natuknice s brojkama i rokovima;
   - **izvor** (članak, mjera, kontrola);
   - **pouzdanost**.

   Ako u razgovoru nema stručnog pitanja, vraća »nije relevantno« i ništa se ne prikazuje.
6. Odgovor se ispisuje postupno (streaming): prve riječi za ~2–4 s, cijeli odgovor za ~5–8 s. Kartica »🤖 AI odgovor« pojavljuje se na vrhu natuknica; izvori su poveznice na točna mjesta u aplikaciji.
7. Gumb **»Pitaj AI«** omogućuje i ručno slanje (npr. kad automatsko prepoznavanje propusti pitanje).

## Pravila za Claudea (sistemska uputa, hrvatski)
- Odgovara **isključivo iz priložene baze**. Ako odgovor nije u njoj: »Nije propisano ZKS-om/Uredbom – provjeriti s nadležnim tijelom«; nikad ne izmišlja.
- Odgovara samo na pitanja o ZKS-u, Uredbi, mjerama, kontrolama, incidentima, rokovima, kaznama i nadležnim tijelima. Privatni razgovor zanemaruje.
- Uzima u obzir kontekst iz ranijeg dijela razgovora (sektor, broj zaposlenih, ključni ili važni subjekt, razina mjera). Ako odgovor ovisi o nečemu što nije rečeno, kaže to kratko (»ako ste ključni subjekt…«).
- Stil: kratko, sigurno, za usmeno izgovaranje; brojke i rokovi točni; uvijek navodi članak ili mjeru.

## Tehnička izvedba
**Novi direktorij `ai-worker/` u repozitoriju** (TypeScript, `@anthropic-ai/sdk`):
- `src/index.ts`: `POST /odgovor`.
  - Provjerava pristupni token (zaseban od lozinke aplikacije) i dopušta CORS samo za `https://matawww.github.io`.
  - Ograničava broj upita (npr. 20/min, 300/dan).
  - Poziva `client.messages.stream()`:
    - model **`claude-opus-5-5`**, `output_config.effort: "low"` (brzina; Q&A ne treba duboko razmišljanje);
    - `max_tokens` ~1500;
    - baza znanja u `system` s `cache_control` (TTL 1 h tijekom sastanka);
    - `betas: ["server-side-fallback-2026-07-01"]` + `fallbacks: "default"` za slučaj odbijanja.
  - Tekst se prosljeđuje pregledniku kao SSE stream; provjerava se `stop_reason` (`refusal`, `max_tokens`).
- `scripts/build-znanje.mjs`: iz lokalnog `izvor/` i izvučenih tekstova PDF-ova sastavlja `znanje.txt`. Datoteka je u `.gitignore` i u Worker ide pri `wrangler deploy`, ne u javni repozitorij.
- `wrangler.toml`: API ključ kao **secret** (`wrangler secret put ANTHROPIC_API_KEY`), nikad u kodu.

**`assets/app.js`** (stranica Slušaj):
- prekidač »🤖 AI odgovori« i polje za pristupni token (sprema se kao i ključ aplikacije);
- logika okidanja i odgode (debounce), kartica AI odgovora sa streamingom;
- izvori u odgovoru (npr. »čl. 37.«, »mjera 12.4«) pretvaraju se u poveznice preko postojećih `artMap()`, `srcHref()`;
- poruke o greškama: nema mreže, prekoračen limit, istekao token.

## Trošak (procjena)
- Predmemorirana baza ~150k tokena × $0,20 / 1M ≈ **$0,03** po upitu, plus izlaz ~500 tokena × $20 / 1M ≈ $0,01. Upis u predmemoriju je jednom po sastanku (≈ $1,20 uz TTL od 1 h).
- **Sastanak od 1 h s ~20 pitanja ≈ $1,5–2.** Cloudflare Worker: besplatno.
- U Anthropic Consoleu postavlja se **mjesečni limit potrošnje**.
- Ako bude prespor ili preskup, može se prijeći na Claude Sonnet 5.5 ili Haiku 5.5. To je vaša odluka; zadano je Opus 5.5.

## Sigurnost i privatnost
- API ključ samo u Cloudflare secretima. Pristupni token za aplikaciju može se opozvati promjenom u Workeru.
- Šalje se samo **tekst**, i to samo kad lokalni filtar procijeni da je razgovor stručan (privatni razgovor ne odlazi nikamo).
- Transkript se ne sprema ni u aplikaciji ni u Workeru (nema logiranja sadržaja).
- Podaci poslani Anthropicu obrađuju se prema uvjetima komercijalnog API-ja.
- Napomena u aplikaciji: sudionike sastanka treba obavijestiti (GDPR).

## Što trebate napraviti vi (jednokratno, ~15 min)
1. Račun na **console.anthropic.com** → API ključ + limit potrošnje.
2. Besplatan račun na **Cloudflareu**.
3. Pokrenuti 3 naredbe koje pripremim (`npm install`, `wrangler secret put ANTHROPIC_API_KEY`, `wrangler deploy`) i dobiveni URL Workera upisati u aplikaciju.

   Alternativa: ključ preko sigurnog obrasca u ovoj sesiji, pa deploy radim ja (ako Cloudflare to dopušta iz ovog okruženja).

## Provjera
- Lokalno: `wrangler dev` + preglednik (Playwright) s probnim tekstom. Bez stvarnog ključa test koristi lažni odgovor (mock) za stream i prikaz.
- S ključem: 20 testnih razgovora (privatno + stručno, s kontekstom »imamo 300 zaposlenih u energetici… koja je mjera 12 za nas?«). Provjerava se:
  - relevantnost: privatno → nema odgovora;
  - točnost izvora (članak/mjera postoji, brojke odgovaraju bazi);
  - vrijeme do prvih riječi < 4 s;
  - trošak po upitu iz `usage` (cache read > 0 od drugog upita).
- Postojeći testovi lokalnog sloja (`t4`–`t7`) i dalje prolaze.
