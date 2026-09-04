/* ============================================================
   Ficha de Personagem — SPA
   Fluxo: login -> lista de fichas -> ficha (4 abas)
   Todos os campos usam [data-f="chave"]; o estado e um objeto
   plano { chave: valor } salvo como JSONB no servidor.
   ============================================================ */

(() => {
  'use strict';

  /* ---------------- Estado ---------------- */

  let currentSheetId = null;
  let sheetData = {};        // dados da ficha aberta
  let saveTimer = null;
  let activeSave = null;
  let dirty = false;
  let currentUser = null;
  let passwordTargetId = null;

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  const views = {
    login: $('#view-login'),
    list: $('#view-list'),
    sheet: $('#view-sheet'),
    admin: $('#view-admin'),
    error: $('#view-error'),
  };

  /* ---------------- API ---------------- */

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...options,
    });
    if (res.status === 401 && path !== '/api/login') {
      currentUser = null;
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

  function updateCurrentUserUI() {
    $$('[data-current-user]').forEach(el => { el.textContent = currentUser?.username || ''; });
    $('#btn-admin').hidden = currentUser?.role !== 'admin';
  }

  function showAppError(message) {
    $('#app-error-message').textContent = message || 'O serviço está temporariamente indisponível.';
    showView('error');
  }

  async function route() {
    const hash = location.hash;
    const m = hash.match(/^#\/ficha\/([0-9a-f-]{36})$/i);
    try {
      if (currentSheetId && m?.[1] !== currentSheetId) {
        await flushSave();
        if (dirty || activeSave) {
          showAppError('Não foi possível salvar as últimas alterações. Tente novamente em alguns instantes.');
          return;
        }
        currentSheetId = null;
      }
      const { authenticated, user } = await api('/api/session');
      if (!authenticated) { showView('login'); return; }
      currentUser = user;
      updateCurrentUserUI();
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
    } catch (err) {
      if (err.message !== 'Não autenticado') showAppError(err.message);
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
      const result = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({
          username: $('#login-username').value,
          password: $('#login-password').value,
        }),
      });
      currentUser = result.user;
      updateCurrentUserUI();
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
    await flushSave();
    if (dirty || activeSave) {
      alert('Não foi possível salvar as últimas alterações. Tente sair novamente em alguns instantes.');
      return;
    }
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    currentUser = null;
    currentSheetId = null;
    location.hash = '';
    showView('login');
  }
  $('#btn-logout').addEventListener('click', logout);
  $('#btn-logout-2').addEventListener('click', logout);
  $('#btn-admin-logout').addEventListener('click', logout);
  $('#btn-retry').addEventListener('click', route);

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
              <button type="button" class="btn btn-ghost" data-reset-password data-username="${escapeHtml(user.username)}">Alterar senha</button>
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
    const form = e.currentTarget;
    const message = $('#admin-form-message');
    const button = form.querySelector('button[type="submit"]');
    message.hidden = true;
    button.disabled = true;
    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username: $('#admin-new-username').value, password: $('#admin-new-password').value }),
      });
      form.reset();
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
        openPasswordDialog(row.dataset.userId, reset.dataset.username);
      }
    } catch (err) { alert(err.message); }
  });

  function openPasswordDialog(userId = null, username = '') {
    passwordTargetId = userId;
    $('#password-form').reset();
    $('#password-message').hidden = true;
    const ownPassword = !userId;
    $('#password-dialog-title').textContent = ownPassword ? 'Alterar minha senha' : `Nova senha para ${username}`;
    $('#current-password-field').hidden = !ownPassword;
    $('#current-password').required = ownPassword;
    $('#password-dialog').showModal();
    setTimeout(() => $(ownPassword ? '#current-password' : '#new-password').focus(), 0);
  }

  $$('[data-change-password]').forEach(button => {
    button.addEventListener('click', () => openPasswordDialog());
  });
  $$('[data-close-password]').forEach(button => {
    button.addEventListener('click', () => $('#password-dialog').close());
  });
  $('#password-dialog').addEventListener('click', e => {
    if (e.target === $('#password-dialog')) $('#password-dialog').close();
  });
  $('#password-form').addEventListener('submit', async e => {
    e.preventDefault();
    const newPassword = $('#new-password').value;
    const message = $('#password-message');
    const button = e.currentTarget.querySelector('[type="submit"]');
    if (newPassword !== $('#confirm-password').value) {
      message.textContent = 'As senhas não coincidem.';
      message.dataset.state = 'error';
      message.hidden = false;
      return;
    }
    button.disabled = true;
    message.hidden = true;
    try {
      if (passwordTargetId) {
        await api(`/api/admin/users/${passwordTargetId}`, {
          method: 'PATCH', body: JSON.stringify({ password: newPassword }),
        });
      } else {
        await api('/api/account/password', {
          method: 'POST',
          body: JSON.stringify({ currentPassword: $('#current-password').value, newPassword }),
        });
      }
      $('#password-dialog').close();
      alert('Senha alterada com sucesso.');
    } catch (err) {
      message.textContent = err.message;
      message.dataset.state = 'error';
      message.hidden = false;
    } finally { button.disabled = false; }
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

  const MIN_ABILITY_SLOTS = 8;

  const SPELL_FIELDS = [
    ['dizer', 'Dizer'], ['tipo', 'Tipo'], ['acao', 'Ação'],
    ['alcance', 'Alcance'], ['duracao', 'Duração'],
  ];

  const BACKGROUNDS = {
    'Acólito': { riqueza: '2 Moedas de Riqueza', pericias: 'Percepção, Performance, História, Intuição, Investigação, Medicina, Natureza, Persuasão, Religião e Ocultismo.', descricao: 'Crescido entre templos, doutrinas e rituais, o Acólito aprende sobre fé, tradições sagradas e convivência comunitária. Familiarizado com hierarquias religiosas e cerimônias, ele é visto como alguém de sabedoria espiritual e respeito social.' },
    'Artesão': { riqueza: '3 Moedas de Riqueza', pericias: 'Atletismo, Prestidigitação, Arcanismo, Ciência Mágica, Intuição, Investigação, Mecânica, Natureza, Persuasão e Sobrevivência.', descricao: 'Moldado pelo ofício e pela prática contínua, o Artesão domina técnicas refinadas e conhecimento prático. Seja na forja, no trabalho com madeira ou na mecânica, sua habilidade é reconhecida e valorizada.' },
    'Artista': { riqueza: '2 Moedas de Riqueza', pericias: 'Acrobacia, Furtividade, Percepção, Prestidigitação, Enganação, Performance, História, Intimidação, Intuição e Persuasão.', descricao: 'Vivendo da expressão e criatividade, o Artista encanta, provoca emoções e inspira plateias. Seu talento abre portas e proporciona contato com diversos círculos sociais.' },
    'Comerciante': { riqueza: '3 Moedas de Riqueza', pericias: 'Percepção, Arcanismo, Enganação, Ciência Mágica, História, Intuição, Investigação, Mecânica, Persuasão e Natureza.', descricao: 'Acostumado a negociar e avaliar valores, o Comerciante domina a arte do trato social e a leitura de intenções. Ele enxerga oportunidades onde outros veem apenas mercadoria.' },
    'Estudioso': { riqueza: '3 Moedas de Riqueza', pericias: 'Percepção, Arcanismo, Ciência Mágica, História, Investigação, Lidar c/ Animais, Mecânica, Medicina, Natureza e Religião.', descricao: 'Dedicado ao conhecimento, o Estudioso cresceu cercado por livros, experimentos e mestres rigorosos. Sua mente analítica e curiosidade constante o tornam um aliado indispensável.' },
    'Fora da Lei': { riqueza: '2 Moedas de Riqueza', pericias: 'Acrobacia, Furtividade, Percepção, Prestidigitação, Enganação, Intimidação, Intuição, Investigação, Persuasão e Sobrevivência.', descricao: 'Vivendo à margem das leis, o Fora da Lei aprendeu a confiar na astúcia e na velocidade. Suas experiências moldaram um espírito resistente e desconfiado.' },
    'Herói do Povo': { riqueza: '2 Moedas de Riqueza', pericias: 'Atletismo, Furtividade, Percepção, Intimidação, Intuição, Lidar c/ Animais, Medicina, Montaria, Persuasão e Sobrevivência.', descricao: 'Crescido entre trabalhadores, o Herói do Povo é admirado por sua coragem e senso de justiça. Ele luta pelos mais fracos e inspira aqueles que o cercam.' },
    'Marinheiro': { riqueza: '2 Moedas de Riqueza', pericias: 'Acrobacia, Atletismo, Percepção, Prestidigitação, Performance, Intimidação, Mecânica, Montaria, Natureza e Sobrevivência.', descricao: 'Vivendo sob o vento e as ondas, o Marinheiro conhece os perigos do mar e o trabalho em equipe. Sua vida é guiada pelo ritmo das marés e pela coragem.' },
    'Mercenário': { riqueza: '2 Moedas de Riqueza', pericias: 'Furtividade, Percepção, Enganação, História, Intimidação, Intuição, Investigação, Prestidigitação, Natureza e Sobrevivência.', descricao: 'Treinado para sobreviver em qualquer campo de batalha, o Mercenário luta por contrato e oportunidade. Sua experiência o tornou eficiente, pragmático e endurecido.' },
    'Militar': { riqueza: '3 Moedas de Riqueza', pericias: 'Acrobacia, Atletismo, Furtividade, Percepção, Intimidação, Intuição, Lidar c/ Animais, Medicina, Montaria e Sobrevivência.', descricao: 'Criado na disciplina e no rigor, o Militar é preparado para obedecer, liderar e sobreviver. O treinamento constante moldou seu físico e sua determinação.' },
    'Monge': { riqueza: '1 Moeda de Riqueza', pericias: 'Acrobacia, Furtividade, Percepção, História, Intuição, Medicina, Natureza, Persuasão, Religião e Sobrevivência.', descricao: 'Dedicado à disciplina espiritual e corporal, o Monge vive entre meditação, treino e estudo. Seu caminho busca equilíbrio, sabedoria e autocontrole.' },
    'Nobre': { riqueza: '4 Moedas de Riqueza', pericias: 'Percepção, Arcanismo, Enganação, Performance, Ciência Mágica, História, Intuição, Montaria, Persuasão e Religião.', descricao: 'Criado entre luxos e responsabilidades, o Nobre recebeu educação rígida e influência social. Ele conhece intrigas políticas e domina a etiqueta.' },
    'Trabalhador': { riqueza: '1 Moeda de Riqueza', pericias: 'Atletismo, Prestidigitação, Ciência Mágica, Investigação, Lidar c/ Animais, Mecânica, Montaria, Natureza, Persuasão e Sobrevivência.', descricao: 'Habituado ao esforço diário, o Trabalhador se destaca pela resistência e adaptabilidade. Seu dia a dia o ensinou a improvisar e resolver problemas rapidamente.' },
    'Tribal': { riqueza: '1 Moeda de Riqueza', pericias: 'Atletismo, Furtividade, Percepção, Intuição, Lidar c/ Animais, Medicina, Montaria, Natureza, Sobrevivência e Ocultismo.', descricao: 'Crescido em comunidade selvagem ou isolada, o Tribal vive em sintonia com o ambiente. Seus costumes valorizam a força coletiva e o respeito ancestral.' },
    'Viajante': { riqueza: '2 Moedas de Riqueza', pericias: 'Percepção, História, Intuição, Lidar c/ Animais, Medicina, Montaria, Natureza, Persuasão, Sobrevivência e Ocultismo.', descricao: 'Sempre na estrada, o Viajante acumulou histórias, culturas e truques de sobrevivência. Adaptável e atento, ele sabe identificar perigos e oportunidades.' },
  };

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

  const FIGHTER_ABILITIES = [
    { nivel: '1', nome: 'Ataques Desarmados', tipo: 'Passiva', gasto: 'Nulo', acao: 'Livre', alcance: 'Pessoal', duracao: 'Constante', descricao: 'Seus Ataques Desarmados agora causam 1d4 + Atributo de dano e são considerados armas leves.' },
    { nivel: '1', nome: 'Combate com duas Armas', tipo: 'Passiva', gasto: 'Nada', acao: 'Livre', alcance: 'Pessoal', duracao: 'Livre', descricao: 'Quando estiver utilizando duas armas, pode adicionar o bônus de acerto em ambos os ataques.' },
    { nivel: '1', nome: 'Rajada de Golpes', tipo: 'Ativa', gasto: '1 PM', acao: 'Uma', alcance: 'Pessoal', duracao: 'Uso', descricao: 'Utilize sua ação para realizar dois ataques em sequência contra o mesmo alvo; esse segundo ataque não possui desvantagem alguma.' },
    { nivel: '1', nome: 'Armadura Natural', tipo: 'Passiva', gasto: 'Nulo', acao: 'Livre', alcance: 'Pessoal', duracao: 'Constante', descricao: 'Enquanto não estiver vestindo nenhuma armadura, sua CA se torna 10 + Agilidade + Atributo dos Ataques.' },
    { nivel: '1', nome: 'Desviar Projétil', tipo: 'Ativa', gasto: '1 PM', acao: 'Uma, Reação', alcance: 'Pessoal', duracao: 'Uso', descricao: 'Quando for atingido por um projétil, pode diminuir o dano em 1d10 + Agilidade.' },
    { nivel: '1', nome: 'Pés Ágeis', tipo: 'Passiva', gasto: 'Nulo', acao: 'Livre', alcance: 'Pessoal', duracao: 'Constante', descricao: 'Sua agilidade natural aumenta seu deslocamento em +1Q.' },
    { nivel: '1', nome: 'Guarda Alta', tipo: 'Ativa', gasto: '1 PM', acao: 'Uma', alcance: 'Pessoal', duracao: 'Turno', descricao: 'Você ergue sua guarda; todos os ataques contra você até o início do próximo turno têm desvantagem.' },
    { nivel: '1', nome: 'Rápido como o Vento', tipo: 'Ativa', gasto: '1 PM', acao: 'Livre', alcance: 'Pessoal', duracao: 'Uso', descricao: 'Você pode se locomover 2Q a mais com suas ações neste turno.' },
    { nivel: '1', nome: 'PE / Incendiar Mãos', tipo: 'Ativa', gasto: '1 PM', acao: 'Uma', alcance: 'Curto', duracao: '5 turnos', descricao: 'Seus ataques passam a causar dano de fogo em vez do padrão, e você pode arremessar socos de fogo a curta distância usando o acerto de habilidades, causando o mesmo dano do seu soco normal.' },
    { nivel: '1', nome: 'PE / Chicote Elétrico', tipo: 'Ativa', gasto: '2 PM', acao: 'Duas', alcance: 'Curto', duracao: 'Uso', descricao: 'Você molda a mana em eletricidade, criando um chicote energético que causa 2d8 + Atributo de Ataque de dano elétrico. O alvo deve realizar um teste de Força, sendo puxado em sua direção em caso de falha.' },
    { nivel: '1', nome: 'AM / Rasteira', tipo: 'Ativa', gasto: '1 PM', acao: 'Uma', alcance: 'Pessoal', duracao: 'Uso', descricao: 'Ao acertar um ataque normal, você realiza uma manobra para derrubar o alvo. Ele deve fazer um teste de Agilidade para evitar cair.' },
    { nivel: '1', nome: 'AM / Concentração Marcial', tipo: 'Ativa', gasto: '1 PM', acao: 'Uma', alcance: 'Pessoal', duracao: '1 turno', descricao: 'Durante o combate, você entra em profundo foco, recebendo +2 nos Acertos até o final do turno.' },
    { nivel: '1', nome: 'MK / Ataque Energizado', tipo: 'Ativa', gasto: '1 PM', acao: 'Livre', alcance: 'Pessoal', duracao: 'Uso', descricao: 'Você concentra energia no seu ataque, fazendo com que o próximo soco cause +1d4 de dano de Energia.' },
    { nivel: '1', nome: 'MK / Revigorar-se', tipo: 'Ativa', gasto: 'Moldável', acao: 'Uma', alcance: 'Pessoal', duracao: 'Uso', descricao: 'Através da força espiritual, você converte mana diretamente em vitalidade, curando 1d4 PVs por ponto de mana gasto, somando seu atributo de Vigor uma única vez.' },
    { nivel: '2', nome: 'AM / Imobilizador', tipo: 'Passiva', gasto: 'Nulo', acao: 'Livre', alcance: 'Corporal', duracao: 'Constante', descricao: 'Você é muito bom em combate agarrado, recebendo +2 nos testes de Atletismo ao agarrar ou imobilizar um alvo.' },
    { nivel: '2', nome: 'MK / Escudo de Ki', tipo: 'Ativa', gasto: '1 PM', acao: 'Reação', alcance: 'Pessoal', duracao: 'Turno', descricao: 'Você molda sua energia espiritual para criar uma barreira que concede +2 de CA até o início do seu próximo turno.' },
    { nivel: '2', nome: 'MK / Queda Suave', tipo: 'Passiva', gasto: 'Nulo', acao: 'Livre', alcance: 'Pessoal', duracao: 'Constante', descricao: 'Ao cair de até 10 metros, você usa sua força espiritual para anular completamente o dano de queda.' },
    { nivel: '2', nome: 'PE / Golpe de Lufada', tipo: 'Ativa', gasto: '1 PM', acao: 'Livre', alcance: 'Pessoal', duracao: 'Uso', descricao: 'Seu próximo ataque bem-sucedido é imbuído com vento. O alvo deve fazer um teste de Força ou será empurrado até 3Q.' },
    { nivel: '2', nome: 'PE / Rajada Flamejante', tipo: 'Ativa', gasto: '2 PM', acao: 'Padrão', alcance: 'Corporal', duracao: 'Uso', descricao: 'Você desfere uma sequência de socos flamejantes que explodem em um cone de 3Q à sua frente. Criaturas na área devem realizar teste de Agilidade, recebendo metade do dano no sucesso. O dano total é 3d6 de Fogo.' },
    { nivel: '3', nome: 'Pés Ágeis 2', requisito: 'Pés Ágeis', tipo: 'Refino', gasto: 'Nulo', acao: 'Livre', alcance: 'Pessoal', duracao: 'Constante', descricao: 'Seu domínio corporal aumenta ainda mais sua velocidade, ampliando seu deslocamento em +2Q.' },
    { nivel: '3', nome: 'PE / Impacto Rochoso', tipo: 'Ativa', gasto: '2 PM', acao: 'Padrão', alcance: 'Corporal', duracao: 'Uso', descricao: 'Você golpeia o solo liberando uma onda sísmica que atinge todos os quadrados adjacentes, causando 2d8 + Atributo de Ataque de dano contundente. Criaturas atingidas devem fazer teste de Força, recebendo metade do dano em caso de sucesso.' },
    { nivel: '3', nome: 'AM / Contrapeso', tipo: 'Passiva', gasto: 'Nulo', acao: 'Reação', alcance: 'Corporal', duracao: 'Constante', descricao: 'Quando um inimigo erra um ataque corpo a corpo contra você, seus reflexos respondem instantaneamente, permitindo realizar um ataque normal como reação.' },
    { nivel: '3', nome: 'AM / Protegesse', tipo: 'Ativa', gasto: '2 PM / 3 PM', acao: 'Movimento / Livre', alcance: 'Pessoal', duracao: '3 turnos', descricao: 'Seus instintos se intensificam e sua postura defensiva se firma, aumentando sua CA em +3 durante 3 turnos.' },
    { nivel: '3', nome: 'MK / Disparo de Energia', tipo: 'Ativa', gasto: '3 PM', acao: 'Padrão', alcance: 'Médio', duracao: 'Uso', descricao: 'Você dispara uma poderosa rajada de energia concentrada de suas mãos, causando 4d6 de dano de energia ao alvo atingido.' },
    { nivel: 'restrita', nome: 'Ataques Vitais / Artista Marcial', tipo: 'Restrita', gasto: 'Nulo', acao: 'Livre', alcance: 'Pessoal', duracao: '1 turno', descricao: 'Durante esse turno todos os seus ataques se tornam críticos naturais ao rolar 16 ou mais. Todos os pontos vitais do inimigo parecem expostos, dando-lhe a chance perfeita de causar dano máximo.' },
    { nivel: 'restrita', nome: 'Fúria Elemental / Punho Elemental', tipo: 'Restrita', gasto: 'Nulo', acao: 'Livre', alcance: 'Pessoal', duracao: '5 turnos', descricao: 'Você entra em um estado de controle absoluto dos elementos. Durante a duração, pode converter seu dano físico em elemental ou vice-versa. Além disso, habilidades do Punho Elemental que custam 2 PM ou mais passam a custar 1 PM a menos.' },
    { nivel: 'restrita', nome: 'Golpe Divergente / Mestre do Ki', tipo: 'Restrita', gasto: 'Nulo', acao: 'Padrão', alcance: 'Corporal', duracao: 'Uso', descricao: 'Você realiza uma enxurrada de golpes, continuando a atacar até errar. Cada acerto causa 2d6 de dano; em caso de crítico, apenas aquele ataque é maximizado. As três primeiras rolagens possuem vantagem.' },
  ];

  const PATH_ABILITIES = {
    'Clérigo': CLERIC_ABILITIES,
    'Lutador': FIGHTER_ABILITIES,
  };

  const PATH_DETAILS = {
    'Clérigo': {
      descricao: [
        'Um excelente suporte e guerreiro, fiel às suas crenças e à sua ligação com o divino.',
        'Os Clérigos são a ponte entre os mortais e o divino, guerreiros da fé que canalizam o poder dos deuses através de suas preces. Servem como faróis de esperança para seus aliados e como sentença inevitável para os ímpios.',
        'A força de um Clérigo não vem apenas de armas ou armaduras, mas de suas preces e crença. Através da devoção, são capazes de curar ferimentos, abençoar companheiros, expulsar criaturas profanas e invocar milagres.',
        'Dentro desse Caminho, duas ramificações se destacam: o Cruzado, um guerreiro sagrado que empunha a fé como arma; e o Sacerdote, guardião espiritual que sustenta seus aliados com bênçãos e magias restauradoras.',
        'Apesar de suas diferenças, ambos compartilham o mesmo destino: servir como instrumentos vivos da vontade divina, seja defendendo templos, conduzindo exorcismos ou liderando aliados sob a luz da fé.',
      ],
      atributo: 'Espírito',
      pv: { inicial: '10 + 2d4 + Vigor', seguintes: '2d4 + Vigor' },
      pm: { inicial: 'Mana Natural + 5', seguintes: '5' },
      maestrias: [
        ['Resistências', 'Espírito e Vigor'],
        ['Armaduras', 'Armaduras leves e médias, escudos'],
        ['Armas', '2 Grupos'],
        ['Magias', '1 Origem'],
      ],
      treinamento: 'História, Intuição, Medicina, Montaria, Natureza, Ocultismo, Percepção, Persuasão, Religião e Sobrevivência.',
      progressao: [
        ['1º', '+2', '+4', '+5', '7'], ['2º', '+2', '+2', '0', '5'],
        ['3º', '+2', '0', '+3', '5'], ['4º', '+3', '+4', '0', '5'],
        ['5º', '+3', '0', '+5', '5'], ['6º', '+3', '+4', '0', '5'],
        ['7º', '+4', '0', '+5', '5'], ['8º', '+4', '+4', '0', '5'],
      ],
      ramificacoes: [
        ['Cruzado', 'O braço armado do Clérigo, que transforma orações em aço e convicção em chama. Marcha à frente dos aliados e usa lâmina e escudo para protegê-los e abençoá-los.'],
        ['Sacerdote', 'O braço de bênçãos e cura do Clérigo. Leva a luz divina ao campo de batalha, cura os feridos, protege os incapacitados e manifesta a vontade de seu deus.'],
      ],
    },
    'Lutador': {
      descricao: [
        'O Lutador é a personificação da força física, da disciplina e da determinação inabalável. Ele não precisa de armaduras pesadas ou armas elaboradas: seu corpo é sua arma, sua mente é seu escudo e sua vontade é seu combustível.',
        'Forjado por treinos árduos, suor e repetição incansável, o Lutador enfrenta o mundo com punhos firmes e uma vontade inabalável.',
        'Esse Caminho representa aqueles que buscaram a perfeição corporal, seja por necessidade, filosofia, vingança ou tradição. Seus golpes carregam não apenas técnica, mas história e propósito.',
        'As ramificações do Lutador mostram como diferentes guerreiros canalizam sua força, transformando o combate desarmado em uma verdadeira arte.',
      ],
      atributo: 'Força, Agilidade ou Espírito',
      pv: { inicial: '10 + 1d6 + 1d4 + Vigor', seguintes: '1d6 + 1d4 + Vigor' },
      pm: { inicial: 'Mana Natural + 4', seguintes: '+4' },
      maestrias: [
        ['Resistências', 'Força e Agilidade'],
        ['Armaduras', 'Armaduras leves'],
        ['Armas', '2 Grupos'],
      ],
      treinamento: 'Acrobacia, Atletismo, Furtividade, Intimidação, Intuição, Medicina, Percepção, Persuasão, Prestidigitação e Sobrevivência.',
      progressao: [
        ['1º', '+2', '+3', '+2', '7'], ['2º', '+2', '+2', '0', '5'],
        ['3º', '+2', '0', '+3', '5'], ['4º', '+3', '+4', '0', '5'],
        ['5º', '+3', '0', '+5', '5'], ['6º', '+3', '+4', '0', '5'],
        ['7º', '+4', '0', '+5', '5'], ['8º', '+4', '+4', '0', '5'],
      ],
      ramificacoes: [
        ['Artista Marcial', 'Enxerga o combate como um fluxo contínuo, uma dança precisa de movimentos, respirações e intenções. É mestre em estilos, golpes e manobras.'],
        ['Punho Elemental', 'Transforma o corpo em condutor dos poderes primordiais, incorporando fogo, gelo, trovão, pedra ou vento em seus ataques.'],
        ['Mestre do Ki', 'Canaliza a energia vital para fortalecer seus golpes, acelerar o corpo e ampliar sua resistência além dos limites naturais.'],
      ],
    },
  };

  function buildStaticBlocks() {
    // Atributos (losangos)
    $('#attrs').innerHTML = ATTRS.map(a => `
      <div class="attr">
        <span class="attr-name">${a.label}</span>
        <div class="attr-diamond"><input data-f="attr.${a.key}" inputmode="numeric"></div>
        <div class="attr-modifiers">
          <label>Temp. <input data-f="attr.${a.key}.temp" inputmode="numeric" aria-label="${a.label}: temporário"></label>
          <label>Bônus <input data-f="attr.${a.key}.bonus" inputmode="numeric" aria-label="${a.label}: bônus"></label>
        </div>
        <button type="button" class="attr-advantage" data-t="attr.${a.key}.vantagem" aria-pressed="false" aria-label="Marcar vantagem em ${a.label}">
          <span aria-hidden="true"></span>Vantagem
        </button>
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

    // Habilidades do Caminho e da Linhagem
    renderAbilitySlots('#habilidades', 'hab', MIN_ABILITY_SLOTS);
    renderAbilitySlots('#linhagem-habilidades', 'linhagem.hab', MIN_ABILITY_SLOTS);

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

  function abilityCardMarkup(prefix, index) {
    return `
      <div class="ability-card" data-ability-card>
        <div class="ability-card-heading">
          <label class="fld card-head"><span>Nome</span><input data-f="${prefix}.${index}.nome"></label>
          <button type="button" class="ability-remove" data-remove-ability="${prefix}.${index}" disabled>Excluir</button>
        </div>
        <div class="card-fields">
          ${ABILITY_FIELDS.map(([key, label]) =>
            `<label class="fld"><span>${label}</span><input data-f="${prefix}.${index}.${key}"></label>`
          ).join('')}
        </div>
        <textarea data-f="${prefix}.${index}.descricao" rows="3" placeholder="Descrição..."></textarea>
      </div>`;
  }

  function renderAbilitySlots(container, prefix, count) {
    $(container).innerHTML = Array.from({ length: count }, (_, index) =>
      abilityCardMarkup(prefix, index)
    ).join('');
  }

  function renderPathDetails() {
    const path = sheetData.caminho;
    const detail = PATH_DETAILS[path];
    const overview = $('#path-overview');
    overview.hidden = !detail;
    if (!detail) return;

    $('#path-detail-name').textContent = path;
    $('#path-detail-content').innerHTML = `
      <div class="path-description">
        ${detail.descricao.map(paragraph => `<p>${paragraph}</p>`).join('')}
      </div>
      <div class="path-facts">
        <article class="path-fact">
          <h3>Características</h3>
          <dl>
            <div><dt>Atributo das habilidades</dt><dd>${detail.atributo}</dd></div>
            <div><dt>PV no 1º nível</dt><dd>${detail.pv.inicial}</dd></div>
            <div><dt>PV nos níveis seguintes</dt><dd>${detail.pv.seguintes}</dd></div>
            <div><dt>PM no 1º nível</dt><dd>${detail.pm.inicial}</dd></div>
            <div><dt>PM nos níveis seguintes</dt><dd>${detail.pm.seguintes}</dd></div>
          </dl>
        </article>
        <article class="path-fact">
          <h3>Maestrias e treinamento</h3>
          <dl>
            ${detail.maestrias.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}
            <div><dt>Perícias</dt><dd>${detail.treinamento}</dd></div>
          </dl>
        </article>
      </div>
      <div class="path-progression-wrap">
        <h3>Progressão do Caminho</h3>
        <div class="path-table-scroll">
          <table class="path-progression">
            <thead><tr><th>Nível</th><th>Maestria</th><th>Treinamento</th><th>Estudos</th><th>Pontos de Habilidade</th></tr></thead>
            <tbody>${detail.progressao.map(row => `<tr>${row.map(value => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
      <div class="path-branches">
        <h3>Ramificações</h3>
        <div>${detail.ramificacoes.map(([name, description]) => `
          <article><h4>${name}</h4><p>${description}</p></article>`).join('')}</div>
      </div>`;
  }

  function updatePathUI() {
    const path = sheetData.caminho;
    const hasCatalog = !!PATH_ABILITIES[path];
    $('#btn-open-abilities').disabled = !hasCatalog;
    $('#path-helper').textContent = hasCatalog
      ? `Preencha manualmente ou escolha uma habilidade pronta do catálogo do ${path}.`
      : 'Selecione um Caminho na ficha para acessar seu catálogo.';
    renderPathDetails();
  }

  function renderBackgroundDetails() {
    const name = sheetData.antecedente;
    const detail = BACKGROUNDS[name];
    const overview = $('#background-overview');
    overview.hidden = !detail;
    if (!detail) return;

    $('#background-detail-name').textContent = name;
    $('#background-detail-content').innerHTML = `
      <p>${escapeHtml(detail.descricao)}</p>
      <dl>
        <div><dt>Riqueza inicial</dt><dd>${escapeHtml(detail.riqueza)}</dd></div>
        <div><dt>Perícias disponíveis</dt><dd>${escapeHtml(detail.pericias)}</dd></div>
      </dl>`;
  }

  function renderAbilityCatalog() {
    const abilities = PATH_ABILITIES[sheetData.caminho] || [];
    const query = $('#ability-search').value.trim().toLocaleLowerCase('pt-BR');
    const level = $('#ability-level').value;
    const selectedNames = new Set(
      Array.from({ length: 8 }, (_, i) => sheetData[`hab.${i}.nome`]).filter(Boolean)
    );
    const matches = abilities.filter(ability => {
      const text = `${ability.nome} ${ability.tipo} ${ability.requisito || ''} ${ability.descricao}`.toLocaleLowerCase('pt-BR');
      return (!level || ability.nivel === level) && (!query || text.includes(query));
    });

    $('#ability-empty').hidden = matches.length > 0;
    $('#ability-catalog').innerHTML = matches.map((ability, index) => {
      const sourceIndex = abilities.indexOf(ability);
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
              ${ability.requisito ? `<div><dt>Requisito</dt><dd>${ability.requisito}</dd></div>` : ''}
              <div><dt>Tipo</dt><dd>${ability.tipo}</dd></div><div><dt>Gasto</dt><dd>${ability.gasto}</dd></div>
              <div><dt>Ação</dt><dd>${ability.acao}</dd></div><div><dt>Alcance</dt><dd>${ability.alcance}</dd></div>
              <div><dt>Duração</dt><dd>${ability.duracao}</dd></div>
            </dl>
            <p>${ability.descricao}</p>
          </details>
        </article>`;
    }).join('');
  }

  function addPathAbility(ability) {
    const slotCount = $$('#habilidades [data-ability-card]').length;
    let slot = Array.from({ length: slotCount }, (_, i) => i)
      .find(i => !String(sheetData[`hab.${i}.nome`] ?? '').trim());
    if (slot === undefined) {
      slot = addAbilitySlot('hab', { focus: false, save: false });
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
    $('#ability-picker-path').textContent = `Caminho do ${sheetData.caminho}`;
    renderAbilityCatalog();
    $('#ability-picker').showModal();
    setTimeout(() => $('#ability-search').focus(), 0);
  });
  $('#ability-search').addEventListener('input', renderAbilityCatalog);
  $('#ability-level').addEventListener('change', renderAbilityCatalog);
  $('#ability-catalog').addEventListener('click', e => {
    const button = e.target.closest('[data-add-ability]');
    const abilities = PATH_ABILITIES[sheetData.caminho] || [];
    if (button) addPathAbility(abilities[Number(button.dataset.addAbility)]);
  });
  $('#ability-picker').addEventListener('click', e => {
    if (e.target === $('#ability-picker')) $('#ability-picker').close();
  });

  /* ---------------- Binding de dados ---------------- */

  const ABILITY_LISTS = [
    { prefix: 'hab', configKey: 'config.pathAbilitySlots', container: '#habilidades', search: '#path-skills-search', empty: '#path-skills-empty' },
    { prefix: 'linhagem.hab', configKey: 'config.lineageAbilitySlots', container: '#linhagem-habilidades', search: '#lineage-skills-search', empty: '#lineage-skills-empty' },
  ];

  function getAbilityList(prefix) {
    return ABILITY_LISTS.find(list => list.prefix === prefix);
  }

  function getAbilitySlotCount({ prefix, configKey }) {
    let highestSavedIndex = -1;
    Object.keys(sheetData).forEach(key => {
      if (!key.startsWith(`${prefix}.`)) return;
      const index = Number.parseInt(key.slice(prefix.length + 1).split('.')[0], 10);
      if (Number.isInteger(index)) highestSavedIndex = Math.max(highestSavedIndex, index);
    });
    const configuredCount = Number.parseInt(sheetData[configKey], 10) || 0;
    return Math.max(MIN_ABILITY_SLOTS, configuredCount, highestSavedIndex + 1);
  }

  function renderAbilitySlotsForSheet() {
    ABILITY_LISTS.forEach(list => {
      renderAbilitySlots(list.container, list.prefix, getAbilitySlotCount(list));
    });
  }

  function addAbilitySlot(prefix, options = {}) {
    const { focus = true, save = true } = options;
    const list = getAbilityList(prefix);
    if (!list) return undefined;

    const container = $(list.container);
    const index = $$('[data-ability-card]', container).length;
    sheetData[list.configKey] = index + 1;
    container.insertAdjacentHTML('beforeend', abilityCardMarkup(prefix, index));
    $(list.search).value = '';
    refreshAbilityLists();
    if (focus) {
      const newCard = $$('[data-ability-card]', container).at(-1);
      $('[data-f$=".nome"]', newCard)?.focus();
    }
    if (save) scheduleSave();
    return index;
  }

  function normalizeAbilitySearch(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  }

  function refreshAbilityList({ container, search, empty }) {
    const query = normalizeAbilitySearch($(search).value.trim());
    let visibleCards = 0;

    $$('[data-ability-card]', $(container)).forEach(card => {
      const fields = $$('[data-f]', card);
      const hasContent = fields.some(field => field.value.trim() !== '');
      const searchableText = normalizeAbilitySearch(fields.map(field => field.value).join(' '));
      const matches = !query || searchableText.includes(query);
      card.hidden = !matches;
      $('[data-remove-ability]', card).disabled = !hasContent;
      if (matches) visibleCards += 1;
    });

    $(empty).hidden = visibleCards > 0;
  }

  function refreshAbilityLists() {
    ABILITY_LISTS.forEach(refreshAbilityList);
  }

  function removeAbility(prefix) {
    const name = String(sheetData[`${prefix}.nome`] ?? '').trim();
    if (!confirm(`Excluir ${name ? `a habilidade “${name}”` : 'esta habilidade'}?`)) return;

    $$(`[data-f^="${prefix}."]`).forEach(field => {
      delete sheetData[field.dataset.f];
      field.value = '';
    });
    refreshAbilityLists();
    renderAbilityCatalog();
    scheduleSave();
  }

  function fillForm() {
    const selectedBackground = sheetData.antecedente;
    const backgroundSelect = $('#antecedente-select');
    const hasBackgroundOption = Array.from(backgroundSelect.options)
      .some(option => option.value === selectedBackground);
    if (selectedBackground && !hasBackgroundOption) {
      backgroundSelect.add(new Option(`${selectedBackground} (anterior)`, selectedBackground));
    }
    renderAbilitySlotsForSheet();
    $$('[data-f]').forEach(el => {
      el.value = sheetData[el.dataset.f] ?? '';
    });
    $$('[data-t]').forEach(el => {
      el.setAttribute('aria-pressed', sheetData[el.dataset.t] ? 'true' : 'false');
    });
    applyAutoTotalMode();
    recalcAllTotals();
    updatePathUI();
    renderBackgroundDetails();
    refreshAbilityLists();
  }

  function onFieldInput(e) {
    const el = e.target;
    if (!el.dataset.f) return;
    sheetData[el.dataset.f] = el.value;
    $$(`[data-f="${el.dataset.f}"]`).forEach(peer => {
      if (peer !== el) peer.value = el.value;
    });
    if (el.dataset.f === 'caminho') updatePathUI();
    if (el.dataset.f === 'antecedente') renderBackgroundDetails();
    if (/^pericia\..+\.(ante|treino|estatr)$/.test(el.dataset.f)) {
      recalcTotal(el.closest('.skill-row'));
    }
    if (el.closest('[data-ability-card]')) refreshAbilityLists();
    scheduleSave();
  }

  function onToggleClick(e) {
    const addSlotButton = e.target.closest('[data-add-ability-slot]');
    if (addSlotButton) {
      addAbilitySlot(addSlotButton.dataset.addAbilitySlot);
      return;
    }
    const removeButton = e.target.closest('[data-remove-ability]');
    if (removeButton) {
      removeAbility(removeButton.dataset.removeAbility);
      return;
    }
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
    if (activeSave) {
      try { await activeSave; } catch {}
      if (dirty) return saveNow();
      return;
    }
    if (!currentSheetId || !dirty) return;
    dirty = false;
    setStatus('saving', 'Salvando...');
    try {
      activeSave = api(`/api/sheets/${currentSheetId}`, {
        method: 'PUT',
        body: JSON.stringify({ data: sheetData }),
      });
      await activeSave;
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
    } finally {
      activeSave = null;
    }
  }

  async function flushSave() {
    clearTimeout(saveTimer);
    if (activeSave) {
      try { await activeSave; } catch {}
      activeSave = null;
    }
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

  ABILITY_LISTS.forEach(({ search }) => {
    $(search).addEventListener('input', refreshAbilityLists);
  });

  const sheetView = views.sheet;
  sheetView.addEventListener('input', onFieldInput);
  sheetView.addEventListener('click', onToggleClick);

  window.addEventListener('hashchange', route);
  route();
})();
