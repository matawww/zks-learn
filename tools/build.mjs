#!/usr/bin/env node
// Šifrira sadržaj aplikacije u data/content.enc.json (AES-256-GCM, ključ iz lozinke: PBKDF2-SHA256).
//
//   ZKS_LOZINKA='…' node tools/build.mjs            – sastavi izvor/index.mjs, provjeri i šifriraj
//   ZKS_LOZINKA='…' node tools/build.mjs --json f    – šifriraj sadržaj iz JSON datoteke f
//   ZKS_LOZINKA='…' node tools/build.mjs decrypt [f] – dešifriraj postojeći sadržaj u JSON (zadano: izvor-vraceno.json)
//   node tools/build.mjs check                       – samo provjera izvora, bez šifriranja
import { webcrypto as crypto } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'content.enc.json');
const ITER = 310000;
const args = process.argv.slice(2);
const mode = args[0] === 'decrypt' || args[0] === 'check' ? args[0] : 'build';

const b64 = (buf) => Buffer.from(buf).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

async function keyFrom(password, salt, usage) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, base, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

function password() {
  const p = process.env.ZKS_LOZINKA;
  if (!p || p.length < 10) { console.error('Postavite varijablu ZKS_LOZINKA (najmanje 10 znakova).'); process.exit(1); }
  return p;
}

function validate(data) {
  const errors = [];
  const ids = new Set();
  const quizCheck = (where, kviz) => (kviz || []).forEach((q, i) => {
    if (!Array.isArray(q.o) || q.a < 0 || q.a >= q.o.length) errors.push(`${where}: pitanje ${i + 1} ima neispravan odgovor`);
  });
  for (const part of data.dijelovi) for (const s of part.sekcije) {
    if (ids.has(s.id)) errors.push(`Dvostruki id ${s.id}`);
    ids.add(s.id);
    if (!s.sazetak) errors.push(`${s.id}: nema sažetka`);
    if (!s.kviz || s.kviz.length < 4) errors.push(`${s.id}: premalo pitanja`);
    quizCheck(s.id, s.kviz);
  }
  const counts = [{ A: 0, B: 0, C: 0 }, { A: 0, B: 0, C: 0 }, { A: 0, B: 0, C: 0 }];
  let subs = 0;
  data.mjere.forEach((m, i) => {
    if (m.broj !== i + 1) errors.push(`Mjera ${m.broj} nije na mjestu ${i + 1}`);
    quizCheck('mjera ' + m.broj, m.kviz);
    m.podskupovi.forEach((p, j) => {
      subs++;
      if (p.id !== `${m.broj}.${j + 1}`) errors.push(`Podskup ${p.id} očekivan kao ${m.broj}.${j + 1}`);
      p.r.forEach((x, l) => { counts[l][x]++; });
      if (p.r.includes('B') && !p.uvjet) errors.push(`Podskup ${p.id} ima B bez uvjeta`);
    });
  });
  // poveznice #/s/… i #/m/…
  const all = JSON.stringify(data);
  for (const m of all.matchAll(/#\/s\/([a-z0-9]+)/g)) if (!ids.has(m[1])) errors.push(`Neispravna poveznica #/s/${m[1]}`);
  for (const m of all.matchAll(/#\/m\/(\d+)/g)) if (Number(m[1]) < 1 || Number(m[1]) > data.mjere.length) errors.push(`Neispravna poveznica #/m/${m[1]}`);
  const nq = data.dijelovi.flatMap((p) => p.sekcije).reduce((s, x) => s + x.kviz.length, 0) + data.mjere.reduce((s, m) => s + m.kviz.length, 0);
  console.log(`Cjeline: ${ids.size}, mjere: ${data.mjere.length}, podskupova: ${subs}, pitanja: ${nq}`);
  ['osnovna', 'srednja', 'napredna'].forEach((l, i) => console.log(`  ${l}: A=${counts[i].A} B=${counts[i].B} C=${counts[i].C}`));
  if (errors.length) { console.error('GREŠKE:\n' + errors.join('\n')); process.exit(1); }
}

async function loadSource() {
  const j = args.indexOf('--json');
  if (j >= 0) return JSON.parse(await readFile(path.resolve(args[j + 1]), 'utf8'));
  return (await import(pathToFileURL(path.join(ROOT, 'izvor', 'index.mjs')).href)).default;
}

if (mode === 'decrypt') {
  const blob = JSON.parse(await readFile(OUT, 'utf8'));
  const key = await keyFrom(password(), unb64(blob.salt), 'decrypt');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
  const target = path.resolve(args[1] || 'izvor-vraceno.json');
  await writeFile(target, JSON.stringify(JSON.parse(new TextDecoder().decode(pt)), null, 2));
  console.log('Dešifrirano u', target);
} else {
  const data = await loadSource();
  validate(data);
  if (mode === 'check') process.exit(0);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(password(), salt, 'encrypt');
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)));
  await writeFile(OUT, JSON.stringify({ v: 1, alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
  console.log('Zapisano', path.relative(ROOT, OUT));
}
