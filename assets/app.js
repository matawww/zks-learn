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
    let h = '<a href="#/">Početna</a>';
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
