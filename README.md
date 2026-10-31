# ZKS + Uredba – aplikacija za učenje

Web-aplikacija za učenje Zakona o kibernetičkoj sigurnosti (NN 14/2024) i Uredbe o kibernetičkoj sigurnosti (NN 135/2024).

- 17 cjelina Zakona i 13 cjelina Uredbe, svaka s objašnjenjem, **sažetkom za klijente** i provjerom znanja
- 13 mjera iz Priloga II. Uredbe (99 podskupova) s raspodjelom A/B/C po razinama
- alati: procjena je li subjekt obveznik, značajan incident i rokovi prijave, kontrolna lista mjera po razini
- **katalog kontrola** iz Priloga B ZSIS-a (137 kontrola, pragovi po razini, napredno pretraživanje, kalkulator ocjene podmjere)
- pregled svih rokova, pojmovnik, završni ispit, pretraživanje, praćenje napretka

## Zaštita lozinkom

Sav sadržaj nalazi se u `data/content.enc.json`, šifriran algoritmom AES-256-GCM (ključ iz lozinke, PBKDF2-SHA256, 310 000 iteracija).
Stranica se otključava isključivo u pregledniku; bez lozinke ni izvorni kod ne otkriva sadržaj.
Nešifrirani izvor (`izvor/`) nije dio repozitorija.

## Objava (GitHub Pages)

Settings → Pages → Source: *Deploy from a branch* → grana `main`, mapa `/ (root)`.

## Izmjena sadržaja ili lozinke

```bash
# vraćanje izvora iz šifrirane datoteke
ZKS_LOZINKA='stara-lozinka' node tools/build.mjs decrypt izvor-vraceno.json
# ponovno šifriranje (nova lozinka)
ZKS_LOZINKA='nova-lozinka' node tools/build.mjs --json izvor-vraceno.json
```

Ako postoji mapa `izvor/` (izvorni .mjs moduli): `ZKS_LOZINKA='…' node tools/build.mjs`.

Sadržaj je edukativni sažetak; pravno su mjerodavni tekstovi objavljeni u Narodnim novinama.
