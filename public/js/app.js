/* ============================================================
   Ficha de Personagem — SPA
   Fluxo: login (senha fixa) -> lista de fichas -> ficha (4 abas)
   Todos os campos usam [data-f="chave"]; o estado e um objeto
   plano { chave: valor } salvo como JSONB no servidor.
   ============================================================ */

(() => {
  'use strict';

  /* ---------------- Estado ---------------- */

  let currentSheetId = null;
  let sheetData = {};        // dados da ficha aberta
  let saveTimer = null;
  let dirty = false;

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  const views = {
    login: $('#view-login'),
    list: $('#view-list'),
    sheet: $('#view-sheet'),
  };

  /* ---------------- API ---------------- */

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...options,
    });
    if (res.status === 401 && path !== '/api/login') {
      showView('login');
      throw new Error('Não autenticado');
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Erro ${res.status}`);
    }
    return res.json();
  }

  /* ---------------- Navegacao ---------------- */

  function showView(name) {
    Object.entries(views).forEach(([k, el]) => { el.hidden = k !== name; });
  }

  function setLoading(on) {
    $('#loading').hidden = !on;
  }

  async function route() {
    const hash = location.hash;
    const m = hash.match(/^#\/ficha\/([0-9a-f-]{36})$/i);
    try {
      const { authenticated } = await api('/api/session');
      if (!authenticated) { showView('login'); return; }
      if (m) {
        await openSheet(m[1]);
      } else {
        await openList();
      }
    } catch {
      showView('login');
    }
  }

  /* ---------------- Login ---------------- */

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#login-error');
    errEl.hidden = true;
    const btn = $('#login-btn');
    btn.disabled = true;
    btn.textContent = 'Entrando...';
    try {
      await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ password: $('#login-password').value }),
      });
      $('#login-password').value = '';
      location.hash = '';
      await openList();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  });

  async function logout() {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    location.hash = '';
    showView('login');
  }
  $('#btn-logout').addEventListener('click', logout);
  $('#btn-logout-2').addEventListener('click', logout);

  /* ---------------- Lista de fichas ---------------- */

  async function openList() {
    setLoading(true);
    try {
      const sheets = await api('/api/sheets');
      const listEl = $('#sheet-list');
      listEl.innerHTML = '';
      $('#list-empty').hidden = sheets.length > 0;
      for (const s of sheets) {
        const card = document.createElement('div');
        card.className = 'sheet-card';
        const date = new Date(s.updated_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
        card.innerHTML = `
          <div>
            <div class="sheet-card-name"></div>
            <div class="sheet-card-date">Atualizada em ${date}</div>
          </div>
          <button class="btn btn-danger" data-del title="Excluir ficha">Excluir</button>`;
        card.querySelector('.sheet-card-name').textContent = s.name || 'Sem nome';
        card.addEventListener('click', (e) => {
          if (e.target.closest('[data-del]')) return;
          location.hash = `#/ficha/${s.id}`;
        });
        card.querySelector('[data-del]').addEventListener('click', async () => {
          if (!confirm(`Excluir a ficha "${s.name}"? Essa ação não pode ser desfeita.`)) return;
          await api(`/api/sheets/${s.id}`, { method: 'DELETE' });
          openList();
        });
        listEl.appendChild(card);
      }
      showView('list');
    } finally {
      setLoading(false);
    }
  }

  $('#btn-new-sheet').addEventListener('click', async () => {
    setLoading(true);
    try {
      const sheet = await api('/api/sheets', { method: 'POST' });
      location.hash = `#/ficha/${sheet.id}`;
    } finally {
      setLoading(false);
    }
  });

  $('#btn-back').addEventListener('click', async () => {
    await flushSave();
    location.hash = '';
  });

  /* ---------------- Construcao dos blocos dinamicos ---------------- */

  const ATTRS = [
    { key: 'for', label: 'For' },
    { key: 'agi', label: 'Agi' },
    { key: 'vig', label: 'Vig' },
    { key: 'esp', label: 'Esp' },
    { key: 'pre', label: 'Pre' },
  ];

  const SKILLS = [
    { key: 'acrobacia', label: 'Acrobacia' },
    { key: 'arcanismo', label: 'Arcanismo' },
    { key: 'atletismo', label: 'Atletismo' },
    { key: 'cienciaMagica', label: 'Ciência Mágica' },
    { key: 'enganacao', label: 'Enganação' },
    { key: 'furtividade', label: 'Furtividade' },
    { key: 'historia', label: 'História' },
    { key: 'intimidacao', label: 'Intimidação' },
    { key: 'intuicao', label: 'Intuição' },
    { key: 'investigacao', label: 'Investigação' },
    { key: 'lidarAnimais', label: 'Lidar c/ Animais' },
    { key: 'mecanica', label: 'Mecânica' },
    { key: 'medicina', label: 'Medicina' },
    { key: 'montaria', label: 'Montaria' },
    { key: 'natureza', label: 'Natureza' },
    { key: 'ocultismo', label: 'Ocultismo' },
    { key: 'oficio1', label: 'Ofício', editable: true },
    { key: 'oficio2', label: 'Ofício', editable: true },
    { key: 'percepcao', label: 'Percepção' },
    { key: 'performance', label: 'Performance' },
    { key: 'persuasao', label: 'Persuasão' },
    { key: 'prestidigitacao', label: 'Prestidigitação' },
    { key: 'religiao', label: 'Religião' },
    { key: 'sobrevivencia', label: 'Sobrevivência' },
  ];

  const ABILITY_FIELDS = [
    ['tipo', 'Tipo'], ['gasto', 'Gasto'], ['acao', 'Ação'],
    ['alcance', 'Alcance'], ['duracao', 'Duração'],
  ];

  const SPELL_FIELDS = [
    ['dizer', 'Dizer'], ['tipo', 'Tipo'], ['acao', 'Ação'],
    ['alcance', 'Alcance'], ['duracao', 'Duração'],
  ];

  function buildStaticBlocks() {
    // Atributos (losangos)
    $('#attrs').innerHTML = ATTRS.map(a => `
      <div class="attr">
        <span class="attr-name">${a.label}</span>
        <div class="attr-diamond"><input data-f="attr.${a.key}" inputmode="numeric"></div>
        <label class="attr-temp">Temp <input data-f="attr.${a.key}.temp" inputmode="numeric"></label>
      </div>`).join('');

    // Pontos de Alma (5 losangos clicaveis)
    $('#alma-diamonds').innerHTML = Array.from({ length: 5 }, (_, i) =>
      `<button type="button" class="diamond-toggle" data-t="alma.${i + 1}" aria-pressed="false" aria-label="Ponto de alma ${i + 1}"></button>`
    ).join('');

    // Testes contra a morte (3 sucessos / 3 falhas)
    $('#death-success').innerHTML = Array.from({ length: 3 }, (_, i) =>
      `<button type="button" class="hex-toggle hex-ok" data-t="morte.sucesso.${i + 1}" aria-pressed="false" aria-label="Sucesso ${i + 1}"></button>`
    ).join('');
    $('#death-fail').innerHTML = Array.from({ length: 3 }, (_, i) =>
      `<button type="button" class="hex-toggle hex-bad" data-t="morte.falha.${i + 1}" aria-pressed="false" aria-label="Falha ${i + 1}"></button>`
    ).join('');

    // Ataques (6 linhas)
    $('#attacks').innerHTML = Array.from({ length: 6 }, (_, i) => `
      <div class="attack-row">
        <input data-f="ataque.${i}.nome" placeholder="—">
        <input data-f="ataque.${i}.bonus" placeholder="+0">
        <input data-f="ataque.${i}.dano" placeholder="1d8">
        <input data-f="ataque.${i}.notas">
      </div>`).join('');

    // Pericias
    $('#skills').innerHTML = SKILLS.map(s => `
      <div class="skill-row" data-skill="${s.key}">
        <span class="skill-name">${s.editable
          ? `<input data-f="pericia.${s.key}.nome" placeholder="${s.label}...">`
          : s.label}</span>
        <input data-f="pericia.${s.key}.ante" inputmode="numeric" aria-label="${s.label}: antecedente">
        <input data-f="pericia.${s.key}.treino" inputmode="numeric" aria-label="${s.label}: treino">
        <input data-f="pericia.${s.key}.estatr" inputmode="numeric" aria-label="${s.label}: estilo/atributo">
        <input data-f="pericia.${s.key}.total" inputmode="numeric" class="skill-total" aria-label="${s.label}: total">
      </div>`).join('');

    // Maestrias (4 linhas)
    $('#maestrias').innerHTML = Array.from({ length: 4 }, (_, i) => `
      <div class="maestria-row">
        <input data-f="maestria.${i}.nome" placeholder="Ex.: Espada">
        <input data-f="maestria.${i}.bonus" placeholder="+0">
      </div>`).join('');

    // Aliados (3 blocos com 3 marcas de lealdade)
    $('#aliados').innerHTML = Array.from({ length: 3 }, (_, i) => `
      <div class="ally">
        <textarea data-f="aliado.${i}.nome" rows="2" placeholder="Nome e notas do aliado..."></textarea>
        <div class="ally-loyalty">Lealdade
          ${[1, 2, 3].map(n =>
            `<button type="button" class="loyalty-box" data-t="aliado.${i}.lealdade.${n}" aria-pressed="false" aria-label="Lealdade ${n}"></button>`
          ).join('')}
        </div>
      </div>`).join('');

    // Habilidades do Caminho (8 cards)
    $('#habilidades').innerHTML = Array.from({ length: 8 }, (_, i) => `
      <div class="ability-card">
        <label class="fld card-head"><span>Nome</span><input data-f="hab.${i}.nome"></label>
        <div class="card-fields">
          ${ABILITY_FIELDS.map(([k, lbl]) =>
            `<label class="fld"><span>${lbl}</span><input data-f="hab.${i}.${k}"></label>`
          ).join('')}
        </div>
        <textarea data-f="hab.${i}.descricao" rows="3" placeholder="Descrição..."></textarea>
      </div>`).join('');

    // Magias (6 cards)
    $('#magias').innerHTML = Array.from({ length: 6 }, (_, i) => `
      <div class="ability-card">
        <label class="fld card-head"><span>Nome</span><input data-f="magia.${i}.nome"></label>
        <div class="card-fields">
          ${SPELL_FIELDS.map(([k, lbl]) =>
            `<label class="fld"><span>${lbl}</span><input data-f="magia.${i}.${k}"></label>`
          ).join('')}
        </div>
        <textarea data-f="magia.${i}.descricao" rows="3" placeholder="Descrição..."></textarea>
      </div>`).join('');
  }

  /* ---------------- Binding de dados ---------------- */

  function fillForm() {
    $$('[data-f]').forEach(el => {
      el.value = sheetData[el.dataset.f] ?? '';
    });
    $$('[data-t]').forEach(el => {
      el.setAttribute('aria-pressed', sheetData[el.dataset.t] ? 'true' : 'false');
    });
    applyAutoTotalMode();
    recalcAllTotals();
  }

  function onFieldInput(e) {
    const el = e.target;
    if (!el.dataset.f) return;
    sheetData[el.dataset.f] = el.value;
    if (/^pericia\..+\.(ante|treino|estatr)$/.test(el.dataset.f)) {
      recalcTotal(el.closest('.skill-row'));
    }
    scheduleSave();
  }

  function onToggleClick(e) {
    const btn = e.target.closest('[data-t]');
    if (!btn) return;
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    sheetData[btn.dataset.t] = on;
    scheduleSave();
  }

  /* ---------------- Totais de pericia ---------------- */

  function autoTotalOn() { return $('#auto-total').checked; }

  function num(v) {
    const n = parseInt(String(v ?? '').replace(',', '.'), 10);
    return Number.isFinite(n) ? n : 0;
  }

  function recalcTotal(row) {
    if (!row || !autoTotalOn()) return;
    const key = row.dataset.skill;
    const total =
      num(sheetData[`pericia.${key}.ante`]) +
      num(sheetData[`pericia.${key}.treino`]) +
      num(sheetData[`pericia.${key}.estatr`]);
    const parts = [`pericia.${key}.ante`, `pericia.${key}.treino`, `pericia.${key}.estatr`]
      .some(f => String(sheetData[f] ?? '').trim() !== '');
    const val = parts ? String(total) : '';
    sheetData[`pericia.${key}.total`] = val;
    row.querySelector('.skill-total').value = val;
  }

  function recalcAllTotals() {
    if (!autoTotalOn()) return;
    $$('.skill-row').forEach(recalcTotal);
  }

  function applyAutoTotalMode() {
    const auto = autoTotalOn();
    $$('.skill-total').forEach(inp => {
      inp.readOnly = auto;
      inp.tabIndex = auto ? -1 : 0;
    });
  }

  $('#auto-total').addEventListener('change', () => {
    sheetData['config.autoTotal'] = autoTotalOn();
    applyAutoTotalMode();
    recalcAllTotals();
    scheduleSave();
  });

  /* ---------------- Salvamento automatico ---------------- */

  const statusEl = $('#save-status');

  function setStatus(state, text) {
    statusEl.dataset.state = state;
    statusEl.textContent = text;
  }

  function scheduleSave() {
    dirty = true;
    setStatus('saving', 'Alterações pendentes...');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 900);
  }

  async function saveNow() {
    if (!currentSheetId || !dirty) return;
    dirty = false;
    setStatus('saving', 'Salvando...');
    try {
      await api(`/api/sheets/${currentSheetId}`, {
        method: 'PUT',
        body: JSON.stringify({ data: sheetData }),
      });
      if (!dirty) setStatus('saved', 'Salvo');
    } catch (err) {
      if (err.message === 'Não autenticado') {
        setStatus('error', 'Sessão expirada — entre de novo');
        return;
      }
      dirty = true;
      setStatus('error', 'Erro ao salvar — tentando de novo...');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveNow, 4000);
    }
  }

  async function flushSave() {
    clearTimeout(saveTimer);
    if (dirty) await saveNow();
  }

  // tenta salvar ao sair/fechar a pagina
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && dirty && currentSheetId) {
      navigator.sendBeacon?.(
        `/api/sheets/${currentSheetId}?beacon=1`,
        new Blob([JSON.stringify({ data: sheetData })], { type: 'application/json' })
      );
    }
  });

  /* ---------------- Abrir ficha ---------------- */

  async function openSheet(id) {
    setLoading(true);
    try {
      const sheet = await api(`/api/sheets/${id}`);
      currentSheetId = sheet.id;
      sheetData = sheet.data || {};
      $('#auto-total').checked = sheetData['config.autoTotal'] !== false;
      fillForm();
      setStatus('saved', 'Salvo');
      // volta para a primeira aba
      activateTab('tab-ficha');
      showView('sheet');
      window.scrollTo(0, 0);
    } catch (err) {
      alert(err.message);
      location.hash = '';
    } finally {
      setLoading(false);
    }
  }

  /* ---------------- Abas ---------------- */

  function activateTab(id) {
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id));
    $$('.tabpane').forEach(p => p.classList.toggle('active', p.id === id));
  }

  $('#tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) activateTab(tab.dataset.tab);
  });

  /* ---------------- Inicializacao ---------------- */

  buildStaticBlocks();

  const sheetView = views.sheet;
  sheetView.addEventListener('input', onFieldInput);
  sheetView.addEventListener('click', onToggleClick);

  window.addEventListener('hashchange', route);
  route();
})();
