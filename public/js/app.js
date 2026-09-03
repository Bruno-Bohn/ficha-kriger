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
  let currentUser = null;

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  const views = {
    login: $('#view-login'),
    list: $('#view-list'),
    sheet: $('#view-sheet'),
    admin: $('#view-admin'),
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
      const { authenticated, user } = await api('/api/session');
      if (!authenticated) { showView('login'); return; }
      currentUser = user;
      $('#btn-admin').hidden = user.role !== 'admin';
      if (hash === '#/admin') {
        if (user.role !== 'admin') { location.hash = ''; return; }
        await openAdmin();
        return;
      }
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
        body: JSON.stringify({
          username: $('#login-username').value,
          password: $('#login-password').value,
        }),
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
  $('#btn-admin-logout').addEventListener('click', logout);

  /* ---------------- Administração ---------------- */

  async function openAdmin() {
    setLoading(true);
    try {
      const users = await api('/api/admin/users');
      const list = $('#admin-users');
      list.innerHTML = users.map(user => `
        <article class="admin-user ${user.active ? '' : 'is-inactive'}" data-user-id="${user.id}">
          <div class="admin-user-info">
            <strong>${escapeHtml(user.username)}</strong>
            <span>${user.role === 'admin' ? 'Administrador' : 'Usuário'} · ${user.sheet_count} ficha${user.sheet_count === 1 ? '' : 's'}</span>
          </div>
          <div class="admin-user-actions">
            ${user.role === 'admin' ? '<span class="admin-badge">Conta principal</span>' : `
              <button type="button" class="btn btn-ghost" data-reset-password>Alterar senha</button>
              <button type="button" class="btn ${user.active ? 'btn-danger' : 'btn-primary'}" data-toggle-user="${!user.active}">${user.active ? 'Desativar' : 'Reativar'}</button>`}
          </div>
        </article>`).join('');
      showView('admin');
    } finally { setLoading(false); }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }

  $('#btn-admin').addEventListener('click', () => { location.hash = '#/admin'; });
  $('#btn-admin-back').addEventListener('click', () => { location.hash = ''; });

  $('#admin-user-form').addEventListener('submit', async e => {
    e.preventDefault();
    const message = $('#admin-form-message');
    const button = e.currentTarget.querySelector('button[type="submit"]');
    message.hidden = true;
    button.disabled = true;
    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username: $('#admin-new-username').value, password: $('#admin-new-password').value }),
      });
      e.currentTarget.reset();
      message.textContent = 'Usuário criado com sucesso.';
      message.dataset.state = 'success';
      message.hidden = false;
      await openAdmin();
    } catch (err) {
      message.textContent = err.message;
      message.dataset.state = 'error';
      message.hidden = false;
    } finally { button.disabled = false; }
  });

  $('#admin-users').addEventListener('click', async e => {
    const row = e.target.closest('[data-user-id]');
    if (!row) return;
    const toggle = e.target.closest('[data-toggle-user]');
    const reset = e.target.closest('[data-reset-password]');
    try {
      if (toggle) {
        await api(`/api/admin/users/${row.dataset.userId}`, {
          method: 'PATCH', body: JSON.stringify({ active: toggle.dataset.toggleUser === 'true' }),
        });
        await openAdmin();
      }
      if (reset) {
        const password = prompt('Digite a nova senha (mínimo de 8 caracteres):');
        if (password === null) return;
        await api(`/api/admin/users/${row.dataset.userId}`, {
          method: 'PATCH', body: JSON.stringify({ password }),
        });
        alert('Senha alterada com sucesso.');
      }
    } catch (err) { alert(err.message); }
  });

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

  const CLERIC_ABILITIES = [
    { nivel: '1', nome: 'Conjurador Iniciante', tipo: 'Passiva', gasto: 'Nulo', acao: 'Livre', alcance: 'Pessoal', duracao: 'Constante', descricao: 'Quando utilizar uma habilidade considerada magia, recebe um bônus adicional de +1 nos testes de Acerto e CD das magias.' },
    { nivel: '1', nome: 'S/ Curandeiro', tipo: 'Passiva', gasto: 'Nulo', acao: 'Livre', alcance: 'Pessoal', duracao: 'Constante', descricao: 'Suas magias de cura agora somam seu Espírito no total também.' },
    { nivel: '1', nome: 'Auxílio Divino', tipo: 'Magia/Passiva', gasto: 'Nulo', acao: 'Padrão', alcance: 'Corporal', duracao: 'Uso', descricao: 'Você abençoa um aliado ou a si em uma ação, somando +1d4 na rolagem de alguma perícia.' },
    { nivel: '1', nome: 'Chama Sagrada', tipo: 'Magia/Passiva', gasto: 'Nulo', acao: 'Padrão', alcance: 'Médio', duracao: 'Uso', descricao: 'Conjura uma coluna de chamas divinas em um alvo; realize um ataque que, se bem-sucedido, causa 1d8 de dano radiante.' },
    { nivel: '1', nome: 'Estabilizar', tipo: 'Magia/Passiva', gasto: 'Nulo', acao: 'Padrão', alcance: 'Corporal', duracao: 'Uso', descricao: 'Estabiliza o alvo automaticamente, retirando-o da condição de morrendo.' },
    { nivel: '1', nome: 'Luz', tipo: 'Magia/Passiva', gasto: 'Nulo', acao: 'Padrão', alcance: 'Corporal', duracao: 'Uso', descricao: 'Encanta um objeto, fazendo-o irradiar luz em alcance curto.' },
    { nivel: '1', nome: 'C/ Treinamento de Combate', tipo: 'Passiva', gasto: 'Nulo', acao: 'Livre', alcance: 'Pessoal', duracao: 'Constante', descricao: 'Você ganha proficiência em Armaduras Pesadas e +1 ponto de Maestria.' },
    { nivel: '1', nome: 'Curar Ferimentos', tipo: 'Magia/Ativa', gasto: '1PM', acao: 'Padrão', alcance: 'Corporal', duracao: 'Uso', descricao: 'Conjura energia divina para curar 1d8 PVs do alvo.' },
    { nivel: '1', nome: 'Benção', tipo: 'Magia/Ativa', gasto: '1PM', acao: 'Padrão', alcance: 'Curto', duracao: '5 turnos', descricao: 'Escolha até 3 alvos, inclusive você. Todos recebem +1d4 em testes de ataque e magias durante 5 turnos.' },
    { nivel: '1', nome: 'Palavra Curativa', tipo: 'Magia/Ativa', gasto: '1PM', acao: 'Movimento', alcance: 'Médio', duracao: 'Uso', descricao: 'Cura 1d4 PVs do alvo através de uma prece rápida.' },
    { nivel: '1', nome: 'Escudo da Fé', tipo: 'Magia/Ativa', gasto: '1PM', acao: 'Movimento', alcance: 'Pessoal', duracao: '5 turnos', descricao: 'Uma capa de energia divina envolve seu corpo, concedendo +2 de CA por 5 turnos.' },
    { nivel: '1', nome: 'Detectar Bem e Mal', tipo: 'Passiva', gasto: 'Nulo', acao: 'Padrão', alcance: 'Extenso', duracao: '10 turnos', descricao: 'Permite detectar Corruptores, Mortos-Vivos e Celestiais, além de saber se um local é consagrado ou corrompido.' },
    { nivel: '2', nome: 'S/ Santuário', tipo: 'Ativa', gasto: '1PM', acao: 'Padrão', alcance: 'Curto', duracao: '5 turnos', descricao: 'Conjura proteção sobre um alvo, concedendo desvantagem a ataques contra ele e vantagem em testes de resistência. Se o alvo causar dano, a habilidade é encerrada.' },
    { nivel: '2', nome: 'S/ Retribuição', tipo: 'Passiva', gasto: 'Nulo', acao: 'Livre', alcance: 'Pessoal', duracao: 'Constante', descricao: 'Sempre que conjurar uma magia de cura, você também recupera 3 PVs por ponto de mana gasto.' },
    { nivel: '2', nome: 'C/ Consagrar Armas', tipo: 'Ativa', gasto: '2PM', acao: 'Padrão', alcance: 'Curto', duracao: '5 turnos', descricao: 'Escolha até 3 alvos. Durante a duração, seus ataques com armas causam +1d4 de dano radiante adicional.' },
    { nivel: '2', nome: 'C/ Proteger Aliado', tipo: 'Passiva', gasto: 'Nulo', acao: 'Reação', alcance: 'Corporal', duracao: 'Uso', descricao: 'Quando um aliado próximo for atacado, você pode reagir para conceder +2 de CA contra aquele ataque.' },
    { nivel: '2', nome: 'Raio de Luz', tipo: 'Magia/Ativa', gasto: '2PM', acao: 'Padrão', alcance: 'Médio', duracao: 'Uso', descricao: 'Realiza um ataque mágico que causa 3d6 de dano radiante. Se acertar, o alvo testa Vigor ou sofre desvantagem em seu próximo ataque.' },
    { nivel: '2', nome: 'Enfraquecer', tipo: 'Magia/Ativa', gasto: '2PM', acao: 'Padrão', alcance: 'Médio', duracao: '5 turnos', descricao: 'Escolha até 3 inimigos. Eles sofrem desvantagem em testes de Força e Agilidade e podem testar Vigor ao fim de seus turnos para encerrar o efeito.' },
    { nivel: '3', nome: 'Conjurador Resiliente', tipo: 'Ativa', gasto: '1PM', acao: 'Livre', alcance: 'Pessoal', duracao: 'Uso', descricao: 'Reforça uma magia logo após lançá-la, aumentando seu acerto ou a dificuldade do teste de resistência em +2.' },
    { nivel: '3', nome: 'C/ Arma Espiritual', tipo: 'Ativa', gasto: '2PM', acao: 'Movimento', alcance: 'Curto', duracao: '5 turnos', descricao: 'Conjura uma arma divina de energia que pode se mover e atacar, causando 1d8 + Espírito de dano radiante.' },
    { nivel: '3', nome: 'C/ Derrubar o Profano', tipo: 'Passiva', gasto: 'Nulo', acao: 'Livre', alcance: 'Pessoal', duracao: 'Constante', descricao: 'Seus ataques contra corruptores e mortos-vivos causam +1d8 de dano radiante adicional.' },
    { nivel: '3', nome: 'S/ Oração Curativa', tipo: 'Ativa', gasto: '3PM', acao: 'Completa', alcance: 'Médio', duracao: 'Uso', descricao: 'Restaura até quatro aliados à sua escolha. Cada alvo recupera 3d6 + Espírito pontos de vida.' },
    { nivel: '3', nome: 'S/ Cura do Sacerdote', tipo: 'Passiva', gasto: 'Nulo', acao: 'Livre', alcance: 'Pessoal', duracao: 'Constante', descricao: 'Todas as suas magias de cura restauram um adicional de +1d4.' },
    { nivel: '3', nome: 'Silêncio', tipo: 'Magia/Ativa', gasto: '2PM', acao: 'Padrão', alcance: 'Curto', duracao: '5 turnos', descricao: 'Cria uma área onde nenhum som pode ser produzido ou ouvido. Magias com componente verbal não podem ser lançadas dentro da zona.' },
    { nivel: '3', nome: 'Ajuda', tipo: 'Magia/Ativa', gasto: '3PM', acao: 'Padrão', alcance: 'Médio', duracao: 'Uso', descricao: 'Atinge até três alvos. Cada um recebe 10 PVs temporários e vantagem em seu próximo ataque.' },
    { nivel: 'restrita', nome: 'Consagrar Armas / Cruzado', tipo: 'Restrita', gasto: 'Nulo', acao: 'Livre', alcance: 'Médio', duracao: '5 turnos', descricao: 'Sua divindade abençoa o campo de batalha. Você recebe +10 no acerto com armas, enquanto seus aliados recebem +5 no acerto.' },
    { nivel: 'restrita', nome: 'Consagrar Terreno / Sacerdote', tipo: 'Restrita', gasto: 'Nulo', acao: 'Livre', alcance: 'Longo', duracao: '5 turnos', descricao: 'Magias divinas têm vantagem e todas as magias de cura dentro da área recuperam automaticamente o valor máximo possível.' },
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

  function updatePathUI() {
    const isCleric = sheetData.caminho === 'Clérigo';
    $('#btn-open-abilities').disabled = !isCleric;
    $('#path-helper').textContent = isCleric
      ? 'Preencha manualmente ou escolha uma habilidade pronta do catálogo do Clérigo.'
      : 'Selecione Clérigo no campo Caminho da ficha para acessar o catálogo.';
  }

  function renderAbilityCatalog() {
    const query = $('#ability-search').value.trim().toLocaleLowerCase('pt-BR');
    const level = $('#ability-level').value;
    const selectedNames = new Set(
      Array.from({ length: 8 }, (_, i) => sheetData[`hab.${i}.nome`]).filter(Boolean)
    );
    const matches = CLERIC_ABILITIES.filter(ability => {
      const text = `${ability.nome} ${ability.tipo} ${ability.descricao}`.toLocaleLowerCase('pt-BR');
      return (!level || ability.nivel === level) && (!query || text.includes(query));
    });

    $('#ability-empty').hidden = matches.length > 0;
    $('#ability-catalog').innerHTML = matches.map((ability, index) => {
      const sourceIndex = CLERIC_ABILITIES.indexOf(ability);
      const added = selectedNames.has(ability.nome);
      const levelLabel = ability.nivel === 'restrita' ? 'Restrita' : `Nível ${ability.nivel}º`;
      return `
        <article class="catalog-card">
          <div class="catalog-card-top">
            <span class="level-badge">${levelLabel}</span>
            <button type="button" class="btn ${added ? 'btn-added' : 'btn-primary'}" data-add-ability="${sourceIndex}" ${added ? 'disabled' : ''}>${added ? 'Adicionada ✓' : 'Adicionar'}</button>
          </div>
          <details ${index === 0 && matches.length < 4 ? 'open' : ''}>
            <summary>${ability.nome}</summary>
            <dl class="catalog-meta">
              <div><dt>Tipo</dt><dd>${ability.tipo}</dd></div><div><dt>Gasto</dt><dd>${ability.gasto}</dd></div>
              <div><dt>Ação</dt><dd>${ability.acao}</dd></div><div><dt>Alcance</dt><dd>${ability.alcance}</dd></div>
              <div><dt>Duração</dt><dd>${ability.duracao}</dd></div>
            </dl>
            <p>${ability.descricao}</p>
          </details>
        </article>`;
    }).join('');
  }

  function addClericAbility(ability) {
    const slot = Array.from({ length: 8 }, (_, i) => i)
      .find(i => !String(sheetData[`hab.${i}.nome`] ?? '').trim());
    if (slot === undefined) {
      alert('Os 8 espaços de habilidade já estão preenchidos. Apague uma habilidade para liberar espaço.');
      return;
    }
    ['nome', 'tipo', 'gasto', 'acao', 'alcance', 'duracao', 'descricao'].forEach(key => {
      sheetData[`hab.${slot}.${key}`] = ability[key];
    });
    fillForm();
    scheduleSave();
    renderAbilityCatalog();
  }

  $('#btn-open-abilities').addEventListener('click', () => {
    $('#ability-search').value = '';
    $('#ability-level').value = '';
    renderAbilityCatalog();
    $('#ability-picker').showModal();
    setTimeout(() => $('#ability-search').focus(), 0);
  });
  $('#ability-search').addEventListener('input', renderAbilityCatalog);
  $('#ability-level').addEventListener('change', renderAbilityCatalog);
  $('#ability-catalog').addEventListener('click', e => {
    const button = e.target.closest('[data-add-ability]');
    if (button) addClericAbility(CLERIC_ABILITIES[Number(button.dataset.addAbility)]);
  });
  $('#ability-picker').addEventListener('click', e => {
    if (e.target === $('#ability-picker')) $('#ability-picker').close();
  });

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
    updatePathUI();
  }

  function onFieldInput(e) {
    const el = e.target;
    if (!el.dataset.f) return;
    sheetData[el.dataset.f] = el.value;
    if (el.dataset.f === 'caminho') updatePathUI();
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
  sheetView.addEventListener('change', onFieldInput);
  sheetView.addEventListener('click', onToggleClick);

  window.addEventListener('hashchange', route);
  route();
})();
