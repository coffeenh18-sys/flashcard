(() => {
  'use strict';

  const APP_VERSION = 'v6';
  const DB_KEY = 'flashcard_db_v1';
  const THEME_KEY = 'flashcard_theme';
  const DICT_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
  const WIKT_API = 'https://en.wiktionary.org/api/rest_v1/page/definition/';
  const GT_API = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=';
  const MM_API = 'https://api.mymemory.translated.net/get?langpair=en%7Cvi&q=';
  const DAY_MS = 24 * 60 * 60 * 1000;

  // -------- State --------
  let db = loadDB();
  let currentDeckId = db.activeDeckId || (db.decks[0] && db.decks[0].id);
  let session = { queue: [], index: 0, mode: 'due' };

  // -------- Init theme --------
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

  // -------- Elements --------
  const $ = (sel) => document.querySelector(sel);
  const deckSelect = $('#deckSelect');
  const views = {
    learn: $('#view-learn'),
    list: $('#view-list'),
    add: $('#view-add'),
    stats: $('#view-stats'),
  };

  // -------- Routing --------
  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => switchView(t.dataset.view));
  });
  function switchView(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
    Object.entries(views).forEach(([k, el]) => el.classList.toggle('active', k === name));
    if (name === 'learn') startSession();
    if (name === 'list') renderList();
    if (name === 'stats') renderStats();
  }

  // -------- Deck UI --------
  function refreshDeckSelect() {
    deckSelect.innerHTML = '';
    db.decks.forEach((d) => {
      const o = document.createElement('option');
      o.value = d.id; o.textContent = d.name;
      if (d.id === currentDeckId) o.selected = true;
      deckSelect.appendChild(o);
    });
  }
  deckSelect.addEventListener('change', () => {
    currentDeckId = deckSelect.value;
    db.activeDeckId = currentDeckId;
    saveDB();
    const active = document.querySelector('.tab.active')?.dataset.view || 'learn';
    switchView(active);
  });
  $('#newDeckBtn').addEventListener('click', () => {
    const name = prompt('Tên bộ thẻ mới:');
    if (!name) return;
    const d = { id: uid(), name: name.trim(), cards: [] };
    db.decks.push(d);
    currentDeckId = d.id;
    db.activeDeckId = currentDeckId;
    saveDB(); refreshDeckSelect(); switchView('add');
  });

  // -------- Theme --------
  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(THEME_KEY, next);
  });

  // -------- Menu sheet --------
  const menuSheet = $('#menuSheet');
  const installSheet = $('#installSheet');
  $('#menuBtn').addEventListener('click', () => (menuSheet.hidden = false));
  $('#menuClose').addEventListener('click', () => (menuSheet.hidden = true));
  menuSheet.addEventListener('click', (e) => { if (e.target === menuSheet) menuSheet.hidden = true; });
  $('#menuRenameDeck').addEventListener('click', () => {
    const d = currentDeck();
    const n = prompt('Tên mới:', d.name);
    if (n && n.trim()) { d.name = n.trim(); saveDB(); refreshDeckSelect(); menuSheet.hidden = true; }
  });
  $('#menuDeleteDeck').addEventListener('click', () => {
    if (db.decks.length <= 1) return alert('Phải có ít nhất 1 bộ thẻ.');
    if (!confirm('Xóa bộ thẻ hiện tại và toàn bộ thẻ bên trong?')) return;
    db.decks = db.decks.filter((d) => d.id !== currentDeckId);
    currentDeckId = db.decks[0].id;
    db.activeDeckId = currentDeckId;
    saveDB(); refreshDeckSelect(); menuSheet.hidden = true;
    switchView('learn');
  });
  $('#menuInstallHint').addEventListener('click', () => {
    menuSheet.hidden = true; installSheet.hidden = false;
  });
  $('#installClose').addEventListener('click', () => (installSheet.hidden = true));
  installSheet.addEventListener('click', (e) => { if (e.target === installSheet) installSheet.hidden = true; });

  // -------- Add / Lookup --------
  const wordInput = $('#wordInput');
  const posInput = $('#posInput');
  const defInput = $('#defInput');
  const viInput = $('#viInput');
  const exampleInput = $('#exampleInput');
  const phoneticInput = $('#phoneticInput');
  const audioInput = $('#audioInput');
  const editIdInput = $('#editIdInput');
  const lookupStatus = $('#lookupStatus');

  $('#lookupBtn').addEventListener('click', () => doLookup(wordInput.value));
  wordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doLookup(wordInput.value); }
  });
  wordInput.addEventListener('blur', () => {
    const v = wordInput.value.trim();
    if (v && !/\s/.test(v) && !defInput.value && !editIdInput.value) doLookup(v);
  });

  async function fetchWithTimeout(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  }

  async function lookupFreeDictionary(word) {
    try {
      const res = await fetchWithTimeout(DICT_API + encodeURIComponent(word), 10000);
      if (res.status === 404) return { notFound: true };
      if (!res.ok) return null;
      const data = await res.json();
      const entry = Array.isArray(data) ? data[0] : null;
      if (!entry) return null;
      const meanings = entry.meanings || [];
      const posList = [...new Set(meanings.map((m) => m.partOfSpeech).filter(Boolean))];
      const firstDef = meanings[0]?.definitions?.[0];
      return {
        source: 'dictionaryapi',
        word: entry.word || word,
        pos: posList.join(', '),
        def: firstDef?.definition || '',
        example: firstDef?.example || '',
        phonetic: entry.phonetic || (entry.phonetics || []).find((p) => p.text)?.text || '',
        audio: (entry.phonetics || []).find((p) => p.audio)?.audio || '',
      };
    } catch (_) {
      return null;
    }
  }

  async function lookupWiktionary(word) {
    try {
      const res = await fetchWithTimeout(WIKT_API + encodeURIComponent(word), 10000);
      if (res.status === 404) return { notFound: true };
      if (!res.ok) return null;
      const data = await res.json();
      const list = data.en || data.other || [];
      if (!list.length) return null;
      const stripHTML = (html) => {
        const d = document.createElement('div');
        d.innerHTML = html || '';
        return (d.textContent || '').trim();
      };
      const posList = [...new Set(list.map((m) => (m.partOfSpeech || '').toLowerCase()).filter(Boolean))];
      let def = '', example = '';
      for (const m of list) {
        for (const d of (m.definitions || [])) {
          const t = stripHTML(d.definition);
          if (t) { def = t; example = stripHTML((d.examples || [])[0] || ''); break; }
        }
        if (def) break;
      }
      return {
        source: 'wiktionary',
        word,
        pos: posList.join(', '),
        def,
        example,
        phonetic: '',
        audio: '',
      };
    } catch (_) {
      return null;
    }
  }

  async function translateToVi(text) {
    if (!text) return '';
    const q = encodeURIComponent(text);
    try {
      const res = await fetchWithTimeout(GT_API + q, 8000);
      if (res.ok) {
        const data = await res.json();
        const parts = (data[0] || []).map((seg) => seg[0]).filter(Boolean);
        const joined = parts.join('').trim();
        if (joined) return joined;
      }
    } catch (_) {}
    try {
      const res = await fetchWithTimeout(MM_API + q, 8000);
      if (res.ok) {
        const data = await res.json();
        const t = data?.responseData?.translatedText;
        if (t) return t.trim();
      }
    } catch (_) {}
    return '';
  }

  function fillForm(r) {
    posInput.value = r.pos || '';
    defInput.value = r.def || '';
    exampleInput.value = r.example || '';
    phoneticInput.value = r.phonetic || '';
    audioInput.value = r.audio || '';
    wordInput.value = r.word || wordInput.value;
    if (r.vi) viInput.value = r.vi;
  }

  async function doLookup(raw) {
    const word = (raw || '').trim().toLowerCase();
    if (!word) return;
    if (/\s/.test(word)) {
      setStatus('Đang dịch cụm từ…', '');
      const vi = await translateToVi(word);
      if (vi) {
        viInput.value = vi;
        wordInput.value = word;
        setStatus(`Đã dịch: ${vi}`, 'success');
      } else {
        setStatus('Không dịch được. Bạn hãy tự nhập nghĩa rồi Lưu thẻ.', 'error');
      }
      return;
    }

    setStatus('Đang tra từ điển + dịch…', '');
    const [dict, vi] = await Promise.all([
      lookupFreeDictionary(word).then((r) => (r && !r.notFound ? r : null)),
      translateToVi(word),
    ]);

    let r = dict;
    if (!r) {
      r = await lookupWiktionary(word);
      if (r && r.notFound) r = null;
    }

    if (r && r.def) {
      r.vi = vi;
      fillForm(r);
      setStatus(`Đã tìm thấy (${r.source}): ${r.pos || '—'}${vi ? ' • ' + vi : ''}`, 'success');
    } else if (vi) {
      viInput.value = vi;
      wordInput.value = word;
      setStatus(`Chỉ có bản dịch: ${vi}. Hãy tự thêm định nghĩa nếu muốn.`, 'success');
    } else {
      setStatus(`Không tìm thấy "${word}" ở từ điển và không dịch được. Tự nhập nghĩa rồi Lưu thẻ.`, 'error');
    }
  }
  function setStatus(msg, type) {
    lookupStatus.hidden = !msg;
    lookupStatus.textContent = msg || '';
    lookupStatus.className = 'status ' + (type || '');
  }

  $('#addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const word = wordInput.value.trim();
    if (!word) return;
    const deck = currentDeck();
    const editId = editIdInput.value;
    if (editId) {
      const c = deck.cards.find((x) => x.id === editId);
      if (c) {
        c.word = word;
        c.pos = posInput.value.trim();
        c.vi = viInput.value.trim();
        c.def = defInput.value.trim();
        c.example = exampleInput.value.trim();
        c.phonetic = phoneticInput.value.trim();
        c.audio = audioInput.value.trim();
      }
    } else {
      deck.cards.push(newCard({
        word,
        pos: posInput.value.trim(),
        vi: viInput.value.trim(),
        def: defInput.value.trim(),
        example: exampleInput.value.trim(),
        phonetic: phoneticInput.value.trim(),
        audio: audioInput.value.trim(),
      }));
    }
    saveDB();
    clearForm();
    setStatus(editId ? 'Đã cập nhật.' : 'Đã lưu thẻ.', 'success');
    if (!editId) {
      setTimeout(() => wordInput.focus(), 50);
    } else {
      switchView('list');
    }
  });
  $('#clearFormBtn').addEventListener('click', clearForm);
  function clearForm() {
    wordInput.value = ''; posInput.value = ''; defInput.value = '';
    viInput.value = '';
    exampleInput.value = ''; phoneticInput.value = ''; audioInput.value = '';
    editIdInput.value = '';
    setStatus('', '');
  }

  // -------- List view --------
  const cardList = $('#cardList');
  const searchInput = $('#searchInput');
  const listCount = $('#listCount');
  searchInput.addEventListener('input', renderList);

  function renderList() {
    const deck = currentDeck();
    const q = searchInput.value.trim().toLowerCase();
    const items = deck.cards
      .filter((c) => {
        if (!q) return true;
        return (
          c.word.toLowerCase().includes(q) ||
          (c.def || '').toLowerCase().includes(q) ||
          (c.vi || '').toLowerCase().includes(q) ||
          (c.pos || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.word.localeCompare(b.word));

    listCount.textContent = `${items.length} / ${deck.cards.length}`;
    cardList.innerHTML = '';
    if (!items.length) {
      cardList.innerHTML = `<div class="empty"><p>Chưa có thẻ nào.</p><p class="muted">Bấm tab <b>Thêm từ</b> để bắt đầu.</p></div>`;
      return;
    }
    const frag = document.createDocumentFragment();
    for (const c of items) {
      const el = document.createElement('div');
      el.className = 'list-item';
      el.innerHTML = `
        <div>
          <span class="li-word">${escapeHTML(c.word)}</span>
          ${c.pos ? `<span class="li-pos">${escapeHTML(c.pos)}</span>` : ''}
        </div>
        <div class="li-actions">
          <button class="edit" title="Sửa">✎</button>
          <button class="del" title="Xóa">✕</button>
        </div>
        <div class="li-def">${c.vi ? '<b>' + escapeHTML(c.vi) + '</b>' : ''}${c.vi && c.def ? ' — ' : ''}${escapeHTML(c.def || '')}</div>
      `;
      el.querySelector('.edit').addEventListener('click', () => editCard(c.id));
      el.querySelector('.del').addEventListener('click', () => {
        if (confirm(`Xóa thẻ "${c.word}"?`)) {
          const d = currentDeck();
          d.cards = d.cards.filter((x) => x.id !== c.id);
          saveDB(); renderList();
        }
      });
      frag.appendChild(el);
    }
    cardList.appendChild(frag);
  }
  function editCard(id) {
    const c = currentDeck().cards.find((x) => x.id === id);
    if (!c) return;
    wordInput.value = c.word;
    posInput.value = c.pos || '';
    viInput.value = c.vi || '';
    defInput.value = c.def || '';
    exampleInput.value = c.example || '';
    phoneticInput.value = c.phonetic || '';
    audioInput.value = c.audio || '';
    editIdInput.value = c.id;
    switchView('add');
  }

  // -------- Learn / SRS --------
  const cardEl = $('#card');
  const cardWord = $('#cardWord');
  const cardPhonetic = $('#cardPhonetic');
  const cardPos = $('#cardPos');
  const cardVi = $('#cardVi');
  const cardDef = $('#cardDef');
  const cardExample = $('#cardExample');
  const audioBtn = $('#audioBtn');
  const audioPlayer = $('#audioPlayer');
  const rateRow = $('#rateRow');
  const emptyLearn = $('#emptyLearn');
  const learnProgress = $('#learnProgress');

  document.querySelectorAll('input[name="mode"]').forEach((r) => {
    r.addEventListener('change', (e) => { session.mode = e.target.value; startSession(); });
  });
  cardEl.addEventListener('click', () => {
    if (!session.queue.length) return;
    cardEl.classList.add('flipped');
    rateRow.hidden = false;
    refreshIntervalLabels();
  });
  audioBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const c = currentCardForSession();
    if (!c) return;
    speak(c);
  });
  rateRow.querySelectorAll('.rate').forEach((btn) => {
    btn.addEventListener('click', () => {
      const q = parseInt(btn.dataset.q, 10);
      const c = currentCardForSession();
      if (c) applySM2(c, q);
      saveDB();
      nextCard();
    });
  });

  function startSession() {
    const deck = currentDeck();
    const now = Date.now();
    let pool = deck.cards.slice();
    if (session.mode === 'due') pool = pool.filter((c) => (c.due || 0) <= now);
    if (session.mode === 'shuffle') shuffle(pool);
    else pool.sort((a, b) => (a.due || 0) - (b.due || 0));
    session.queue = pool;
    session.index = 0;
    showCurrent();
  }
  function showCurrent() {
    const total = session.queue.length;
    if (!total) {
      emptyLearn.hidden = false;
      cardEl.style.display = 'none';
      rateRow.hidden = true;
      learnProgress.textContent = '0 / 0';
      return;
    }
    emptyLearn.hidden = true;
    cardEl.style.display = '';
    cardEl.classList.remove('flipped');
    rateRow.hidden = true;
    const c = session.queue[session.index];
    cardWord.textContent = c.word;
    cardPhonetic.textContent = c.phonetic || '';
    cardPos.textContent = c.pos || '';
    cardVi.textContent = c.vi || '';
    cardDef.textContent = c.def || '';
    cardExample.textContent = c.example ? '"' + c.example + '"' : '';
    learnProgress.textContent = (session.index + 1) + ' / ' + total;
  }
  function nextCard() {
    session.index++;
    if (session.index >= session.queue.length) {
      session.queue = [];
      showCurrent();
    } else {
      showCurrent();
    }
  }
  function currentCardForSession() {
    return session.queue[session.index];
  }

  // SM-2 lite
  function applySM2(card, q) {
    const now = Date.now();
    card.reps = card.reps || 0;
    card.interval = card.interval || 0;
    card.ease = card.ease || 2.5;

    if (q < 3) {
      card.reps = 0;
      card.interval = 0;
      card.due = now + 60 * 1000;
    } else {
      if (card.reps === 0) card.interval = 1;
      else if (card.reps === 1) card.interval = card.ease < 2 ? 3 : 4;
      else card.interval = Math.round(card.interval * card.ease);
      card.reps++;
      card.ease = Math.max(1.3, card.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
      card.due = now + card.interval * DAY_MS;
    }
    card.lastReview = now;
    if (q >= 3 && card.interval >= 21) card.learned = true;
  }
  function refreshIntervalLabels() {
    const c = currentCardForSession();
    if (!c) return;
    const sim = (q) => {
      const copy = { reps: c.reps || 0, interval: c.interval || 0, ease: c.ease || 2.5 };
      if (q < 3) return '<1m';
      if (copy.reps === 0) copy.interval = 1;
      else if (copy.reps === 1) copy.interval = copy.ease < 2 ? 3 : 4;
      else copy.interval = Math.round(copy.interval * copy.ease);
      return copy.interval >= 1 ? copy.interval + 'd' : '<1d';
    };
    $('#hardInt').textContent = '~10 phút';
    $('#goodInt').textContent = sim(3);
    $('#easyInt').textContent = sim(4);
  }

  function speak(card) {
    if (card.audio) {
      try {
        audioPlayer.src = card.audio;
        audioPlayer.play().catch(() => speakFallback(card.word));
        return;
      } catch (_) {}
    }
    speakFallback(card.word);
  }
  function speakFallback(text) {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.95;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  // -------- Stats --------
  function renderStats() {
    const deck = currentDeck();
    const now = Date.now();
    const total = deck.cards.length;
    const due = deck.cards.filter((c) => (c.due || 0) <= now).length;
    const fresh = deck.cards.filter((c) => !c.lastReview).length;
    const learned = deck.cards.filter((c) => c.learned).length;
    $('#statTotal').textContent = total;
    $('#statDue').textContent = due;
    $('#statNew').textContent = fresh;
    $('#statLearned').textContent = learned;
  }

  // -------- Import / Export / Wipe --------
  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'flashcard-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  });
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.decks)) throw new Error('File không hợp lệ.');
      if (confirm('Nhập dữ liệu sẽ ghi đè dữ liệu hiện tại. Tiếp tục?')) {
        db = data;
        currentDeckId = db.activeDeckId || db.decks[0]?.id;
        saveDB();
        refreshDeckSelect();
        switchView('learn');
      }
    } catch (err) {
      alert('Lỗi: ' + err.message);
    } finally {
      e.target.value = '';
    }
  });
  $('#wipeBtn').addEventListener('click', () => {
    if (!confirm('Xóa TOÀN BỘ dữ liệu? Hành động không thể hoàn tác.')) return;
    localStorage.removeItem(DB_KEY);
    db = loadDB();
    currentDeckId = db.decks[0].id;
    saveDB();
    refreshDeckSelect();
    switchView('learn');
  });

  // -------- Helpers --------
  function currentDeck() {
    return db.decks.find((d) => d.id === currentDeckId) || db.decks[0];
  }
  function newCard(partial) {
    return Object.assign({
      id: uid(),
      createdAt: Date.now(),
      due: Date.now(),
      interval: 0,
      ease: 2.5,
      reps: 0,
      lastReview: 0,
      learned: false,
    }, partial);
  }
  function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function loadDB() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.decks) && data.decks.length) return data;
      }
    } catch (_) {}
    const first = { id: uid(), name: 'Bộ thẻ của tôi', cards: [] };
    return { decks: [first], activeDeckId: first.id };
  }
  function saveDB() {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (_) {}
  }

  // -------- Service worker (offline) --------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  // -------- Boot --------
  refreshDeckSelect();
  startSession();
  const brand = document.querySelector('.brand');
  if (brand && !brand.querySelector('.ver')) {
    const v = document.createElement('span');
    v.className = 'ver';
    v.textContent = APP_VERSION;
    v.style.cssText = 'font-size:10px;color:var(--muted);font-weight:500;margin-left:4px;';
    brand.appendChild(v);
  }
})();
