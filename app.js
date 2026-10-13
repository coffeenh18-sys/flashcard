(() => {
  'use strict';

  const APP_VERSION = 'v8';
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
  const viInput = $('#viInput');
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
    if (v && !/\s/.test(v) && !viInput.value && !editIdInput.value) doLookup(v);
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
      const res = await fetchWithTimeout(DICT_API + encodeURIComponent(word), 5000);
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
        phonetic: entry.phonetic || (entry.phonetics || []).find((p) => p.text)?.text || '',
        audio: (entry.phonetics || []).find((p) => p.audio)?.audio || '',
      };
    } catch (_) {
      return null;
    }
  }

  async function lookupWiktionary(word) {
    try {
      const res = await fetchWithTimeout(WIKT_API + encodeURIComponent(word), 7000);
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
      let def = '';
      for (const m of list) {
        for (const d of (m.definitions || [])) {
          const t = stripHTML(d.definition);
          if (t) { def = t; break; }
        }
        if (def) break;
      }
      return {
        source: 'wiktionary',
        word,
        pos: posList.join(', '),
        def,
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

  async function doLookup(raw) {
    const word = (raw || '').trim().toLowerCase();
    if (!word) return;
    wordInput.value = word;

    setStatus('Đang tra…', '');
    const isPhrase = /\s/.test(word);

    // Fire translation immediately — nhanh nhất, hiện trước
    const viPromise = translateToVi(word).then((vi) => {
      if (vi && !viInput.value) viInput.value = vi;
      return vi;
    });

    if (isPhrase) {
      const vi = await viPromise;
      setStatus(vi ? `Đã dịch: ${vi}` : 'Không dịch được. Hãy tự nhập nghĩa.', vi ? 'success' : 'error');
      return;
    }

    // Dict API + Wiktionary race — lấy cái nào trả về trước và có nghĩa
    const dictPromise = (async () => {
      const results = await Promise.allSettled([
        lookupFreeDictionary(word),
        lookupWiktionary(word),
      ]);
      for (const p of results) {
        if (p.status === 'fulfilled' && p.value && p.value.def) return p.value;
      }
      return null;
    })();

    const [dict, vi] = await Promise.all([dictPromise, viPromise]);

    if (dict) {
      if (!posInput.value) posInput.value = dict.pos || '';
      if (!phoneticInput.value && dict.phonetic) phoneticInput.value = dict.phonetic;
      if (!audioInput.value && dict.audio) audioInput.value = dict.audio;
    }

    if (dict && vi) {
      setStatus(`${vi} • ${dict.pos || dict.source}`, 'success');
    } else if (vi) {
      setStatus(`Đã dịch: ${vi}` + (dict ? '' : ' (không có định nghĩa tiếng Anh)'), 'success');
    } else if (dict) {
      setStatus(`Có định nghĩa (${dict.source}), chưa dịch được tiếng Việt.`, 'success');
    } else {
      setStatus(`Không tra được "${word}". Tự nhập nghĩa rồi Lưu thẻ.`, 'error');
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
        c.phonetic = phoneticInput.value.trim();
        c.audio = audioInput.value.trim();
      }
    } else {
      deck.cards.push(newCard({
        word,
        pos: posInput.value.trim(),
        vi: viInput.value.trim(),
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
    wordInput.value = ''; posInput.value = '';
    viInput.value = '';
    phoneticInput.value = ''; audioInput.value = '';
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
        <div class="li-def">${escapeHTML(c.vi || '')}</div>
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
    phoneticInput.value = c.phonetic || '';
    audioInput.value = c.audio || '';
    editIdInput.value = c.id;
    switchView('add');
  }

  // -------- Learn / SRS --------
  const cardEl = $('#card');
  const cardWord = $('#cardWord');
  const cardPhonetic = $('#cardPhonetic');
  const cardPhoneticBack = $('#cardPhoneticBack');
  const cardPos = $('#cardPos');
  const cardVi = $('#cardVi');
  const audioBtn = $('#audioBtn');
  const audioPlayer = $('#audioPlayer');
  const rateRow = $('#rateRow');
  const emptyLearn = $('#emptyLearn');
  const learnProgress = $('#learnProgress');

  document.querySelectorAll('input[name="mode"]').forEach((r) => {
    r.addEventListener('change', (e) => { session.mode = e.target.value; startSession(); });
  });
  let touchStart = null;
  let swipeConsumed = false;
  cardEl.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY, time: Date.now(), moved: false };
    swipeConsumed = false;
  }, { passive: true });
  cardEl.addEventListener('touchmove', (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) touchStart.moved = true;
  }, { passive: true });
  cardEl.addEventListener('touchend', (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    const dt = Date.now() - touchStart.time;
    const moved = touchStart.moved;
    touchStart = null;
    if (moved && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3 && dt < 700) {
      swipeConsumed = true;
      handleSwipe(dx > 0 ? 'right' : 'left');
    }
  });
  cardEl.addEventListener('click', () => {
    if (swipeConsumed) { swipeConsumed = false; return; }
    flipCard();
  });
  function flipCard() {
    if (!session.queue.length) return;
    cardEl.classList.add('flipped');
    rateRow.hidden = false;
    refreshIntervalLabels();
  }
  function handleSwipe(dir) {
    if (!session.queue.length) return;
    if (dir === 'left') {
      const c = currentCardForSession();
      if (c && cardEl.classList.contains('flipped')) applySM2(c, 3);
      saveDB();
      animateOut('left', () => nextCard());
    } else {
      animateOut('right', () => prevCard());
    }
  }
  function animateOut(dir, done) {
    const x = dir === 'left' ? -120 : 120;
    cardEl.style.transition = 'transform 0.25s ease-out, opacity 0.25s';
    cardEl.style.transform = `translateX(${x}%) rotate(${x / 20}deg)`;
    cardEl.style.opacity = '0';
    setTimeout(() => {
      cardEl.style.transition = '';
      cardEl.style.transform = '';
      cardEl.style.opacity = '';
      done();
    }, 240);
  }
  function prevCard() {
    if (session.index > 0) session.index--;
    showCurrent();
  }
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('.view.active')?.id !== 'view-learn') return;
    if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === 'ArrowRight') handleSwipe('left');
    else if (e.key === 'ArrowLeft') handleSwipe('right');
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flipCard(); }
  });
  const audioHandler = (e) => {
    e.stopPropagation();
    const c = currentCardForSession();
    if (!c) return;
    speak(c);
  };
  audioBtn.addEventListener('click', audioHandler);
  $('#audioBtnBack').addEventListener('click', audioHandler);
  // Prevent swipe from firing when tapping audio button
  const stopTouch = (e) => e.stopPropagation();
  audioBtn.addEventListener('touchstart', stopTouch, { passive: true });
  audioBtn.addEventListener('touchend', stopTouch, { passive: true });
  $('#audioBtnBack').addEventListener('touchstart', stopTouch, { passive: true });
  $('#audioBtnBack').addEventListener('touchend', stopTouch, { passive: true });
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
    cardPhoneticBack.textContent = c.phonetic || '';
    cardPos.textContent = c.pos || '';
    cardVi.textContent = c.vi || '';
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

  let englishVoice = null;
  function pickEnglishVoice() {
    if (!('speechSynthesis' in window)) return;
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return;
    englishVoice =
      voices.find((v) => /en[-_]US/i.test(v.lang) && /Samantha|Alex|Siri|Enhanced|Daniel|Karen/i.test(v.name)) ||
      voices.find((v) => /en[-_]US/i.test(v.lang)) ||
      voices.find((v) => /^en/i.test(v.lang)) ||
      null;
  }
  if ('speechSynthesis' in window) {
    pickEnglishVoice();
    speechSynthesis.onvoiceschanged = pickEnglishVoice;
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
    if (!englishVoice) pickEnglishVoice();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = englishVoice?.lang || 'en-US';
    if (englishVoice) u.voice = englishVoice;
    u.rate = 0.9;
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
