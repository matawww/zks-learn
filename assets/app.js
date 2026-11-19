/* ZKS + Uredba – aplikacija za učenje.
   Sadržaj se nalazi u data/content.enc.json (AES-256-GCM, ključ iz lozinke putem PBKDF2-SHA256). */
(() => {
  'use strict';

  const KEY_STORE = 'zks.key';
  const PROGRESS_STORE = 'zks.progress';
  const THEME_STORE = 'zks.theme';
  const CHECK_STORE = 'zks.checklist';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const strip = (html) => { const d = document.createElement('div'); d.innerHTML = html || ''; return d.textContent.replace(/\s+/g, ' ').trim(); };
  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* nedostupno */ } },
  };

  let DATA = null;
  let FLAT = [];     // redoslijed svih stranica za navigaciju (sekcije + mjere)
  let INDEX = [];    // indeks za pretraživanje

  /* ---------------- Tema ---------------- */
  const applyTheme = (t) => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
  applyTheme(store.get(THEME_STORE, null));

  /* ---------------- Kriptografija ---------------- */
  const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const b64e = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

  async function deriveKey(password, salt, iter) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base,
      { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  }
  async function decryptWith(key, blob) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(blob.iv) }, key, b64d(blob.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  async function loadBlob() {
    const r = await fetch('data/content.enc.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('Datoteka sa sadržajem nije dostupna.');
    return r.json();
  }
  function savedKey() {
    try { return sessionStorage.getItem(KEY_STORE) || localStorage.getItem(KEY_STORE); } catch { return null; }
  }
  function forgetKey() {
    try { sessionStorage.removeItem(KEY_STORE); localStorage.removeItem(KEY_STORE); } catch { /* */ }
  }

  async function unlock(password, remember) {
    const blob = await loadBlob();
    let key;
    if (password == null) {
      const raw = savedKey();
      if (!raw) return false;
      key = await crypto.subtle.importKey('raw', b64d(raw), 'AES-GCM', false, ['decrypt']);
    } else {
      key = await deriveKey(password, b64d(blob.salt), blob.iter);
    }
    DATA = await decryptWith(key, blob);
    if (password != null) {
      const raw = b64e(await crypto.subtle.exportKey('raw', key));
      try {
        sessionStorage.setItem(KEY_STORE, raw);
        if (remember) localStorage.setItem(KEY_STORE, raw);
      } catch { /* */ }
    }
    return true;
  }

  /* ---------------- Pokretanje ---------------- */
  const gateForm = $('#gate-form');
  gateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#gate-btn');
    btn.disabled = true; btn.textContent = 'Otključavam…'; $('#gate-err').textContent = '';
    try {
      await unlock($('#pw').value, $('#remember').checked);
      start();
    } catch (err) {
      $('#gate-err').textContent = err && err.name === 'OperationError' ? 'Pogrešna lozinka.' : (err.message || 'Greška pri otključavanju.');
    } finally {
      btn.disabled = false; btn.textContent = 'Otključaj';
    }
  });

  (async () => {
    try { if (await unlock(null)) start(); } catch { forgetKey(); }
  })();

  function start() {
    $('#gate').hidden = true;
    $('#app').hidden = false;
    buildFlat();
    buildIndex();
    renderSidebar();
    window.addEventListener('hashchange', route);
    route();
  }

  $('#lock-btn').addEventListener('click', () => { forgetKey(); location.hash = ''; location.reload(); });
  $('#theme-btn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    applyTheme(next); store.set(THEME_STORE, next);
  });
  $('#menu-btn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

  /* ---------------- Struktura ---------------- */
  function buildFlat() {
    FLAT = [];
    for (const part of DATA.dijelovi) {
      for (const s of part.sekcije) {
        FLAT.push({ type: 's', id: s.id, part, sec: s, title: s.naslov });
        if (s.nakon === 'mjere') {
          for (const m of DATA.mjere) FLAT.push({ type: 'm', id: 'm' + m.broj, part, mjera: m, title: `Mjera ${m.broj}. ${m.naziv}` });
        }
      }
    }
  }
  const hrefOf = (f) => (f.type === 'm' ? `#/m/${f.mjera.broj}` : `#/s/${f.id}`);

  function buildIndex() {
    INDEX = [];
    for (const f of FLAT) {
      if (f.type === 's') {
        INDEX.push({ href: hrefOf(f), title: f.title, sub: `${f.part.kratko} · ${f.sec.clanci || ''}`, text: strip(f.sec.html + ' ' + f.sec.sazetak) });
      } else {
        const m = f.mjera;
        INDEX.push({ href: hrefOf(f), title: f.title, sub: 'Uredba, Prilog II.', text: strip(m.cilj + ' ' + m.sazetak) });
        for (const p of m.podskupovi) INDEX.push({ href: `${hrefOf(f)}?p=${p.id}`, title: `${p.id} ${p.naziv}`, sub: `Mjera ${m.broj}. ${m.naziv}`, text: strip(p.opis) });
      }
    }
    for (const g of DATA.glosar) INDEX.push({ href: '#/glosar', title: g.pojam, sub: 'Pojmovnik', text: strip(g.opis) });
    for (const c of controls()) {
      INDEX.push({ href: `#/kontrole?q=${c.id}`, title: `${c.id} – ${c.label}`, sub: 'Katalog kontrola (Prilog B)', boost: 1,
        text: 'Koristi se u podmjerama: ' + c.uses.map((u) => `${u.pid} ${u.naziv}`).join('; ') });
    }
  }

  function progress() { return store.get(PROGRESS_STORE, {}); }
  function setProgress(id, patch) { const p = progress(); p[id] = { ...(p[id] || {}), ...patch }; store.set(PROGRESS_STORE, p); }

  function renderSidebar() {
    const p = progress();
    const mark = (id) => (p[id] && p[id].best >= 80 ? '<span class="done" title="Provjera položena">✓</span>' : '');
    let h = `<a href="#/">Početna</a>
      <h3>Brzo učenje</h3>
      <a href="#/brzo" data-id="brzo"><span class="num">⚡</span><span>Danas</span></a>
      <a href="#/brzo/kartice" data-id="brzo-kartice"><span class="num">🃏</span><span>Kartice za ponavljanje</span>${dueCount() ? `<span class="done badge">${dueCount()}</span>` : ''}</a>
      <a href="#/brzo/brojke" data-id="brzo-brojke"><span class="num">#</span><span>Brojke napamet</span></a>
      <a href="#/slusaj" data-id="slusaj"><span class="num">🎙</span><span>Slušaj sastanak</span></a>`;
    for (const part of DATA.dijelovi) {
      h += `<h3>${esc(part.kratko)}</h3>`;
      for (const s of part.sekcije) {
        h += `<a href="#/s/${s.id}" data-id="${s.id}"><span class="num">${esc(s.oznaka || '')}</span><span>${esc(s.naslov)}</span>${mark(s.id)}</a>`;
        if (s.nakon === 'mjere') {
          h += '<h3>Uredba – 13 mjera (Prilog II.)</h3>';
          for (const m of DATA.mjere) {
            h += `<a href="#/m/${m.broj}" data-id="m${m.broj}"><span class="num">M${m.broj}</span><span>${esc(m.naziv)}</span>${mark('m' + m.broj)}</a>`;
          }
          h += '<h3>Uredba – nastavak</h3>';
        }
      }
    }
    h += `<h3>Alati i pregledi</h3>
      <a href="#/alat/kategorizacija" data-id="alat-kat"><span class="num">⚙</span><span>Je li subjekt obveznik?</span></a>
      <a href="#/alat/incident" data-id="alat-inc"><span class="num">⏱</span><span>Značajan incident i rokovi prijave</span></a>
      <a href="#/alat/checklista" data-id="alat-chk"><span class="num">☑</span><span>Kontrolna lista mjera po razini</span></a>
      <a href="#/rokovi" data-id="rokovi"><span class="num">📅</span><span>Svi rokovi na jednom mjestu</span></a>
      <a href="#/glosar" data-id="glosar"><span class="num">📖</span><span>Pojmovnik</span></a>
      <a href="#/ispit" data-id="ispit"><span class="num">🎓</span><span>Završni ispit</span></a>
      <h3>Samoprocjena (ZSIS)</h3>
      <a href="#/kontrole" data-id="kontrole"><span class="num">🔎</span><span>Katalog kontrola (Prilog B)</span></a>`;
    $('#sidebar').innerHTML = h;
  }

  function setActive(id) {
    $$('#sidebar a').forEach((a) => a.classList.toggle('active', a.dataset.id === id));
    $('#sidebar').classList.remove('open');
  }

  /* ---------------- Usmjeravanje ---------------- */
  function route() {
    const hash = location.hash.replace(/^#\/?/, '');
    const [path, query] = hash.split('?');
    const params = new URLSearchParams(query || '');
    const parts = path.split('/').filter(Boolean);
    const main = $('#main');
    if (parts[0] !== 'slusaj') stopListening();
    window.scrollTo(0, 0);
    if (!parts.length) { renderHome(main); setActive(''); }
    else if (parts[0] === 's') renderSection(main, parts[1]);
    else if (parts[0] === 'm') renderMjera(main, Number(parts[1]), params.get('p'));
    else if (parts[0] === 'alat' && parts[1] === 'kategorizacija') { renderKat(main); setActive('alat-kat'); }
    else if (parts[0] === 'alat' && parts[1] === 'incident') { renderIncident(main); setActive('alat-inc'); }
    else if (parts[0] === 'alat' && parts[1] === 'checklista') { renderChecklist(main); setActive('alat-chk'); }
    else if (parts[0] === 'rokovi') { renderRokovi(main); setActive('rokovi'); }
    else if (parts[0] === 'glosar') { renderGlosar(main); setActive('glosar'); }
    else if (parts[0] === 'ispit') { renderIspit(main); setActive('ispit'); }
    else if (parts[0] === 'kontrole') { renderKontrole(main, params); setActive('kontrole'); }
    else if (parts[0] === 'slusaj') { renderSlusaj(main); setActive('slusaj'); }
    else if (parts[0] === 'brzo' && parts[1] === 'kartice') { renderKartice(main, params); setActive('brzo-kartice'); }
    else if (parts[0] === 'brzo' && parts[1] === 'brojke') { renderBrojke(main); setActive('brzo-brojke'); }
    else if (parts[0] === 'brzo') { renderBrzo(main, parts[1] === 'lekcija' ? Number(parts[2]) : null); setActive('brzo'); }
    else renderHome(main);
    main.focus({ preventScroll: true });
    if (params.get('h') && parts[0] !== 'kontrole') applyPageHighlight(main, params.get('h'), !params.get('p'));
  }

  /* ---------------- Početna ---------------- */
  function renderHome(main) {
    const p = progress();
    const cards = DATA.dijelovi.map((part) => {
      const ids = FLAT.filter((f) => f.part === part).map((f) => f.id);
      const done = ids.filter((id) => p[id] && p[id].best >= 80).length;
      const pct = Math.round((done / ids.length) * 100);
      const first = FLAT.find((f) => f.part === part);
      return `<div class="card"><h3>${esc(part.naslov)}</h3><p class="legend">${esc(part.opis)}</p>
        <div class="progress"><span style="width:${pct}%"></span></div>
        <p class="legend">Položene provjere: ${done} / ${ids.length}</p>
        <a class="btn primary" href="${hrefOf(first)}">Počni učiti</a></div>`;
    }).join('');
    main.innerHTML = `
      <h1>Učenje: Zakon i Uredba o kibernetičkoj sigurnosti</h1>
      <p class="art">${esc(DATA.meta.podnaslov)}</p>
      ${todayCard()}
      <div class="content">${DATA.meta.uvod}</div>
      <h2>Napredak</h2>
      <div class="grid">${cards}</div>
      <h2>Alati za rad s klijentima</h2>
      <div class="grid">
        <a class="card stretch" href="#/alat/kategorizacija"><h3>Je li subjekt obveznik?</h3><p class="legend">Brza procjena: ključni, važni ili izvan obveza, uz pozive na članke.</p></a>
        <a class="card stretch" href="#/alat/incident"><h3>Značajan incident i rokovi</h3><p class="legend">Kriteriji iz Uredbe i izračun rokova 24 h / 72 h / 30 dana.</p></a>
        <a class="card stretch" href="#/alat/checklista"><h3>Kontrolna lista mjera</h3><p class="legend">Sve obvezne podmjere za osnovnu, srednju ili naprednu razinu – za ispis.</p></a>
        <a class="card stretch" href="#/kontrole"><h3>Katalog kontrola (ZSIS)</h3><p class="legend">137 kontrola iz Priloga B s pragovima po razini, pretraživanjem i kalkulatorom ocjene.</p></a>
        <a class="card stretch" href="#/rokovi"><h3>Svi rokovi</h3><p class="legend">Pregled svih rokova iz Zakona i Uredbe.</p></a>
      </div>
      <h2>Kako učiti</h2>
      <div class="content"><ol>
        <li>Prođite cjeline redom. Svaka ima <b>detaljno objašnjenje</b> s pozivima na članke, <b>sažetak za klijente</b> i <b>provjeru znanja</b>.</li>
        <li>Provjera se smatra položenom s rezultatom od najmanje 80 % (oznaka ✓ u izborniku).</li>
        <li>Sažetke možete kopirati gumbom i koristiti u komunikaciji s klijentima.</li>
        <li>Na kraju riješite <a href="#/ispit">završni ispit</a> s nasumičnim pitanjima.</li>
      </ol></div>`;
  }

  /* ---------------- Sekcija ---------------- */
  function pager(id) {
    const i = FLAT.findIndex((f) => f.id === id);
    const prev = FLAT[i - 1], next = FLAT[i + 1];
    return `<div class="pager">
      ${prev ? `<a class="btn" href="${hrefOf(prev)}">← ${esc(prev.title)}</a>` : '<span></span>'}
      ${next ? `<a class="btn primary" href="${hrefOf(next)}">${esc(next.title)} →</a>` : ''}
    </div>`;
  }

  function summaryBox(html, title = 'Sažetak za klijente') {
    return `<section class="summary"><div class="summary-head"><h2>${title}</h2>
      <button class="btn no-print" data-copy>Kopiraj sažetak</button></div>
      <div class="content summary-body">${html}</div></section>`;
  }

  function bindCopy(root) {
    $$('[data-copy]', root).forEach((b) => b.addEventListener('click', async () => {
      const body = b.closest('.summary').querySelector('.summary-body');
      const text = body.innerText.trim();
      try { await navigator.clipboard.writeText(text); toast('Sažetak je kopiran.'); }
      catch { toast('Kopiranje nije uspjelo – označite tekst ručno.'); }
    }));
  }

  function toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2200);
  }

  function renderSection(main, id) {
    const f = FLAT.find((x) => x.id === id && x.type === 's');
    if (!f) return renderHome(main);
    const s = f.sec;
    setActive(id);
    main.innerHTML = `
      <div class="crumb">${esc(f.part.naslov)}</div>
      <h1>${esc(s.naslov)}</h1>
      <div class="art">${esc(s.clanci || '')}</div>
      <div class="content">${s.html}</div>
      ${summaryBox(s.sazetak)}
      ${quizBlock(id, s.kviz)}
      ${pager(id)}`;
    bindCopy(main); bindQuiz(main, id, s.kviz);
  }

  /* ---------------- Mjera ---------------- */
  const LV = ['osnovna', 'srednja', 'napredna'];
  function renderMjera(main, n, focusId) {
    const m = DATA.mjere.find((x) => x.broj === n);
    if (!m) return renderHome(main);
    const id = 'm' + n;
    setActive(id);
    const rows = m.podskupovi.map((p) => `<tr><td><a href="#/m/${n}?p=${p.id}">${p.id}</a></td><td>${esc(p.naziv)}</td>${p.r.map((x) => `<td><span class="lvl lvl-${x}">${x}</span></td>`).join('')}</tr>`).join('');
    const subs = m.podskupovi.map((p) => `
      <div class="sub" id="p-${p.id.replace(/\./g, '-')}" data-r="${p.r.join('')}">
        <div class="sub-head"><span class="sub-id">${p.id}</span><span class="sub-name">${esc(p.naziv)}</span>
          <span class="sub-lv">${p.r.map((x, i) => `<span><small>${LV[i][0].toUpperCase()}</small><span class="lvl lvl-${x}">${x}</span></span>`).join('')}</span></div>
        <div class="content">${p.opis}</div>
        ${p.uvjet ? `<div class="cond"><b>UVJET:</b> ${p.uvjet}</div>` : ''}
        ${kontroleBlock(p.id)}
      </div>`).join('');
    main.innerHTML = `
      <div class="crumb">Uredba o kibernetičkoj sigurnosti · Prilog II. · Mjere upravljanja kibernetičkim sigurnosnim rizicima</div>
      <h1>Mjera ${m.broj}. ${esc(m.naziv)}</h1>
      <div class="art">Uredba, Prilog II., točka ${m.broj}. · ${m.podskupovi.length} podskupova mjera (${m.podskupovi[0].id} – ${m.podskupovi[m.podskupovi.length - 1].id})</div>
      <div class="key"><b>Cilj mjere:</b> ${m.cilj}</div>
      ${m.uvod ? `<div class="content">${m.uvod}</div>` : ''}
      <h2>Raspodjela po razinama</h2>
      <p class="legend"><span class="lvl lvl-A">A</span> obvezno · <span class="lvl lvl-B">B</span> obvezno pod uvjetom (»UVJET«) · <span class="lvl lvl-C">C</span> dobrovoljno (preporuka ovisno o procjeni rizika) – Uredba čl. 44.–45.</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Oznaka</th><th>Podskup mjere</th><th>Osnovna</th><th>Srednja</th><th>Napredna</th></tr></thead><tbody>${rows}</tbody></table></div>
      <h2>Podskupovi mjere</h2>
      <div class="filterbar no-print"><span class="legend">Istakni obveze za razinu:</span>
        <button class="btn on" data-lv="-1">Sve</button>${LV.map((l, i) => `<button class="btn" data-lv="${i}">${l}</button>`).join('')}</div>
      ${subs}
      <h2>Primjena na IT i OT sustave</h2>
      <div class="content">${m.itot}</div>
      ${m.napomene ? `<h2>Napomene za praksu</h2><div class="content">${m.napomene}</div>` : ''}
      ${summaryBox(m.sazetak)}
      ${quizBlock(id, m.kviz)}
      ${pager(id)}`;
    $$('.filterbar .btn', main).forEach((b) => b.addEventListener('click', () => {
      $$('.filterbar .btn', main).forEach((x) => x.classList.toggle('on', x === b));
      const lv = Number(b.dataset.lv);
      $$('.sub', main).forEach((el) => el.classList.toggle('dim', lv >= 0 && el.dataset.r[lv] === 'C'));
    }));
    bindCopy(main); bindQuiz(main, id, m.kviz); bindCalc(main);
    if (focusId) {
      const el = document.getElementById('p-' + focusId.replace(/\./g, '-'));
      if (el) { el.scrollIntoView({ block: 'start' }); el.style.outline = '2px solid var(--accent)'; }
    }
  }

  /* ---------------- Kviz ---------------- */
  function quizBlock(id, kviz, title = 'Provjera znanja') {
    if (!kviz || !kviz.length) return '';
    const best = id ? (progress()[id] || {}).best : null;
    // ponuđeni odgovori miješaju se pri svakom prikazu; točan odgovor bilježi se u data-a
    const qs = kviz.map((q, qi) => {
      const order = shuffle(q.o.map((_, i) => i));
      return `
      <div class="q" data-a="${order.indexOf(q.a)}"><div class="q-title">${qi + 1}. ${q.q}</div>
        ${order.map((oi, pos) => `<label><input type="radio" name="${id}-q${qi}" value="${pos}"><span>${q.o[oi]}</span></label>`).join('')}
        <div class="expl">${q.obj || ''}</div></div>`;
    }).join('');
    return `<section class="quiz" id="quiz"><h2>${title}</h2>
      ${best != null ? `<p class="legend">Dosadašnji najbolji rezultat: ${best} %</p>` : ''}
      ${qs}
      <div class="form-row"><button class="btn primary" data-check>Provjeri odgovore</button><button class="btn" data-reset>Ponovi</button></div>
      <div class="score" aria-live="polite"></div></section>`;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }

  function bindQuiz(root, id, kviz) {
    const sec = $('.quiz', root); if (!sec) return;
    $('[data-check]', sec).addEventListener('click', () => {
      let ok = 0;
      $$('.q', sec).forEach((qel) => {
        const a = Number(qel.dataset.a);
        const sel = $('input:checked', qel);
        $$('label', qel).forEach((l, oi) => {
          l.classList.remove('correct', 'wrong');
          if (oi === a) l.classList.add('correct');
          else if (sel && Number(sel.value) === oi) l.classList.add('wrong');
        });
        if (sel && Number(sel.value) === a) ok++;
        qel.classList.add('checked');
      });
      const pct = Math.round((ok / kviz.length) * 100);
      const sc = $('.score', sec);
      sc.className = 'score ' + (pct >= 80 ? 'good' : pct >= 50 ? 'mid' : 'low');
      sc.textContent = `Rezultat: ${ok} / ${kviz.length} (${pct} %)` + (pct >= 80 ? ' – položeno.' : ' – pročitajte objašnjenja i pokušajte ponovno.');
      if (id) {
        const prev = (progress()[id] || {}).best || 0;
        if (pct > prev) setProgress(id, { best: pct });
        renderSidebar(); setActive(id);
      }
    });
    $('[data-reset]', sec).addEventListener('click', () => {
      $$('.q', sec).forEach((qel) => { qel.classList.remove('checked'); $$('label', qel).forEach((l) => l.classList.remove('correct', 'wrong')); $$('input', qel).forEach((i) => { i.checked = false; }); });
      $('.score', sec).textContent = '';
    });
  }

  /* ---------------- Pretraživanje ---------------- */
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  // grubo korjenovanje za hrvatske padeže (lozinke → lozink, dobavljača → dobavljač)
  const stem = (t) => {
    if (t.length < 5 || /\d/.test(t)) return t;
    let s = t.replace(/(ama|ima|ovi|ova|ove|om|em|ih|im|og|oj|ju)$/, '');
    if (s === t) s = t.replace(/[aeiou]$/, '');
    return s.length >= 4 ? s : t;
  };
  const termsOf = (q) => norm(q).split(/\s+/).filter(Boolean).map(stem);
  const has = (hay, t) => hay.includes(t);

  // normalizira tekst znak po znak i pamti položaj svakog znaka u izvorniku
  function normMap(s) {
    let n = ''; const idx = [];
    for (let i = 0; i < s.length; i++) for (const ch of norm(s[i])) { n += ch; idx.push(i); }
    return { n, idx };
  }
  function findRanges(s, terms) {
    const { n, idx } = normMap(s);
    const r = [];
    for (const t of terms) {
      for (let p = n.indexOf(t); p >= 0; p = n.indexOf(t, p + t.length)) {
        let e = idx[p + t.length - 1] + 1;
        while (e < s.length && /[\p{L}]/u.test(s[e]) && e - idx[p] < t.length + 4) e++; // do kraja riječi (nastavak)
        r.push([idx[p], e]);
      }
    }
    r.sort((a, b) => a[0] - b[0]);
    const m = [];
    for (const x of r) { const last = m[m.length - 1]; if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]); else m.push([...x]); }
    return m;
  }
  // HTML iz običnog teksta s istaknutim pojmovima
  function hl(s, terms) {
    s = String(s ?? '');
    if (!terms || !terms.length) return esc(s);
    let out = '', at = 0;
    for (const [a, b] of findRanges(s, terms)) { out += esc(s.slice(at, a)) + '<mark>' + esc(s.slice(a, b)) + '</mark>'; at = b; }
    return out + esc(s.slice(at));
  }
  // isječak oko prvog pogotka
  function snippet(s, terms, len = 180) {
    const r = findRanges(s, terms);
    const start = r.length ? Math.max(0, r[0][0] - 60) : 0;
    const part = s.slice(start, start + len);
    return (start > 0 ? '…' : '') + hl(part, terms) + (start + len < s.length ? '…' : '');
  }
  // ističe pojmove izravno u prikazanoj stranici; vraća broj pogodaka
  function highlightIn(root, terms) {
    if (!terms.length) return 0;
    const skip = /^(SCRIPT|STYLE|MARK|INPUT|TEXTAREA|SELECT|OPTION|BUTTON)$/;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue.trim() && !skip.test(n.parentNode.nodeName) && !n.parentNode.closest('.hlbar') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    let count = 0;
    for (const node of nodes) {
      const s = node.nodeValue, ranges = findRanges(s, terms);
      if (!ranges.length) continue;
      const frag = document.createDocumentFragment(); let at = 0;
      for (const [a, b] of ranges) {
        frag.append(s.slice(at, a));
        const mk = document.createElement('mark'); mk.className = 'hit'; mk.textContent = s.slice(a, b); frag.append(mk);
        at = b; count++;
      }
      frag.append(s.slice(at));
      node.parentNode.replaceChild(frag, node);
    }
    return count;
  }
  function applyPageHighlight(main, q, scroll) {
    // najprije cijeli izraz; ako ga nema, pojedinačne riječi
    const phrase = norm(q.trim());
    let n = /\s/.test(phrase) && normMap(main.textContent).n.includes(phrase) ? highlightIn(main, [phrase]) : 0;
    if (!n) n = highlightIn(main, termsOf(q));
    // otvori sklopljene dijelove kako bi pogoci bili vidljivi
    $$('details', main).forEach((d) => { if (d.querySelector('mark.hit')) d.open = true; });
    const bar = document.createElement('div');
    bar.className = 'hlbar no-print';
    bar.innerHTML = n
      ? `<span>Istaknuto <b>»${esc(q)}«</b>: ${n} ${pl(n, 'pogodak', 'pogotka', 'pogodaka')}</span> <button class="btn" data-hl="prev">↑</button><button class="btn" data-hl="next">↓ Sljedeći</button><button class="btn" data-hl="off">Ukloni oznake</button>`
      : `<span>Pojam <b>»${esc(q)}«</b> nije pronađen na ovoj stranici.</span> <button class="btn" data-hl="off">Zatvori</button>`;
    main.prepend(bar);
    const marks = $$('mark.hit', main);
    let cur = -1;
    const go = (d) => {
      if (!marks.length) return;
      if (cur >= 0) marks[cur].classList.remove('cur');
      cur = (cur + d + marks.length) % marks.length;
      marks[cur].classList.add('cur');
      marks[cur].scrollIntoView({ block: 'center' });
    };
    bar.addEventListener('click', (e) => {
      const a = e.target.dataset.hl; if (!a) return;
      if (a === 'next') go(1); else if (a === 'prev') go(-1);
      else { marks.forEach((m) => m.replaceWith(document.createTextNode(m.textContent))); main.normalize(); bar.remove(); }
    });
    if (scroll && marks.length) go(1);
  }

  const searchEl = $('#search'), resEl = $('#search-results');
  let searchTimer;
  searchEl.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(doSearch, 150); });
  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { resEl.hidden = true; searchEl.blur(); }
    if (e.key === 'Enter') { const a = $('a[href]', resEl); if (a) { location.hash = a.getAttribute('href'); resEl.hidden = true; searchEl.value = ''; } }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search-wrap')) resEl.hidden = true; });
  resEl.addEventListener('click', (e) => { if (e.target.closest('a')) { resEl.hidden = true; searchEl.value = ''; } });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.nodeName) && !$('#app').hidden) {
      e.preventDefault(); ($('#kq') || searchEl).focus();
    }
  });

  function doSearch() {
    const q = searchEl.value.trim();
    if (q.length < 2) { resEl.hidden = true; return; }
    const terms = termsOf(q);
    const phrase = norm(q);
    const out = [];
    for (const it of INDEX) {
      const hay = norm(it.title + ' ' + it.text);
      if (!terms.every((t) => hay.includes(t))) continue;
      const score = terms.reduce((s, t) => s + (norm(it.title).includes(t) ? 5 : 0), 0) + (it.boost || 0) + (hay.includes(phrase) ? 8 : 0);
      out.push({ it, score });
    }
    out.sort((a, b) => b.score - a.score);
    const h = encodeURIComponent(q);
    resEl.innerHTML = out.length
      ? `<small class="res-count">${out.length} rezultata${out.length > 30 ? ' (prikazano 30)' : ''} · Enter otvara prvi</small>` +
        out.slice(0, 30).map(({ it }) => [it, /\s/.test(phrase) && norm(it.title + ' ' + it.text).includes(phrase) ? [phrase] : terms]).map(([it, terms]) => `<a href="${it.href}${it.href.includes('?') ? '&' : '?'}h=${h}"><b>${hl(it.title, terms)}</b><small>${esc(it.sub)}</small><small>${snippet(it.text, terms)}</small></a>`).join('')
      : '<a>Nema rezultata.</a>';
    resEl.hidden = false;
  }

  /* ---------------- Brzo učenje ---------------- */
  const BRZO_STORE = 'zks.brzo';
  const BOX_DAYS = [0, 1, 3, 7, 14, 30]; // razmak ponavljanja po pretincu (Leitner)
  const dayStr = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return dayStr(d); };
  const brzoState = () => ({ read: {}, cards: {}, streak: 0, last: null, ...store.get(BRZO_STORE, {}) });
  const cardKey = (c) => `${c.d}:${c.q}`;

  function touchStreak(st) {
    const today = dayStr();
    if (st.last === today) return;
    st.streak = st.last === addDays(today, -1) ? (st.streak || 0) + 1 : 1;
    st.last = today;
  }
  const liveStreak = (st) => (st.last === dayStr() || st.last === addDays(dayStr(), -1) ? st.streak || 0 : 0);
  // kartice dospjele za ponavljanje: iz pročitanih lekcija, nove ili s istekom roka
  function dueCards(st = brzoState()) {
    const today = dayStr();
    return DATA.brzo.kartice.filter((c) => st.read[c.d] && (!st.cards[cardKey(c)] || st.cards[cardKey(c)].due <= today));
  }
  const dueCount = () => (DATA && DATA.brzo ? dueCards().length : 0);
  function srcHref(x) {
    if (x.l === 'kontrole') return x.q ? `#/kontrole?q=${encodeURIComponent(x.q)}` : '#/kontrole';
    const h = x.h ? `h=${encodeURIComponent(x.h)}` : '';
    if (/^m\d+$/.test(x.l)) return `#/m/${x.l.slice(1)}?${x.p ? `p=${x.p}&` : ''}${h}`;
    return `#/s/${x.l}${h ? '?' + h : ''}`;
  }
  const srcLabel = (x) => {
    if (x.l === 'kontrole') return 'Katalog kontrola';
    if (/^m\d+$/.test(x.l)) return `Mjera ${x.l.slice(1)}${x.p ? ` · ${x.p}` : ''}`;
    const f = FLAT.find((y) => y.id === x.l);
    return f ? `${f.sec.oznaka} · ${f.sec.clanci || ''}` : x.l;
  };
  const srcLink = (x) => `<a class="src" href="${srcHref(x)}" title="Pročitaj u Zakonu/Uredbi">📖 ${esc(srcLabel(x))}</a>`;
  const nextLesson = (st) => DATA.brzo.lekcije.find((l) => !st.read[l.dan]) || null;

  function todayCard() {
    if (!DATA.brzo) return '';
    const st = brzoState(), n = Object.keys(st.read).length, L = DATA.brzo.lekcije.length, next = nextLesson(st), due = dueCards(st).length;
    const sk = liveStreak(st);
    return `<div class="card today"><div class="today-head"><h3 style="margin:0">⚡ Brzo učenje – danas</h3>
      <span class="legend">🔥 niz: <b>${sk}</b> ${pl(sk, 'dan', 'dana', 'dana')} · lekcije ${n}/${L}</span></div>
      <div class="progress"><span style="width:${Math.round((n / L) * 100)}%"></span></div>
      <div class="form-row">${next ? `<a class="btn primary" href="#/brzo/lekcija/${next.dan}">Dan ${next.dan}: ${esc(next.naslov)} (≈5 min)</a>` : '<span>Sve lekcije pročitane – nastavite s karticama.</span>'}
      <a class="btn" href="#/brzo/kartice">🃏 Ponavljanje${due ? ` (${due})` : ''}</a><a class="btn" href="#/brzo/brojke"># Brojke</a><a class="btn" href="#/slusaj">🎙 Slušaj sastanak</a></div></div>`;
  }

  function renderBrzo(main, dan) {
    const st = brzoState();
    const L = DATA.brzo.lekcije;
    const lek = dan ? L.find((l) => l.dan === dan) : nextLesson(st);
    const list = L.map((l) => `<a class="lesson ${st.read[l.dan] ? 'is-read' : ''} ${lek && l.dan === lek.dan ? 'is-cur' : ''}" href="#/brzo/lekcija/${l.dan}">
        <span class="lday">${l.dan}</span><span>${esc(l.naslov)}</span>${st.read[l.dan] ? '<span class="done">✓</span>' : ''}</a>`).join('');
    const nCards = lek ? DATA.brzo.kartice.filter((c) => c.d === lek.dan).length : 0;
    const body = lek ? `
      <div class="card lesson-card">
        <div class="crumb">Dan ${lek.dan} od ${L.length} · ≈5 minuta</div>
        <h2 style="border:0;margin-top:4px;padding:0">${esc(lek.naslov)}</h2>
        <p class="legend"><b>Cilj:</b> ${esc(lek.cilj)}</p>
        <ol class="flash">${lek.tocke.map((t) => `<li><div>${t.t}</div>${srcLink(t)}</li>`).join('')}</ol>
        <div class="key"><b>Zapamti:</b> ${esc(lek.zapamti)}</div>
        <div class="form-row">
          ${st.read[lek.dan] ? `<span class="done">✓ Pročitano ${esc(st.read[lek.dan])}</span>` : '<button class="btn primary" id="b-read">✓ Pročitao sam – označi</button>'}
          <a class="btn" href="#/brzo/kartice?d=${lek.dan}">🃏 Provjeri se (${nCards} ${pl(nCards, 'kartica', 'kartice', 'kartica')})</a>
          ${L.find((l) => l.dan === lek.dan + 1) ? `<a class="btn" href="#/brzo/lekcija/${lek.dan + 1}">Sljedeća lekcija →</a>` : ''}
        </div>
      </div>` : '<div class="result ok">Sve lekcije su pročitane. Svakodnevno ponavljajte kartice – sustav ih vraća u razmacima od 1, 3, 7, 14 i 30 dana.</div>';
    main.innerHTML = `
      <div class="crumb">Brzo učenje</div>
      <h1>${dan ? 'Lekcija' : 'Današnja lekcija'}</h1>
      <div class="art">Kratke dnevne lekcije s poveznicama na točna mjesta u Zakonu i Uredbi. »📖« otvara izvor s istaknutim pojmom.</div>
      ${todayCard()}
      ${body}
      <h2>Sve lekcije</h2>
      <div class="lessons">${list}</div>
      <p class="legend">Preporuka: jedna lekcija dnevno (≈5 min) + ponavljanje kartica (≈3 min). Za 20 radnih dana prođete cijelo gradivo.</p>`;
    const btn = $('#b-read');
    if (btn) btn.addEventListener('click', () => {
      const s = brzoState(); s.read[lek.dan] = dayStr(); touchStreak(s); store.set(BRZO_STORE, s);
      renderSidebar(); setActive('brzo'); renderBrzo(main, lek.dan); toast('Lekcija označena – njezine kartice dodane su u ponavljanje.');
    });
  }

  function renderKartice(main, params) {
    const st = brzoState();
    const d = params.get('d');
    let pool, title;
    if (d === 'sve') { pool = shuffle([...DATA.brzo.kartice]); title = 'Sve kartice (nasumično)'; }
    else if (d) { pool = DATA.brzo.kartice.filter((c) => c.d === Number(d)); title = `Kartice – dan ${d}`; }
    else { pool = shuffle(dueCards(st)); title = 'Ponavljanje za danas'; }
    const queue = [...pool];
    let done = 0, ok = 0, shown = false;
    main.innerHTML = `
      <div class="crumb">Brzo učenje</div>
      <h1>🃏 ${esc(title)}</h1>
      <div class="art">Odgovorite u sebi, otkrijte odgovor i budite iskreni. Tipke: <b>razmak</b> – otkrij · <b>1</b> – nisam znao · <b>2</b> – znao sam.</div>
      <div class="form-row no-print"><a class="btn ${!d ? 'on' : ''}" href="#/brzo/kartice">Za danas (${dueCards(st).length})</a><a class="btn ${d === 'sve' ? 'on' : ''}" href="#/brzo/kartice?d=sve">Sve (${DATA.brzo.kartice.length})</a></div>
      <div id="fc"></div>`;
    const box = $('#fc');
    const draw = () => {
      if (!queue.length) {
        box.innerHTML = pool.length
          ? `<div class="result ok"><h3 style="margin-top:0">Gotovo! ${ok} / ${done} točno.</h3><p>Kartice koje niste znali vraćaju se sutra, a one koje znate u sve duljim razmacima.</p><a class="btn primary" href="#/brzo">Natrag na lekcije</a></div>`
          : `<div class="result">${d ? 'Nema kartica.' : 'Danas nema kartica za ponavljanje. Pročitajte novu lekciju ili otvorite »Sve«.'} <a class="btn" href="#/brzo">Lekcije</a></div>`;
        return;
      }
      const c = queue[0];
      const rec = st.cards[cardKey(c)];
      shown = false;
      box.innerHTML = `<div class="progress"><span style="width:${Math.round((done / (done + queue.length)) * 100)}%"></span></div>
        <div class="flashcard">
          <div class="legend">Dan ${c.d} · ${rec ? `pretinac ${rec.box}/5` : 'nova kartica'} · preostalo ${queue.length}</div>
          <div class="fq">${esc(c.q)}</div>
          <div class="fa" hidden>${esc(c.a)}<div style="margin-top:10px">${srcLink(c)}</div></div>
          <div class="form-row fbtn"><button class="btn primary" data-f="show">Prikaži odgovor</button></div>
        </div>`;
    };
    const answer = (knew) => {
      const c = queue.shift();
      const s = brzoState(); const k = cardKey(c);
      const box0 = (s.cards[k] && s.cards[k].box) || 0;
      const nb = knew ? Math.min(box0 + 1, 5) : 1;
      s.cards[k] = { box: nb, due: addDays(dayStr(), knew ? BOX_DAYS[nb] : 1) };
      touchStreak(s); store.set(BRZO_STORE, s); Object.assign(st, s);
      done++; if (knew) ok++;
      renderSidebar(); setActive('brzo-kartice'); draw();
    };
    const reveal = () => {
      if (shown || !queue.length) return;
      shown = true;
      $('.fa', box).hidden = false;
      $('.fbtn', box).innerHTML = '<button class="btn bad-b" data-f="no">✗ Nisam znao (1)</button><button class="btn ok-b" data-f="yes">✓ Znao sam (2)</button>';
    };
    box.addEventListener('click', (e) => {
      const f = e.target.dataset.f;
      if (f === 'show') reveal(); else if (f === 'yes') answer(true); else if (f === 'no') answer(false);
    });
    const onKey = (e) => {
      if (!document.body.contains(box)) { document.removeEventListener('keydown', onKey); return; }
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.nodeName)) return;
      if (e.key === ' ') { e.preventDefault(); reveal(); }
      else if (shown && e.key === '1') answer(false);
      else if (shown && e.key === '2') answer(true);
    };
    document.addEventListener('keydown', onKey);
    draw();
  }

  function renderBrojke(main) {
    const groups = {};
    for (const b of DATA.brzo.brojke) (groups[b.g] = groups[b.g] || []).push(b);
    main.innerHTML = `<div class="crumb">Brzo učenje</div><h1># Brojke napamet</h1>
      <div class="art">Sve ključne brojke na jednom mjestu – pročitajte ih ujutro. »📖« otvara izvor.</div>` +
      Object.entries(groups).map(([g, bs]) => `<h2>${esc(g)}</h2><div class="nums">${bs.map((b) => `
        <div class="num-card"><div class="nb">${esc(b.b)}</div><div>${esc(b.s)}</div>${srcLink(b)}</div>`).join('')}</div>`).join('');
  }

  /* ---------------- Slušaj sastanak ---------------- */
  // Govor → tekst (Web Speech API u pregledniku), teme se prepoznaju po okidačima iz DATA.slusaj; ništa se ne sprema.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const LISTEN = { rec: null, on: false, paused: false, finals: [], interim: '', shown: {}, hints: [], wake: null, timer: null, ui: null };
  const COOLDOWN_MS = 5 * 60 * 1000;
  let TEME = null, UPITNE = null;

  const tokStem = (w) => (w.length >= 5 ? stem(w) : w);
  function prepTeme() {
    if (TEME) return TEME;
    UPITNE = DATA.slusaj.upitne.map((u) => norm(u).split(/\s+/));
    TEME = DATA.slusaj.teme.map((t) => ({
      ...t,
      trig: t.k.map((k) => {
        const strong = k.startsWith('!');
        const words = norm(k.replace(/^!/, '')).split(/\s+/).filter(Boolean);
        return { strong, words, stems: words.map(tokStem) };
      }),
    }));
    return TEME;
  }
  // riječ iz govora odgovara korijenu okidača (kratice do 3 znaka moraju se poklopiti točno)
  const wordHit = (tok, s) => (s.length <= 3 ? tok === s : tok.startsWith(s));
  function phraseAt(tokens, stems) {
    for (let i = 0; i < tokens.length; i++) {
      if (!wordHit(tokens[i], stems[0])) continue;
      let j = i, ok = true;
      for (let k = 1; k < stems.length; k++) {
        let found = -1;
        for (let x = j + 1; x <= Math.min(tokens.length - 1, j + 3); x++) if (wordHit(tokens[x], stems[k])) { found = x; break; }
        if (found < 0) { ok = false; break; }
        j = found;
      }
      if (ok) return true;
    }
    return false;
  }
  const tokensOf = (text) => norm(text).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const plain = (html, max = 220) => { const t = strip(html); return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + '…' : t; };

  // sloj 3: ručne teme (izvor/slusaj.mjs)
  function matchRucne(tokens, question) {
    const out = [];
    for (const t of prepTeme()) {
      let score = 0, strong = false;
      const hits = [];
      for (const tr of t.trig) {
        if (!phraseAt(tokens, tr.stems)) continue;
        score += tr.strong ? 2 : tr.words.length > 1 ? 2 : 1;
        strong = strong || tr.strong;
        hits.push(tr.words.join(' '));
      }
      if (score >= 3 || (score >= 2 && (strong || question))) out.push({ t, score: score + (question ? 1 : 0), hits });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  /* --- sloj 1: oznake (mjera N, podmjera N.M, članak N, kontrola XXX-NNN, prilog N) --- */
  // izgovoreni brojevi: korijen → vrijednost (najduži prvi; nastavci padeža do 3 znaka)
  const NUM_WORDS = [
    ['devetnaest', 19], ['osamnaest', 18], ['sedamnaest', 17], ['sesnaest', 16], ['petnaest', 15], ['cetrnaest', 14],
    ['trinaest', 13], ['dvanaest', 12], ['jedanaest', 11], ['devedeset', 90], ['osamdeset', 80], ['sedamdeset', 70],
    ['sezdeset', 60], ['pedeset', 50], ['cetrdeset', 40], ['trideset', 30], ['dvadeset', 20], ['deset', 10],
    ['devet', 9], ['osam', 8], ['osm', 8], ['sedam', 7], ['sedm', 7], ['sest', 6], ['pet', 5], ['cetiri', 4], ['cetvrt', 4],
    ['tri', 3], ['trec', 3], ['dvije', 2], ['dva', 2], ['drug', 2], ['jedan', 1], ['jedn', 1], ['prv', 1], ['nula', 0], ['sto', 100], ['stot', 100],
  ];
  const NUM_SUFFIX = /^(|a|e|i|o|u|og|om|oj|ih|im|ima|ga|oga|ome|emu|ega|ju)$/;
  function wordNum(tok) {
    if (/^\d{1,3}$/.test(tok)) return Number(tok);
    for (const [w, v] of NUM_WORDS) if (tok.startsWith(w) && NUM_SUFFIX.test(tok.slice(w.length))) return v;
    return null;
  }
  // niz tokena → brojevi {i, j (zadnji indeks), v, dec}; »pet točka dva« / »5.2« → dec '5.2'
  function parseBrojeve(tokens) {
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
      const d = tokens[i].match(/^(\d{1,2})\.(\d{1,2})$/);
      if (d) { out.push({ i, j: i, v: Number(d[1]), dec: `${Number(d[1])}.${Number(d[2])}` }); continue; }
      let v = wordNum(tokens[i]); if (v === null) continue;
      let j = i;
      const isDigit = /^\d+$/.test(tokens[i]);
      if (!isDigit) {
        // složeni: sto + desetice + jedinice
        const next = () => (j + 1 < tokens.length ? wordNum(tokens[j + 1]) : null);
        if (v === 100) { const n = next(); if (n !== null && n > 0 && n < 100 && !/^\d/.test(tokens[j + 1])) { v += n; j++; } }
        if (v % 10 === 0 && v % 100 >= 20) { const n = next(); if (n !== null && n > 0 && n < 10 && !/^\d/.test(tokens[j + 1])) { v += n; j++; } }
      }
      // decimalni oblik: N točka/zarez M
      if (j + 2 < tokens.length && /^(tock|zarez)/.test(tokens[j + 1])) {
        const m = wordNum(tokens[j + 2]);
        if (m !== null && m > 0 && m < 20) { out.push({ i, j: j + 2, v, dec: `${v}.${m}` }); i = j + 2; continue; }
      }
      out.push({ i, j, v });
      i = j;
    }
    return out;
  }
  const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4 };
  let ART_MAP = null;
  // članak → cjelina, iz polja »clanci« (npr. »Zakon, čl. 31.–36. i 112.«)
  function artMap() {
    if (ART_MAP) return ART_MAP;
    ART_MAP = { zakon: {}, uredba: {} };
    for (const part of DATA.dijelovi) for (const s of part.sekcije) {
      const law = /^Uredba/.test(s.clanci || '') ? 'uredba' : 'zakon';
      const txt = (s.clanci || '').replace(/\(.*?\)/g, '');
      for (const m of txt.matchAll(/(\d+)\.\s*[–-]\s*(\d+)\./g)) for (let a = Number(m[1]); a <= Number(m[2]); a++) (ART_MAP[law][a] = ART_MAP[law][a] || []).push(s);
      for (const m of txt.replace(/(\d+)\.\s*[–-]\s*(\d+)\./g, '').matchAll(/(\d+)\./g)) (ART_MAP[law][Number(m[1])] = ART_MAP[law][Number(m[1])] || []).push(s);
    }
    return ART_MAP;
  }
  const levelCounts = (m) => [0, 1, 2].map((l) => m.podskupovi.filter((p) => p.r[l] === 'A').length);
  function mjeraTema(m) {
    const [o, s, n] = levelCounts(m);
    return { id: `m${m.broj}`, n: `Mjera ${m.broj}. ${m.naziv}`, o: `${plain(m.cilj, 240)}<br><b>${m.podskupovi.length} podmjera</b> (${m.podskupovi[0].id}–${m.podskupovi[m.podskupovi.length - 1].id}) · obvezno (A): osnovna <b>${o}</b>, srednja <b>${s}</b>, napredna <b>${n}</b>`, s: [{ l: `m${m.broj}` }] };
  }
  function podTema(m, p) {
    const tb = DATA.prilogB && DATA.prilogB.tablice[p.id];
    return { id: `p${p.id}`, n: `${p.id} ${p.naziv}`, o: `Razine: osnovna <b>${p.r[0]}</b> · srednja <b>${p.r[1]}</b> · napredna <b>${p.r[2]}</b> (mjera ${m.broj}. ${esc(m.naziv)})<br>${plain(p.opis, 230)}${p.uvjet ? `<br><b>UVJET:</b> ${plain(p.uvjet, 160)}` : ''}${tb ? `<br>Kontrole: ${tb.k.map((k) => k[0]).join(', ')}` : ''}`, s: [{ l: `m${m.broj}`, p: p.id }] };
  }
  function clanakTema(law, a) {
    const secs = artMap()[law][a];
    if (!secs) return null;
    const s = secs[0];
    const tpl = document.createElement('template'); tpl.innerHTML = s.sazetak;
    const pts = [...tpl.content.querySelectorAll('li')].slice(0, 2).map((li) => li.textContent.trim());
    return { id: `c${law}${a}`, n: `Članak ${a}. ${law === 'zakon' ? 'Zakona' : 'Uredbe'} → ${s.oznaka} ${s.naslov}`, o: (pts.length ? pts.map(esc).join('<br>') : plain(s.sazetak, 260)), s: [{ l: s.id, h: `${a}.` }] };
  }
  function kontrolaTema(c) {
    return { id: `k${c.id}`, n: `Kontrola ${c.id} (${c.label})`, o: c.uses.map((u) => `<b>${u.pid}</b> ${esc(u.naziv)}: ${u.p.join(' / ')}`).join('<br>') + '<br><span class="legend">pragovi: osnovna / srednja / napredna</span>', s: [{ l: 'kontrole', q: c.id }] };
  }
  const PRILOZI = {
    zakon: { 1: ['Prilog I. Zakona – sektori visoke kritičnosti', 'z04', 'Prilog I. – Sektori visoke kritičnosti'], 2: ['Prilog II. Zakona – drugi kritični sektori', 'z04', 'Prilog II. – Drugi kritični sektori'], 3: ['Prilog III. Zakona – nadležna tijela i CSIRT-ovi po sektorima', 'z12', 'Podjela CSIRT nadležnosti'], 4: ['Prilog IV. Zakona – sadržaj strategije', 'z11', 'Prilog IV.'] },
    uredba: { 1: ['Prilog I. Uredbe – popis sektora djelatnosti', 'u01', 'Popis sektora'], 2: ['Prilog II. Uredbe – 13 mjera upravljanja rizicima', 'u05', 'Pregled 13 mjera'], 3: ['Prilog III. Uredbe – fizička sigurnost digitalne infrastrukture', 'u06', 'Plan fizičke sigurnosti'], 4: ['Prilog IV. Uredbe – obrazac izjave o sukladnosti', 'u07', 'Izjava o sukladnosti'] },
  };
  function matchOznake(text) {
    // tokeni s točkom unutar broja (»12.4«), bez točke na kraju rečenice
    const tokens = norm(text).replace(/[^a-z0-9.\s]/g, ' ').split(/\s+/).map((w) => w.replace(/^\.+|\.+$/g, '')).filter(Boolean).slice(-35);
    const out = [];
    const law = tokens.some((t) => t.startsWith('uredb')) ? 'uredba' : 'zakon';
    const nums = parseBrojeve(tokens);
    // broj iza oznake (»mjera 12«) ili redni broj ispred nje (»dvanaesta mjera«; ne »druge mjere«)
    const numNear = (k, maxAfter = 3) => nums.find((n) => n.i > k && n.i <= k + maxAfter)
      || nums.find((n) => n.j === k - 1 && !n.dec && /(a|oj|u)$/.test(tokens[n.i]) && !/^(drug|prv|jedn|\d)/.test(tokens[n.i]));
    const push = (t, hit) => { if (t && !out.some((o) => o.t.id === t.id)) out.push({ t, score: 100, hits: [hit] }); };
    tokens.forEach((tok, k) => {
      if (/^(mjer|podmjer|podskup|tock)/.test(tok)) {
        let n = numNear(k);
        if (!n) return;
        // »podmjera 5 2« – dva broja zaredom
        if (!n.dec && /^(podmjer|podskup|tock)/.test(tok)) {
          const n2 = nums.find((x) => x.i === n.j + 1 && !x.dec && x.v > 0 && x.v < 20);
          if (n2 && n.v >= 1 && n.v <= 13) n = { ...n, dec: `${n.v}.${n2.v}` };
        }
        // »točka« bez decimalnog broja ne znači ništa
        if (n.dec) {
          const [a, b] = n.dec.split('.').map(Number);
          const m = DATA.mjere[a - 1]; const p = m && m.podskupovi[b - 1];
          if (p) push(podTema(m, p), `${tok} ${n.dec}`);
        } else if (/^mjer/.test(tok) && n.v >= 1 && n.v <= 13) push(mjeraTema(DATA.mjere[n.v - 1]), `${tok} ${n.v}`);
      } else if (/^clan/.test(tok)) {
        const n = numNear(k); if (!n || n.dec) return;
        const t = clanakTema(law, n.v) || clanakTema(law === 'zakon' ? 'uredba' : 'zakon', n.v);
        push(t, `članak ${n.v}`);
      } else if (/^prilog/.test(tok)) {
        const nx = tokens[k + 1];
        const v = nx && (ROMAN[nx] || wordNum(nx));
        const pr = v && PRILOZI[law][v];
        if (pr) push({ id: `pr${law}${v}`, n: pr[0], o: `Otvorite izvor za cijeli sadržaj priloga.`, s: [{ l: pr[1], h: pr[2] }] }, `prilog ${v}`);
      } else if (DATA.prilogB && DATA.prilogB.prefiksi[tok.toUpperCase()]) {
        // kontrola: prefiks + broj (»pol nula nula četiri«, »pol 4«, »pol004«)
        const ds = []; let x = k + 1;
        while (x < tokens.length && ds.length < 3) { const v = wordNum(tokens[x]); if (v === null || v > 99) break; ds.push(v); x++; }
        if (!ds.length) return;
        const num = ds.length > 1 && ds.every((d) => d < 10) ? Number(ds.join('')) : ds[ds.length - 1];
        const c = controls().find((cc) => cc.pre === tok.toUpperCase() && cc.num === num);
        if (c) push(kontrolaTema(c), `${c.id}`);
      } else {
        const cm = tok.match(/^([a-z]{3,4})0*(\d{1,3})$/);
        if (cm && DATA.prilogB && DATA.prilogB.prefiksi[cm[1].toUpperCase()]) {
          const c = controls().find((cc) => cc.pre === cm[1].toUpperCase() && cc.num === Number(cm[2]));
          if (c) push(kontrolaTema(c), c.id);
        }
      }
    });
    return out;
  }

  /* --- sloj 2: automatski indeks cijelog sadržaja (težinski, IDF) --- */
  let AUTO = null, STOP = null;
  function buildAutoIndex() {
    if (AUTO) return AUTO;
    STOP = new Set((DATA.slusaj.stop || []).map(norm));
    const entries = [];
    const add = (t, nameTxt, bodyTxt) => entries.push({ t, name: nameTxt, body: bodyTxt });
    for (const m of DATA.mjere) {
      add(mjeraTema(m), m.naziv, strip(m.cilj));
      for (const p of m.podskupovi) add(podTema(m, p), p.naziv, strip(p.opis));
    }
    for (const f of FLAT) if (f.type === 's') {
      const s = f.sec;
      const tpl = document.createElement('template'); tpl.innerHTML = s.sazetak;
      const pts = [...tpl.content.querySelectorAll('li')].slice(0, 2).map((li) => esc(li.textContent.trim()));
      add({ id: `s${s.id}`, n: `${s.oznaka} ${s.naslov}`, o: pts.join('<br>') || plain(s.sazetak), s: [{ l: s.id }] }, s.naslov, strip(s.sazetak));
    }
    for (const g of DATA.glosar) {
      const l = /^Uredba/.test(g.izvor) ? 'u01' : 'z02';
      add({ id: `g${g.pojam}`, n: g.pojam, o: `${g.opis} <span class="legend">(${esc(g.izvor)})</span>`, s: [{ l, h: g.pojam.split(/[ /(]/)[0] }] }, g.pojam, strip(g.opis));
    }
    for (const c of DATA.brzo.kartice) add({ id: `q${c.d}:${c.q}`, n: c.q, o: esc(c.a), s: [{ l: c.l, p: c.p, h: c.h }] }, c.q, c.a);
    for (const b of DATA.brzo.brojke) add({ id: `b${b.b}${b.s}`, n: `${b.b} – ${b.s}`, o: `<b>${esc(b.b)}</b>: ${esc(b.s)}`, s: [{ l: b.l, p: b.p, h: b.h }] }, b.s, b.g);
    const stems = (txt) => [...new Set(tokensOf(txt).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)).map(tokStem))];
    const df = {};
    for (const e of entries) {
      e.nameS = new Set(stems(e.name)); e.bodyS = new Set(stems(e.body));
      for (const s of new Set([...e.nameS, ...e.bodyS])) df[s] = (df[s] || 0) + 1;
    }
    const N = entries.length;
    AUTO = { entries, idf: (s) => Math.log(1 + N / (df[s] || N)) };
    return AUTO;
  }
  function matchAuto(tokens, question) {
    const { entries, idf } = buildAutoIndex();
    const q = [...new Set(tokens.filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)).map(tokStem))];
    if (!q.length) return [];
    const scored = [];
    for (const e of entries) {
      let sc = 0, nameHit = 0, hit = 0; const hits = [];
      for (const s of q) {
        if (e.nameS.has(s)) { sc += 2 * idf(s); nameHit++; hit++; hits.push(s); } else if (e.bodyS.has(s)) { sc += idf(s); hit++; hits.push(s); }
      }
      if (!hit) continue;
      // relevantnost: pitanje + pogodak u nazivu ili dovoljno jak zbroj
      const ok = (question && ((nameHit >= 1 && sc >= 7) || (hit >= 2 && sc >= 9))) || sc >= 16;
      if (ok) scored.push({ t: e.t, score: sc, hits });
    }
    scored.sort((a, b) => b.score - a.score);
    // samo izrazito najbolji pogoci (unutar 70 % najboljeg)
    return scored.filter((x) => x.score >= scored[0].score * 0.7).slice(0, 2);
  }

  // sva tri sloja: oznake → ručne teme → automatski indeks
  function matchTeme(text, latest) {
    const tokens = tokensOf(text).slice(-35);
    if (!tokens.length) return [];
    const recent = latest != null ? tokensOf(latest) : tokens;
    const question = UPITNE.some((u) => phraseAt(recent, u)) || UPITNE.some((u) => phraseAt(tokens.slice(-12), u));
    const out = [...matchOznake(latest != null ? latest : text), ...matchRucne(tokens, question)];
    if (out.length < 2) out.push(...matchAuto(recent, question));
    const seen = new Set();
    return out.filter((x) => {
      const key = x.t.s.map((s) => `${s.l}|${s.p || ''}|${s.q || ''}|${s.h || ''}`).join(',') + '|' + x.t.id[0];
      if (seen.has(x.t.id) || seen.has(key)) return false;
      seen.add(x.t.id); seen.add(key); return true;
    });
  }

  // odlomci iz izvora koji sadrže pojam
  function excerpt(src) {
    if (src.l === 'kontrole') return '<p class="exc">Detalji kontrola nalaze se u katalogu kontrola (Prilog B).</p>';
    let html = '';
    if (/^m\d+$/.test(src.l)) {
      const m = DATA.mjere.find((x) => x.broj === Number(src.l.slice(1)));
      const p = m && src.p && m.podskupovi.find((x) => x.id === src.p);
      html = p ? `<p><b>${esc(p.id)} ${esc(p.naziv)}</b></p>${p.opis}${p.uvjet ? `<p><b>UVJET:</b> ${p.uvjet}</p>` : ''}` : (m ? `<p>${m.cilj}</p>` : '');
    } else {
      const f = FLAT.find((x) => x.id === src.l);
      html = f ? f.sec.html : '';
    }
    const tpl = document.createElement('template'); tpl.innerHTML = html;
    const term = src.h ? norm(src.h) : '';
    const has = (el) => term && normMap(el.textContent).n.includes(term);
    const BLOCK = 'li, p, tr, .key, .warn';
    const clean = (el) => (el.tagName === 'TR'
      ? [...el.cells].map((c) => c.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' — ')
      : el.textContent.replace(/\s+/g, ' ').trim());
    const line = (txt, cls = 'exc') => `<p class="${cls}">${hl(txt, term ? [term] : [])}</p>`;
    // pojam je naslov odjeljka → prikaži naslov i prve odlomke ispod njega
    const head = term ? [...tpl.content.querySelectorAll('h2, h3, h4')].find(has) : null;
    if (head) {
      const out = [line(clean(head), 'exc exc-h')];
      for (let n = head.nextElementSibling; n && !/^H[2-4]$/.test(n.tagName) && out.length < 4; n = n.nextElementSibling) {
        const parts = n.matches(BLOCK) ? [n] : [...n.querySelectorAll('li, p, tr')];
        for (const el of (parts.length ? parts : [n])) { if (out.length < 4) out.push(line(clean(el))); }
      }
      return out.join('');
    }
    const blocks = [...tpl.content.querySelectorAll(BLOCK)];
    let hits = blocks.filter((b) => has(b) && ![...b.querySelectorAll('li, p, tr')].some(has));
    if (!hits.length) hits = blocks.slice(0, 2);
    return hits.slice(0, 3).map((b) => line(clean(b))).join('');
  }

  function addHints(found) {
    const now = Date.now();
    let added = 0;
    for (const f of found) {
      if (added >= 3) break;
      if (LISTEN.shown[f.t.id] && now - LISTEN.shown[f.t.id] < COOLDOWN_MS) continue;
      LISTEN.shown[f.t.id] = now;
      LISTEN.hints = LISTEN.hints.filter((h) => h.t.id !== f.t.id);
      LISTEN.hints.unshift({ t: f.t, at: new Date(), hits: f.hits, pin: false });
      added++;
    }
    if (!added) return;
    const pinned = LISTEN.hints.filter((h) => h.pin), rest = LISTEN.hints.filter((h) => !h.pin);
    LISTEN.hints = [...pinned, ...rest].slice(0, 40);
    drawHints();
  }

  function drawHints() {
    const box = LISTEN.ui && LISTEN.ui.hints; if (!box) return;
    box.innerHTML = LISTEN.hints.length ? LISTEN.hints.map((h, i) => `
      <div class="hint ${h.pin ? 'pinned' : ''} ${i === 0 && !h.pin ? 'fresh' : ''}" data-i="${i}">
        <div class="hint-head"><b>${esc(h.t.n)}</b><span class="legend">${h.at.toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' })} · »${esc(h.hits[0] || '')}«</span>
          <button class="btn sm-b" data-act="pin" title="Zakači">${h.pin ? '📌' : '📍'}</button></div>
        <div class="hint-o">${h.t.o}</div>
        <div class="hint-src">${h.t.s.map((s, k) => `<button class="btn sm-b" data-act="read" data-k="${k}">📖 ${esc(srcLabel(s))}</button>`).join(' ')}</div>
        <div class="hint-exc" hidden></div>
      </div>`).join('') : '<p class="legend">Natuknice će se pojaviti ovdje čim se u razgovoru spomene tema iz Zakona ili Uredbe.</p>';
  }

  function drawTranscript() {
    const el = LISTEN.ui && LISTEN.ui.tr; if (!el) return;
    el.innerHTML = LISTEN.finals.slice(-8).map((t) => `<p>${esc(t)}</p>`).join('') + (LISTEN.interim ? `<p class="interim">${esc(LISTEN.interim)}</p>` : '');
    el.scrollTop = el.scrollHeight;
  }

  function evaluate() {
    clearTimeout(LISTEN.timer);
    const latest = LISTEN.interim || LISTEN.finals[LISTEN.finals.length - 1] || '';
    LISTEN.timer = setTimeout(() => addHints(matchTeme(LISTEN.finals.slice(-4).join(' ') + ' ' + LISTEN.interim, latest)), 300);
  }

  function feedText(text, final) {
    if (final) { LISTEN.finals.push(text.trim()); if (LISTEN.finals.length > 60) LISTEN.finals.shift(); LISTEN.interim = ''; }
    else LISTEN.interim = text;
    drawTranscript(); evaluate();
  }

  function setStatus(msg, cls = '') {
    const el = LISTEN.ui && LISTEN.ui.status; if (el) { el.className = 'listen-status ' + cls; el.innerHTML = msg; }
  }

  async function startListening() {
    if (!SR) { setStatus('Ovaj preglednik ne podržava prepoznavanje govora. Koristite Chrome ili Edge na računalu ili Chrome na Androidu – ili probni način ispod.', 'bad'); return; }
    const rec = new SR();
    rec.lang = 'hr-HR'; rec.continuous = true; rec.interimResults = true;
    // lokalno prepoznavanje (bez slanja zvuka) – samo ako ga preglednik nudi za hrvatski
    let local = false;
    try {
      if (SR.available) {
        const st = await SR.available({ langs: ['hr-HR'], processLocally: true });
        if (st === 'available') { rec.processLocally = true; local = true; }
      }
    } catch { /* nije podržano */ }
    rec.onresult = (e) => {
      if (LISTEN.paused) return;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) feedText(r[0].transcript, true); else interim += r[0].transcript;
      }
      if (interim) feedText(interim, false);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { LISTEN.on = false; setStatus('Pristup mikrofonu nije dopušten. Dopustite mikrofon u postavkama stranice (ikona lokota u adresnoj traci).', 'bad'); updateButtons(); }
      else if (e.error === 'network') setStatus('Nema veze s uslugom prepoznavanja govora – provjerite internet.', 'bad');
    };
    rec.onend = () => { if (LISTEN.on) { try { rec.start(); } catch { /* već pokrenuto */ } } };
    LISTEN.rec = rec; LISTEN.on = true; LISTEN.paused = false;
    try { rec.start(); } catch { /* */ }
    try { LISTEN.wake = await navigator.wakeLock.request('screen'); } catch { /* nije podržano */ }
    setStatus(`<span class="dot"></span> Slušam… ${local ? '(lokalno prepoznavanje na uređaju – zvuk ne napušta uređaj)' : '(prepoznavanje govora obavlja usluga preglednika)'}`, 'on');
    updateButtons();
  }

  function stopListening() {
    if (!LISTEN.on && !LISTEN.rec) return;
    LISTEN.on = false;
    try { LISTEN.rec && LISTEN.rec.stop(); } catch { /* */ }
    LISTEN.rec = null;
    try { LISTEN.wake && LISTEN.wake.release(); } catch { /* */ }
    LISTEN.wake = null;
    LISTEN.finals = []; LISTEN.interim = '';
    drawTranscript();
    setStatus('Zaustavljeno. Transkript je obrisan.', '');
    updateButtons();
  }

  function updateButtons() {
    const u = LISTEN.ui; if (!u || !u.start) return;
    u.start.hidden = LISTEN.on; u.stop.hidden = !LISTEN.on; u.pause.hidden = !LISTEN.on;
    u.pause.textContent = LISTEN.paused ? '▶ Nastavi' : '⏸ Pauza';
  }

  function renderSlusaj(main) {
    prepTeme();
    main.innerHTML = `
      <div class="crumb">Brzo učenje</div>
      <h1>🎙 Slušaj sastanak</h1>
      <div class="art">Dok razgovarate, aplikacija prati govor i sama prikazuje natuknice iz Zakona i Uredbe kad se spomene stručna tema. Na ostali razgovor ne reagira.</div>
      <div class="form-row no-print">
        <button class="btn primary" id="l-start">🎙 Počni slušati</button>
        <button class="btn" id="l-pause" hidden>⏸ Pauza</button>
        <button class="btn" id="l-stop" hidden>⏹ Stop</button>
        <button class="btn" id="l-clear">Očisti natuknice</button>
      </div>
      <div id="l-status" class="listen-status">${SR ? 'Spremno. Kliknite »Počni slušati« i dopustite mikrofon.' : 'Ovaj preglednik ne podržava prepoznavanje govora – koristite probni način ispod.'}</div>
      <div class="listen-grid">
        <section><h3>Transkript (samo u memoriji)</h3><div id="l-tr" class="transcript"></div>
          <details class="no-print" style="margin-top:10px"><summary><b>Probni način</b> – upišite ili zalijepite tekst (npr. Teams transkript)</summary>
            <textarea id="l-text" rows="4" placeholder="npr. Koliko imamo vremena za prijavu incidenta CSIRT-u?"></textarea>
            <div class="form-row"><button class="btn" id="l-feed">Obradi tekst</button></div></details>
        </section>
        <section><h3>Natuknice</h3><div id="l-hints" class="hints"></div></section>
      </div>
      <details class="no-print" style="margin-top:16px"><summary><b>Privatnost i savjeti</b></summary><div class="content"><ul>
        <li>Transkript postoji samo u memoriji ove kartice; briše se na »Stop« ili zatvaranjem stranice. Aplikacija ništa ne sprema ni ne šalje.</li>
        <li>Chrome i Edge za prepoznavanje govora u pravilu šalju zvuk svojoj usluzi (Google / Microsoft), osim ako status ne javlja lokalno prepoznavanje. Za povjerljive sastanke koristite probni način.</li>
        <li>Razgovor obrađuje izjave drugih osoba – obavijestite sudionike (GDPR).</li>
        <li>Online sastanak na istom laptopu: mikrofon čuje druge samo ako se zvuk pušta preko zvučnika. Ekran ostaje upaljen dok aplikacija sluša.</li>
        <li>Govornici se ne razlikuju – natuknice se prikazuju prema temi, tko god je spomene.</li>
      </ul></div></details>`;
    LISTEN.ui = { start: $('#l-start'), stop: $('#l-stop'), pause: $('#l-pause'), status: $('#l-status'), tr: $('#l-tr'), hints: $('#l-hints') };
    LISTEN.ui.start.addEventListener('click', startListening);
    LISTEN.ui.stop.addEventListener('click', stopListening);
    LISTEN.ui.pause.addEventListener('click', () => { LISTEN.paused = !LISTEN.paused; updateButtons(); setStatus(LISTEN.paused ? 'Pauzirano – govor se ne obrađuje.' : '<span class="dot"></span> Slušam…', LISTEN.paused ? '' : 'on'); });
    $('#l-clear').addEventListener('click', () => { LISTEN.hints = []; LISTEN.shown = {}; LISTEN.finals = []; LISTEN.interim = ''; drawHints(); drawTranscript(); });
    $('#l-feed').addEventListener('click', () => {
      const txt = $('#l-text').value.trim(); if (!txt) return;
      txt.split(/(?<=[.?!])\s+|\n+/).filter((s) => s.trim()).forEach((s) => { feedText(s, true); addHints(matchTeme(s)); });
      $('#l-text').value = '';
    });
    LISTEN.ui.hints.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const card = b.closest('.hint'); const h = LISTEN.hints[Number(card.dataset.i)];
      if (b.dataset.act === 'pin') { h.pin = !h.pin; LISTEN.hints = [...LISTEN.hints.filter((x) => x.pin), ...LISTEN.hints.filter((x) => !x.pin)]; drawHints(); }
      if (b.dataset.act === 'read') {
        const src = h.t.s[Number(b.dataset.k)];
        const box = $('.hint-exc', card);
        const same = !box.hidden && box.dataset.k === b.dataset.k;
        box.hidden = same; box.dataset.k = b.dataset.k;
        if (!same) box.innerHTML = `${excerpt(src)}<a href="${srcHref(src)}" class="src" data-open>↗ Otvori cijelo u novoj kartici</a>`;
      }
    });
    LISTEN.ui.hints.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-open]'); if (!a) return;
      e.preventDefault(); window.open(location.pathname + a.getAttribute('href'), '_blank');
    });
    drawTranscript(); drawHints(); updateButtons();
  }

  /* ---------------- Katalog kontrola (Prilog B) ---------------- */
  let CTRL = null, ROWS = null;
  const subIndex = () => {
    const map = {};
    for (const m of DATA.mjere) for (const p of m.podskupovi) map[p.id] = { m, p };
    return map;
  };
  // sve kontrole s podmjerama u kojima se koriste
  function controls() {
    if (CTRL) return CTRL;
    const B = DATA.prilogB, subs = subIndex(), byId = {};
    ROWS = [];
    for (const [pid, tb] of Object.entries(B.tablice)) {
      const { m, p } = subs[pid];
      for (const [id, o, s, n] of tb.k) {
        const pre = id.split('-')[0];
        const c = byId[id] || (byId[id] = { id, pre, num: Number(id.split('-')[1]), label: B.prefiksi[pre] || pre, uses: [] });
        const row = { c, pid, mjera: m, sub: p, naziv: p.naziv, r: p.r, p: [o, s, n], t: tb.t, others: tb.k.map((k) => k[0]).filter((x) => x !== id) };
        c.uses.push(row); ROWS.push(row);
      }
    }
    for (const row of ROWS) {
      const c = row.c;
      row.idHay = [c.id, c.id.replace('-', ''), c.id.replace('-', ' '), c.pre + c.num].map(norm).join(' ');
      row.hay = norm(`${c.label} | ${row.pid} ${row.naziv} | mjera ${row.mjera.broj} ${row.mjera.naziv} | ${strip(row.sub.opis)} ${row.sub.uvjet || ''}`);
      row.words = [...new Set(row.hay.split(/[^a-z0-9]+/).filter((w) => w.length > 3))];
    }
    CTRL = Object.values(byId).sort((a, b) => a.pre.localeCompare(b.pre) || a.num - b.num);
    return CTRL;
  }

  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let pp = null, prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]; let best = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], pp[j - 2] + 1);
        best = Math.min(best, cur[j]);
      }
      if (best > max) return max + 1;
      pp = prev; prev = cur;
    }
    return prev[b.length];
  }

  // ocjena retka (kontrola × podmjera) za jedan pojam; 0 = nema pogotka
  function scoreToken(row, t, fuzzy) {
    const idm = t.match(/^([a-z]{2,5})[-\s]?0*(\d{1,3})$/);
    if (idm) return idm[1] === norm(row.c.pre) && Number(idm[2]) === row.c.num ? 100 : 0;
    if (/^\d{1,2}\.\d{1,2}\.?$/.test(t)) return row.pid === t.replace(/\.$/, '') ? 80 : 0;
    if (/^\d{1,2}$/.test(t)) return String(row.mjera.broj) === t ? 20 : 0;
    if (t === norm(row.c.pre)) return 60;
    if (row.idHay.includes(t)) return 50;
    if (norm(row.c.label).includes(t)) return 25;
    if (norm(row.naziv).includes(t)) return 20;
    if (row.hay.includes(t)) return 5;
    if (fuzzy && t.length >= 4) {
      const max = t.length >= 8 ? 2 : 1;
      if (row.words.some((w) => lev(t, w.slice(0, t.length + 1), max) <= max || lev(t, w, max) <= max)) return 2;
    }
    return 0;
  }

  const thrOk = (thr, v) => {
    if (thr === '-' || thr == null) return null;
    const m = thr.match(/(≥|>)?\s*([\d.]+)/);
    const x = Number(m[2]);
    return m[1] === '>' ? v > x : v >= x;
  };
  const LVL = ['osnovna', 'srednja', 'napredna'];
  // hrvatska množina: 1 / 2–4 / 5+ (uz iznimke 11–14)
  const pl = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many);

  // tablica kontrola i kalkulator za jednu podmjeru
  function kontroleBlock(pid, terms) {
    const tb = DATA.prilogB.tablice[pid];
    if (!tb) return '';
    const p = subIndex()[pid].p;
    const rows = tb.k.map(([id, ...v]) => `<tr><td><a class="cid" href="#/kontrole?q=${id}">${hl(id, terms)}</a></td><td class="legend">${hl(DATA.prilogB.prefiksi[id.split('-')[0]], terms)}</td>${v.map((x) => `<td class="num-c">${esc(x)}</td>`).join('')}</tr>`).join('');
    const opts = [0, 1, 2, 3, 4, 5].map((n) => `<option>${n}</option>`).join('');
    return `<details class="ctl-block"><summary>Kontrole za samoprocjenu (Prilog B ZSIS) – ${tb.k.length} ${tb.k.length === 1 ? 'kontrola' : tb.k.length < 5 ? 'kontrole' : 'kontrola'}</summary>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Kontrola</th><th>Područje</th>${LVL.map((l, i) => `<th>${l}${p.r[i] === 'C' ? '*' : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows}<tr class="prag"><td colspan="2"><b>Bodovni prag podmjere (prosjek)</b></td>${tb.t.map((x) => `<td class="num-c"><b>${esc(x)}</b></td>`).join('')}</tr></tbody></table></div>
      ${p.r.includes('C') ? '<p class="legend">* na toj razini podmjera je dobrovoljna – kontrole se ocjenjuju samo ako je podmjera uključena prema procjeni rizika.</p>' : ''}
      <div class="calc" data-pid="${pid}"><b>Kalkulator ocjene</b> · razina <select data-calc-lv>${LVL.map((l, i) => `<option value="${i}">${l}</option>`).join('')}</select>
        <div class="calc-rows">${tb.k.map(([id]) => `<label class="calc-row">${id} <select data-calc="${id}">${opts}</select></label>`).join('')}</div>
        <div class="calc-out legend">Unesite ocjene kontrola (0–5) prema Prilogu C.</div></div>
    </details>`;
  }

  function bindCalc(root) {
    root.addEventListener('change', (e) => {
      const box = e.target.closest('.calc'); if (!box) return;
      const tb = DATA.prilogB.tablice[box.dataset.pid];
      const lv = Number($('[data-calc-lv]', box).value);
      const fails = [], vals = [];
      for (const [id, ...thr] of tb.k) {
        const sel = $(`[data-calc="${id}"]`, box);
        const ok = thrOk(thr[lv], Number(sel.value));
        sel.parentNode.classList.toggle('na', ok === null);
        if (ok === null) continue;
        vals.push(Number(sel.value));
        if (!ok) fails.push(`${id} (prag ${thr[lv]})`);
      }
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      const avgOk = thrOk(tb.t[lv], avg);
      const pass = !fails.length && avgOk;
      $('.calc-out', box).className = 'calc-out result ' + (pass ? 'ok' : 'bad');
      $('.calc-out', box).innerHTML = `<b>${pass ? 'PROLAZ' : 'NE PROLAZI'}</b> – prosjek ${avg.toFixed(2)} (prag ${esc(tb.t[lv])})${fails.length ? `<br>Kontrole ispod praga: ${esc(fails.join(', '))}` : ''}${!avgOk && !fails.length ? '<br>Pojedinačni pragovi su zadovoljeni, ali prosjek nije.' : ''}`;
    });
  }

  function renderKontrole(main, params) {
    const all = controls();
    const B = DATA.prilogB;
    const st = {
      q: params.get('q') || '', pre: (params.get('pre') || '').split(',').filter(Boolean),
      lv: params.has('lv') ? Number(params.get('lv')) : -1, ob: params.get('ob') === '1', m: Number(params.get('m') || 0), v: params.get('v') || 'k',
    };
    const prefs = Object.keys(B.prefiksi);
    main.innerHTML = `
      <div class="crumb">Samoprocjena · ${esc(B.izvor)}</div>
      <h1>Katalog kontrola</h1>
      <div class="art">${all.length} kontrola · ${ROWS.length} pojavljivanja u ${Object.keys(B.tablice).length} podmjera · Prilog B ZSIS-a</div>
      <div class="card tool ksearch no-print">
        <input id="kq" type="search" autocomplete="off" placeholder="Traži: POL-001, pol1, 5.2, lozinke, MFA, dobavljač, »mjera 8«…  (tipka / )" value="${esc(st.q)}">
        <div class="chips">${prefs.map((p) => `<button class="chip ${st.pre.includes(p) ? 'on' : ''}" data-pre="${p}" title="${esc(B.prefiksi[p])}">${p}</button>`).join('')}</div>
        <div class="form-row">
          <label>Razina <select id="k-lv"><option value="-1">sve</option>${LVL.map((l, i) => `<option value="${i}" ${st.lv === i ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label><input type="checkbox" id="k-ob" ${st.ob ? 'checked' : ''}> samo obvezne podmjere (A/B) na razini</label>
          <label>Mjera <select id="k-m"><option value="0">sve</option>${DATA.mjere.map((m) => `<option value="${m.broj}" ${st.m === m.broj ? 'selected' : ''}>${m.broj}. ${esc(m.naziv)}</option>`).join('')}</select></label>
          <span class="seg"><button class="btn ${st.v === 'k' ? 'on' : ''}" data-v="k">Po kontrolama</button><button class="btn ${st.v === 'p' ? 'on' : ''}" data-v="p">Po podmjerama</button></span>
          <button class="btn" id="k-reset">Poništi</button>
        </div>
        <div id="k-stat" class="legend" aria-live="polite"></div>
      </div>
      <details class="no-print" style="margin:10px 0"><summary><b>Kako se ocjenjuje (metoda iz Priloga B)</b></summary><div class="content">${B.metoda}</div></details>
      <div id="k-out"></div>`;

    const out = $('#k-out'), stat = $('#k-stat'), qEl = $('#kq');
    const sync = () => {
      const p = new URLSearchParams();
      if (st.q) p.set('q', st.q); if (st.pre.length) p.set('pre', st.pre.join(','));
      if (st.lv >= 0) p.set('lv', st.lv); if (st.ob) p.set('ob', '1'); if (st.m) p.set('m', st.m); if (st.v !== 'k') p.set('v', st.v);
      history.replaceState(null, '', '#/kontrole' + (p.toString() ? '?' + p : ''));
    };
    const draw = () => {
      const terms = termsOf(st.q);
      const filt = ROWS.filter((r) => (!st.pre.length || st.pre.includes(r.c.pre)) && (!st.m || r.mjera.broj === st.m)
        && (st.lv < 0 || r.p[st.lv] !== '-') && (!st.ob || st.lv < 0 || r.r[st.lv] !== 'C'));
      let fuzzy = false;
      const match = (fz) => filt.map((r) => {
        let s = 0;
        for (const t of terms) { const x = scoreToken(r, t, fz); if (!x) return null; s += x; }
        return { r, s };
      }).filter(Boolean);
      let hits = match(false);
      if (!hits.length && terms.length) { hits = match(true); fuzzy = hits.length > 0; }
      const lvCls = (i) => (st.lv === i ? ' class="lv-on"' : '');
      const usageRow = (h) => `<tr>
          <td><a href="#/m/${h.r.mjera.broj}?p=${h.r.pid}">${hl(h.r.pid, terms)}</a></td>
          <td>${hl(h.r.naziv, terms)}<div class="legend">Mjera ${h.r.mjera.broj}. ${hl(h.r.mjera.naziv, terms)}</div>${terms.length && !findRanges(h.r.naziv + h.r.mjera.naziv + h.r.c.label + h.r.c.id, terms).length ? `<div class="legend snip">${snippet(strip(h.r.sub.opis), terms, 200)}</div>` : ''}</td>
          ${h.r.r.map((x, i) => `<td${lvCls(i)}><span class="lvl lvl-${x}">${x}</span> <span class="num-c">${esc(h.r.p[i])}</span></td>`).join('')}
          <td class="num-c">${st.lv >= 0 ? esc(h.r.t[st.lv]) : h.r.t.map(esc).join(' / ')}</td>
          <td>${h.r.others.map((o) => `<a class="chip sm" href="#/kontrole?q=${o}">${o}</a>`).join(' ') || '–'}</td></tr>`;
      const head = `<thead><tr><th>Podmjera</th><th>Naziv</th>${LVL.map((l, i) => `<th${lvCls(i)}>${l}</th>`).join('')}<th>Prag podmjere</th><th>Ostale kontrole podmjere</th></tr></thead>`;
      let html = '';
      if (st.v === 'k') {
        const groups = new Map();
        for (const h of hits) { const g = groups.get(h.r.c) || { c: h.r.c, s: 0, rows: [] }; g.s = Math.max(g.s, h.s); g.rows.push(h); groups.set(h.r.c, g); }
        const list = [...groups.values()].sort((a, b) => (terms.length ? b.s - a.s : 0) || a.c.pre.localeCompare(b.c.pre) || a.c.num - b.c.num);
        stat.innerHTML = `${list.length} ${pl(list.length, 'kontrola', 'kontrole', 'kontrola')} · ${hits.length} ${pl(hits.length, 'pojavljivanje', 'pojavljivanja', 'pojavljivanja')}${fuzzy ? ' · <b>približni rezultati</b> (nema točnog pogotka)' : ''}`;
        html = list.slice(0, 150).map((g) => `<div class="card ctrl" id="c-${g.c.id}">
            <div class="ctrl-head"><span class="cid big">${hl(g.c.id, terms)}</span><span class="tag">${hl(g.c.label, terms)}</span>
            <span class="legend">koristi se u ${g.c.uses.length} ${g.c.uses.length === 1 ? 'podmjeri' : 'podmjera'}${g.rows.length < g.c.uses.length ? ` (prikazano ${g.rows.length})` : ''}</span></div>
            <div class="table-wrap"><table class="tbl">${head}<tbody>${g.rows.map(usageRow).join('')}</tbody></table></div></div>`).join('');
        if (list.length > 150) html += `<p class="legend">Prikazano prvih 150 – suzite pretragu.</p>`;
      } else {
        const groups = new Map();
        for (const h of hits) { const g = groups.get(h.r.pid) || { pid: h.r.pid, r: h.r, s: 0 }; g.s = Math.max(g.s, h.s); groups.set(h.r.pid, g); }
        const order = Object.keys(B.tablice);
        const list = [...groups.values()].sort((a, b) => (terms.length ? b.s - a.s : 0) || order.indexOf(a.pid) - order.indexOf(b.pid));
        stat.innerHTML = `${list.length} ${pl(list.length, 'podmjera', 'podmjere', 'podmjera')}${fuzzy ? ' · <b>približni rezultati</b>' : ''}`;
        html = list.map((g) => `<div class="card ctrl">
            <div class="ctrl-head"><a class="cid big" href="#/m/${g.r.mjera.broj}?p=${g.pid}">${hl(g.pid, terms)}</a><b>${hl(g.r.naziv, terms)}</b>
            <span class="legend">Mjera ${g.r.mjera.broj}. ${hl(g.r.mjera.naziv, terms)} · ${g.r.r.map((x, i) => `${LVL[i][0].toUpperCase()} <span class="lvl lvl-${x}">${x}</span>`).join(' ')}</span></div>
            ${kontroleBlock(g.pid, terms).replace('<details class="ctl-block">', '<details class="ctl-block" open>')}</div>`).join('');
      }
      out.innerHTML = html || `<div class="result bad">Nema rezultata za zadane uvjete.</div>`;
      sync();
    };
    let t;
    qEl.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { st.q = qEl.value.trim(); draw(); }, 120); });
    qEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') { qEl.value = ''; st.q = ''; draw(); } });
    $$('.chip[data-pre]', main).forEach((b) => b.addEventListener('click', () => {
      b.classList.toggle('on'); st.pre = $$('.chip[data-pre].on', main).map((x) => x.dataset.pre); draw();
    }));
    $('#k-lv').addEventListener('change', (e) => { st.lv = Number(e.target.value); draw(); });
    $('#k-ob').addEventListener('change', (e) => { st.ob = e.target.checked; draw(); });
    $('#k-m').addEventListener('change', (e) => { st.m = Number(e.target.value); draw(); });
    $$('[data-v]', main).forEach((b) => b.addEventListener('click', () => {
      st.v = b.dataset.v; $$('[data-v]', main).forEach((x) => x.classList.toggle('on', x === b)); draw();
    }));
    $('#k-reset').addEventListener('click', () => { location.hash = '#/kontrole'; });
    out.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#/kontrole?q="]');
      if (!a) return;
      e.preventDefault(); st.q = decodeURIComponent(a.getAttribute('href').split('q=')[1]); qEl.value = st.q; draw(); window.scrollTo(0, 0);
    });
    bindCalc(out);
    draw();
    if (!st.q) qEl.focus({ preventScroll: true });
  }

  /* ---------------- Alat: kategorizacija ---------------- */
  function renderKat(main) {
    const K = DATA.kategorizacija;
    main.innerHTML = `
      <div class="crumb">Alati</div>
      <h1>Je li subjekt obveznik?</h1>
      <div class="art">Zakon čl. 9.–16., Prilozi I. i II.; Uredba čl. 7.–16.</div>
      <div class="warn">Alat daje orijentacijsku procjenu za razgovor s klijentom. Formalnu kategorizaciju provodi nadležno tijelo i o njoj obavještava subjekt (Zakon čl. 17. i 19.).</div>
      <div class="card tool">
        <div class="form-row"><label for="k-vrsta"><b>1. Vrsta subjekta / djelatnost</b></label></div>
        <select id="k-vrsta" style="width:100%">${K.vrste.map((v, i) => `<option value="${i}">${esc(v.naziv)}</option>`).join('')}</select>
        <div class="form-row" style="margin-top:14px"><label for="k-vel"><b>2. Veličina subjekta</b> (Zakon čl. 15.)</label></div>
        <select id="k-vel" style="width:100%">${K.velicine.map((v, i) => `<option value="${i}">${esc(v.naziv)}</option>`).join('')}</select>
        <p class="legend">${K.velicinaNapomena}</p>
        <div class="form-row"><b>3. Posebni kriteriji (Zakon čl. 11., Uredba čl. 7.–12.)</b></div>
        ${K.posebni.map((p, i) => `<label class="form-row" style="margin:4px 0"><input type="checkbox" data-pk="${i}"> <span>${p.naziv}</span></label>`).join('')}
        <div class="form-row"><button class="btn primary" id="k-go">Procijeni</button></div>
        <div id="k-out"></div>
      </div>`;
    $('#k-go').addEventListener('click', () => {
      const v = K.vrste[Number($('#k-vrsta').value)];
      const vel = Number($('#k-vel').value); // 0 mikro, 1 mali, 2 srednji, 3 veliki
      const pk = $$('[data-pk]').filter((c) => c.checked).map((c) => K.posebni[Number(c.dataset.pk)]);
      let res = v.pravilo[vel];
      const notes = [];
      if (pk.length) {
        for (const p of pk) {
          const cat = v.prilog === 'I' ? p.ako1 : v.prilog === 'II' ? p.ako2 : null;
          if (cat) notes.push(`<li>${p.naziv}: <b>${cat}</b> <span class="ref">(${p.izvor})</span></li>`);
          else notes.push(`<li>${p.naziv}: nije primjenjivo na odabranu vrstu subjekta <span class="ref">(${p.izvor})</span>.</li>`);
        }
        const strongest = pk.map((p) => (v.prilog === 'I' ? p.ako1 : v.prilog === 'II' ? p.ako2 : null)).filter(Boolean);
        if (res.k === 'ne' && strongest.length) res = { k: strongest.includes('ključni') ? 'ključni' : 'važni', t: 'Kategorizacija po posebnim kriterijima (čl. 11. Zakona) – neovisno o veličini.' };
        else if (res.k === 'važni' && strongest.includes('ključni')) res = { k: 'ključni', t: res.t + ' Posebni kriterij može dovesti do razvrstavanja u ključne subjekte.' };
      }
      const cls = res.k === 'ne' ? 'bad' : 'ok';
      const label = res.k === 'ne' ? 'Vjerojatno nije ključni ni važni subjekt' : res.k === 'procjena' ? 'Ovisi o procjeni nadležnog tijela' : `Vjerojatno: ${res.k.toUpperCase()} SUBJEKT`;
      $('#k-out').innerHTML = `<div class="result ${cls}"><h3 style="margin-top:0">${label}</h3><p>${res.t}</p>
        ${notes.length ? `<ul>${notes.join('')}</ul>` : ''}
        ${v.napomena ? `<p>${v.napomena}</p>` : ''}
        ${res.k === 'ključni' ? K.posljedice.kljucni : res.k === 'važni' ? K.posljedice.vazni : res.k === 'procjena' ? K.posljedice.procjena : K.posljedice.ne}
        ${v.registar ? K.registarNapomena : ''}</div>`;
    });
  }

  /* ---------------- Alat: incident ---------------- */
  function renderIncident(main) {
    const I = DATA.incident;
    const crit = I.kriteriji.map((g, gi) => `<h3>${g.grupa} <span class="ref">${g.izvor}</span></h3>` +
      g.stavke.map((s, si) => `<label class="form-row" style="margin:4px 0;flex-wrap:nowrap"><input type="checkbox" data-c="${gi}-${si}"> <span>${s}</span></label>`).join('')).join('');
    main.innerHTML = `
      <div class="crumb">Alati</div>
      <h1>Je li incident značajan i koji su rokovi?</h1>
      <div class="art">Zakon čl. 37.–38.; Uredba čl. 58.–71. i 85.</div>
      <div class="card tool">
        <p>Označite sve što je ispunjeno. Incident je značajan ako je ispunjen <b>najmanje jedan</b> kriterij (Uredba čl. 58.).</p>
        ${crit}
        <h3>Isključenje</h3>
        <label class="form-row" style="margin:4px 0;flex-wrap:nowrap"><input type="checkbox" id="i-odrz"> <span>Prekid ili narušena kvaliteta posljedica su isključivo <b>planiranog redovnog održavanja</b> (Uredba čl. 63.)</span></label>
        <h3>Vrijeme saznanja</h3>
        <div class="form-row"><input type="datetime-local" id="i-t"><label><input type="checkbox" id="i-povj"> Subjekt je <b>pružatelj usluga povjerenja</b> (Uredba čl. 68.)</label></div>
        <div class="form-row"><button class="btn primary" id="i-go">Procijeni i izračunaj rokove</button></div>
        <div id="i-out"></div>
      </div>`;
    const now = new Date(); now.setSeconds(0, 0);
    $('#i-t').value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    $('#i-go').addEventListener('click', () => {
      const any = $$('[data-c]').some((c) => c.checked);
      const odrz = $('#i-odrz').checked;
      const out = $('#i-out');
      if (odrz && any) {
        out.innerHTML = `<div class="result"><b>Pažnja:</b> prekidi zbog planiranog redovnog održavanja ne smatraju se značajnim incidentom (čl. 63.). Ako je osim održavanja postojao i drugi uzrok (npr. napad tijekom održavanja), procijenite taj događaj zasebno.</div>`;
        return;
      }
      if (!any) {
        out.innerHTML = `<div class="result bad"><h3 style="margin-top:0">Prema označenom – nije značajan incident</h3><p>${I.nijeZnacajan}</p></div>`;
        return;
      }
      const t0 = new Date($('#i-t').value);
      const povj = $('#i-povj').checked;
      const fmt = (d) => d.toLocaleString('hr-HR', { dateStyle: 'full', timeStyle: 'short' });
      const add = (h) => new Date(t0.getTime() + h * 3600 * 1000);
      const items = [];
      if (!povj) items.push(`<li><b>Rano upozorenje</b> nadležnom CSIRT-u – bez odgode, najkasnije <b>${fmt(add(24))}</b> (24 h; čl. 66.)</li>`);
      items.push(`<li><b>Početna obavijest</b> nadležnom CSIRT-u – bez odgode, najkasnije <b>${fmt(add(povj ? 24 : 72))}</b> (${povj ? '24 h za pružatelje usluga povjerenja; čl. 68.' : '72 h; čl. 67.'})</li>`);
      items.push(`<li><b>Obavijest primateljima usluga</b> na koje incident može utjecati – najkasnije <b>${fmt(add(72))}</b> (72 h; čl. 85.); podatke koji nedostaju dostaviti najkasnije 72 h nakon slanja te obavijesti</li>`);
      items.push(`<li><b>Privremeno izvješće</b> – samo na zahtjev CSIRT-a, u roku koji CSIRT odredi (najmanje 48 h, najviše 7 dana; čl. 69.)</li>`);
      items.push(`<li><b>Završno izvješće</b> – najkasnije 30 dana od dostave početne obavijesti; ako se početna obavijest dostavi u zadnji čas, to je <b>${fmt(add((povj ? 24 : 72) + 30 * 24))}</b> (čl. 70.)</li>`);
      items.push(`<li>Ako incident <b>još traje</b>: umjesto završnog dostavlja se <b>izvješće o napretku</b>; ako traje dulje od 60 dana od početne obavijesti – izvješće o napretku <b>svakih 30 dana</b>, a završno izvješće najkasnije 30 dana od posljednjeg izvješća o napretku (čl. 71.)</li>`);
      items.push(`<li>Ako postoji sumnja na <b>kazneno djelo</b> – obavijest i tijelima kaznenog progona (Zakon čl. 37. st. 3.)</li>`);
      items.push(`<li>Ako je riječ i o <b>povredi osobnih podataka</b> – zasebno postupanje prema čl. 33. i 34. GDPR-a (prijava AZOP-u u 72 h) – Zakon čl. 6. st. 2.</li>`);
      out.innerHTML = `<div class="result ok"><h3 style="margin-top:0">Značajan incident – obveza obavještavanja</h3>
        <p>Vrijeme saznanja: <b>${fmt(t0)}</b></p><ul class="timeline">${items.join('')}</ul>
        <p class="legend">Obavijesti se dostavljaju putem nacionalne platforme (CARNET) kao primarnog kanala (Uredba čl. 94.).</p></div>`;
    });
  }

  /* ---------------- Alat: kontrolna lista ---------------- */
  function renderChecklist(main) {
    const saved = store.get(CHECK_STORE, { lv: 0, b: {}, c: false, di: false, done: {} });
    const B = DATA.uvjetiB;
    main.innerHTML = `
      <div class="crumb">Alati</div>
      <h1>Kontrolna lista mjera po razini</h1>
      <div class="art">Uredba čl. 38., 42.–46., Prilog II. i Prilog III.</div>
      <div class="card tool no-print">
        <div class="form-row"><b>Obvezujuća razina mjera (utvrđuje se kategorizacijom, čl. 38.):</b>
          <select id="c-lv">${LV.map((l, i) => `<option value="${i}" ${saved.lv === i ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="form-row"><b>Uvjeti za podskupove »B«:</b></div>
        ${B.map((b) => `<label class="form-row" style="margin:3px 0;flex-wrap:nowrap"><input type="checkbox" data-b="${b.id}" ${saved.b[b.id] ? 'checked' : ''}> <span>${b.tekst} <span class="ref">(${b.mjere.join(', ')})</span></span></label>`).join('')}
        <label class="form-row" style="margin:3px 0"><input type="checkbox" id="c-c" ${saved.c ? 'checked' : ''}> <span>Prikaži i dobrovoljne podskupove »C« (preporuke)</span></label>
        <label class="form-row" style="margin:3px 0"><input type="checkbox" id="c-di" ${saved.di ? 'checked' : ''}> <span>Subjekt je iz sektora <b>digitalne infrastrukture</b> (dodaje Prilog III.)</span></label>
        <div class="form-row"><button class="btn" onclick="window.print()">Ispiši / spremi kao PDF</button><button class="btn" id="c-clear">Očisti oznake</button></div>
      </div>
      <div id="c-out"></div>`;
    const draw = () => {
      const lv = Number($('#c-lv').value);
      const b = {}; $$('[data-b]').forEach((x) => { b[x.dataset.b] = x.checked; });
      const showC = $('#c-c').checked, di = $('#c-di').checked;
      const st = store.get(CHECK_STORE, { done: {} });
      const done = st.done || {};
      store.set(CHECK_STORE, { lv, b, c: showC, di, done });
      const condOn = (pid) => B.some((x) => x.mjere.includes(pid) && b[x.id]);
      let total = 0, ticked = 0;
      let h = `<h2>Obvezne mjere – ${LV[lv]} razina</h2>`;
      for (const m of DATA.mjere) {
        const items = m.podskupovi.filter((p) => p.r[lv] === 'A' || (p.r[lv] === 'B' && condOn(p.id)) || (showC && p.r[lv] === 'C'));
        if (!items.length) continue;
        h += `<h3><a href="#/m/${m.broj}">Mjera ${m.broj}. ${esc(m.naziv)}</a></h3><ul class="checklist" style="list-style:none;padding-left:0">`;
        for (const p of items) {
          const mand = p.r[lv] !== 'C';
          if (mand) { total++; if (done[p.id]) ticked++; }
          h += `<li><label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" data-done="${p.id}" ${done[p.id] ? 'checked' : ''}>
            <span><span class="lvl lvl-${p.r[lv]}">${p.r[lv]}</span> <b>${p.id}</b> ${esc(p.naziv)}</span></label></li>`;
        }
        h += '</ul>';
      }
      if (di) {
        h += `<h3>Prilog III. – posebne mjere fizičke sigurnosti (digitalna infrastruktura)</h3><ul class="checklist" style="list-style:none;padding-left:0">`;
        DATA.prilog3.forEach((t, i) => {
          const pid = 'P3-' + (i + 1); total++; if (done[pid]) ticked++;
          h += `<li><label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" data-done="${pid}" ${done[pid] ? 'checked' : ''}><span><span class="lvl lvl-A">A</span> <b>P3.${i + 1}</b> ${esc(t)}</span></label></li>`;
        });
        h += '</ul>';
      }
      h = `<div class="key">Obveznih stavki: <b>${total}</b> · označeno kao provedeno: <b>${ticked}</b></div>` + h;
      $('#c-out').innerHTML = h;
      $$('[data-done]').forEach((x) => x.addEventListener('change', () => {
        const s = store.get(CHECK_STORE, {}); s.done = s.done || {}; s.done[x.dataset.done] = x.checked; store.set(CHECK_STORE, s); draw();
      }));
    };
    $$('#c-lv, [data-b], #c-c, #c-di', main).forEach((x) => x.addEventListener('change', draw));
    $('#c-clear').addEventListener('click', () => { const s = store.get(CHECK_STORE, {}); s.done = {}; store.set(CHECK_STORE, s); draw(); });
    draw();
  }

  /* ---------------- Rokovi, pojmovnik ---------------- */
  function renderRokovi(main) {
    const groups = {};
    for (const r of DATA.rokovi) (groups[r.grupa] = groups[r.grupa] || []).push(r);
    main.innerHTML = `<div class="crumb">Pregledi</div><h1>Svi rokovi na jednom mjestu</h1>
      <div class="art">Zakon (NN 14/2024) i Uredba (NN 135/2024)</div>` +
      Object.entries(groups).map(([g, rs]) => `<h2>${esc(g)}</h2><div class="table-wrap"><table class="tbl"><thead><tr><th style="width:22%">Rok</th><th>Obveza</th><th style="width:18%">Tko</th><th style="width:14%">Izvor</th></tr></thead><tbody>
        ${rs.map((r) => `<tr><td><b>${r.rok}</b></td><td>${r.opis}</td><td>${r.tko}</td><td class="ref">${r.izvor}</td></tr>`).join('')}</tbody></table></div>`).join('');
  }

  function renderGlosar(main) {
    const list = [...DATA.glosar].sort((a, b) => a.pojam.localeCompare(b.pojam, 'hr'));
    main.innerHTML = `<div class="crumb">Pregledi</div><h1>Pojmovnik</h1>
      <div class="art">Zakon čl. 4.; Uredba čl. 4.</div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th style="width:26%">Pojam</th><th>Značenje</th><th style="width:16%">Izvor</th></tr></thead><tbody>
      ${list.map((g) => `<tr><td><b>${esc(g.pojam)}</b></td><td>${g.opis}</td><td class="ref">${g.izvor}</td></tr>`).join('')}</tbody></table></div>`;
  }

  /* ---------------- Završni ispit ---------------- */
  function renderIspit(main) {
    main.innerHTML = `<div class="crumb">Provjera</div><h1>Završni ispit</h1>
      <div class="art">Nasumična pitanja iz svih provjera znanja</div>
      <div class="card tool no-print"><div class="form-row">
        <label>Opseg: <select id="e-scope"><option value="all">Zakon i Uredba</option>${DATA.dijelovi.map((p) => `<option value="${p.id}">${esc(p.kratko)}</option>`).join('')}<option value="mjere">Samo 13 mjera</option></select></label>
        <label>Broj pitanja: <select id="e-n"><option>10</option><option selected>20</option><option>30</option><option>50</option></select></label>
        <button class="btn primary" id="e-go">Započni</button></div></div>
      <div id="e-out"></div>`;
    $('#e-go').addEventListener('click', () => {
      const scope = $('#e-scope').value;
      let pool = [];
      for (const f of FLAT) {
        if (scope === 'mjere' && f.type !== 'm') continue;
        if (scope !== 'all' && scope !== 'mjere' && f.part.id !== scope) continue;
        const k = f.type === 'm' ? f.mjera.kviz : f.sec.kviz;
        (k || []).forEach((q) => pool.push({ ...q, q: `${q.q} <span class="ref">(${esc(f.title)})</span>` }));
      }
      pool = shuffle(pool).slice(0, Number($('#e-n').value));
      $('#e-out').innerHTML = quizBlock(null, pool, `Ispit – ${pool.length} pitanja`);
      bindQuiz($('#e-out'), null, pool);
    });
  }
})();
