/**
 * Painel MINAS II - Google Sheets & Drive Integration
 * Autenticação via Firebase Auth com OAuth Scopes para Google Sheets & Google Drive.
 */

(function(window) {
  'use strict';

  // Configuração OAuth Scopes para Google Sheets & Drive (solicitados sob demanda para não bloquear login)
  const SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file'
  ];

  // Chaves de armazenamento para preferência da planilha (IDs e links apenas, NUNCA tokens)
  const CHAVE_SHEET_ID = 'painel_sheets_id';
  const CHAVE_SHEET_NOME = 'painel_sheets_nome';
  const CHAVE_SHEET_URL = 'painel_sheets_url';
  const CHAVE_ULTIMO_SYNC = 'painel_sheets_ultimo_sync';
  const CHAVE_AUTO_SYNC = 'painel_sheets_auto_sync';
  const CHAVE_USUARIO_ATIVO = 'painel_usuario_ativo';

  // Armazenamento do token de acesso em MEMÓRIA (conforme diretrizes de segurança)
  let cachedAccessToken = null;
  let currentUser = null;
  let isSigningIn = false;
  let authInitialized = false;

  // Salvar sessão ativa
  function salvarSessaoUsuario(user) {
    if (!user) {
      localStorage.removeItem(CHAVE_USUARIO_ATIVO);
      return;
    }
    const dados = {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || user.email || 'Operador',
      photoURL: user.photoURL || '',
      isLocal: !!user.isLocal,
      dataLogin: new Date().toISOString()
    };
    localStorage.setItem(CHAVE_USUARIO_ATIVO, JSON.stringify(dados));
  }

  // Carregar sessão salva do armazenamento local
  function carregarSessaoSalva() {
    try {
      const raw = localStorage.getItem(CHAVE_USUARIO_ATIVO);
      if (raw) {
        const dados = JSON.parse(raw);
        if (dados && (dados.email || dados.displayName)) {
          currentUser = dados;
          return dados;
        }
      }
    } catch (e) {
      console.warn('Erro ao carregar sessão salva:', e);
    }
    return null;
  }

  // Obter configuração do Firebase
  async function carregarFirebaseConfig() {
    try {
      const resp = await fetch('/firebase-applet-config.json');
      if (resp.ok) {
        return await resp.json();
      }
    } catch (e) {
      console.warn('Erro ao carregar /firebase-applet-config.json:', e);
    }
    return {
      projectId: "heroic-icon-gf6jr",
      appId: "1:620305266125:web:839a2397cf570fa36ec084",
      apiKey: "AIzaSyCvdT9nehnjdoI5QXuSmjQOEtmbeN3Qu0M",
      authDomain: "heroic-icon-gf6jr.firebaseapp.com",
      storageBucket: "heroic-icon-gf6jr.firebasestorage.app",
      messagingSenderId: "620305266125",
      oAuthClientId: "620305266125-ti2ot4bbf7ek5d1k02o7saqs4rfckljs.apps.googleusercontent.com"
    };
  }

  // Inicializar Firebase Auth
  async function initFirebase() {
    // Restaura sessão salva imediatamente se existir
    if (!currentUser) {
      carregarSessaoSalva();
      atualizarUIStatusGoogle();
    }

    if (authInitialized) return;
    try {
      const config = await carregarFirebaseConfig();
      if (!window.firebase.apps || !window.firebase.apps.length) {
        window.firebase.initializeApp(config);
      }
      const auth = window.firebase.auth();

      auth.onAuthStateChanged(async (user) => {
        if (user) {
          currentUser = user;
          salvarSessaoUsuario(user);
        } else if (!currentUser || !currentUser.isLocal) {
          currentUser = null;
          cachedAccessToken = null;
          salvarSessaoUsuario(null);
        }
        atualizarUIStatusGoogle();
      });

      authInitialized = true;
    } catch (err) {
      console.error('Erro ao inicializar Firebase Auth:', err);
    }
  }

  // Login com Google Simplificado e Direto (Sem bloqueio de verificação OAuth)
  async function loginGoogle() {
    if (isSigningIn) return;
    const btnPrincipal = document.getElementById('btnGoogleAuthPrincipal');
    const originalBtnHtml = btnPrincipal ? btnPrincipal.innerHTML : '';
    
    try {
      isSigningIn = true;
      if (btnPrincipal) {
        btnPrincipal.style.opacity = '0.7';
        btnPrincipal.style.pointerEvents = 'none';
        btnPrincipal.innerHTML = `
          <div class="g-icon-wrapper">
            <svg class="g-logo-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;">
              <circle cx="12" cy="12" r="10" stroke="#4285F4" stroke-dasharray="32" stroke-linecap="round"/>
            </svg>
          </div>
          <span class="g-btn-text">Autenticando com o Google...</span>
        `;
      }

      await initFirebase();
      const auth = window.firebase.auth();
      const provider = new window.firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });

      mostrarNotificacaoGoogle('Abrindo autenticação segura com o Google...', 'info');
      const result = await auth.signInWithPopup(provider);
      
      currentUser = result.user;
      if (result.credential && result.credential.accessToken) {
        cachedAccessToken = result.credential.accessToken;
      }
      salvarSessaoUsuario(currentUser);

      mostrarNotificacaoGoogle(`Bem-vindo, ${currentUser.displayName || currentUser.email}! Acesso liberado aos serviços do Painel.`, 'sucesso');
      atualizarUIStatusGoogle();

      return { user: currentUser, token: cachedAccessToken };
    } catch (error) {
      console.warn('Status do login Google:', error);
      if (error.code === 'auth/popup-closed-by-user') {
        mostrarNotificacaoGoogle('Login cancelado: a janela de autenticação foi fechada.', 'info');
      } else if (error.code === 'auth/popup-blocked') {
        mostrarNotificacaoGoogle('Pop-up bloqueado pelo navegador! Permita pop-ups para este site para fazer login.', 'erro');
      } else if (error.code === 'auth/cancelled-popup-request') {
        // ignora chamadas concorrentes
      } else {
        mostrarNotificacaoGoogle('Falha na autenticação Google: ' + (error.message || error), 'erro');
      }
      throw error;
    } finally {
      isSigningIn = false;
      if (btnPrincipal && originalBtnHtml) {
        btnPrincipal.style.opacity = '1';
        btnPrincipal.style.pointerEvents = 'auto';
        btnPrincipal.innerHTML = originalBtnHtml;
      }
    }
  }

  // Acesso Rápido de Plantão (DEM2) para contingência sem pop-up
  function loginAcessoRapido(emailInformado, nomeInformado) {
    const email = (emailInformado || '').trim() || 'operador.dem2@minastc.com.br';
    const nome = (nomeInformado || '').trim() || (email.split('@')[0] || 'Operador DEM2');
    
    const userLocal = {
      uid: 'local_' + Date.now(),
      email: email,
      displayName: nome,
      photoURL: '',
      isLocal: true
    };
    
    currentUser = userLocal;
    salvarSessaoUsuario(userLocal);
    fecharModalAcessoRapido();
    mostrarNotificacaoGoogle(`Acesso liberado para ${nome} (${email}).`, 'sucesso');
    atualizarUIStatusGoogle();
  }

  function abrirModalAcessoRapido() {
    const m = document.getElementById('modalAcessoRapido');
    if (m) m.style.display = 'flex';
  }

  function fecharModalAcessoRapido() {
    const m = document.getElementById('modalAcessoRapido');
    if (m) m.style.display = 'none';
  }

  function confirmarAcessoRapido() {
    const inNome = document.getElementById('inputNomeAcessoRapido');
    const inEmail = document.getElementById('inputEmailAcessoRapido');
    const nome = inNome ? inNome.value : '';
    const email = inEmail ? inEmail.value : '';
    loginAcessoRapido(email, nome);
  }

  // Logout
  async function logoutGoogle() {
    try {
      await initFirebase();
      if (window.firebase.auth && window.firebase.auth().currentUser) {
        await window.firebase.auth().signOut();
      }
      cachedAccessToken = null;
      currentUser = null;
      salvarSessaoUsuario(null);
      mostrarNotificacaoGoogle('Sessão encerrada com sucesso.', 'info');
      atualizarUIStatusGoogle();
    } catch (e) {
      console.error('Erro ao desconectar:', e);
      currentUser = null;
      salvarSessaoUsuario(null);
      atualizarUIStatusGoogle();
    }
  }

  // Solicitar Scopes de Google Sheets e Drive sob demanda
  async function autorizarScopesSheetsDrive() {
    if (cachedAccessToken) return cachedAccessToken;
    try {
      await initFirebase();
      const auth = window.firebase.auth();
      const provider = new window.firebase.auth.GoogleAuthProvider();
      SCOPES.forEach(scope => provider.addScope(scope));
      provider.setCustomParameters({ prompt: 'select_account' });
      
      mostrarNotificacaoGoogle('Conectando ao Google Drive & Planilhas...', 'info');
      const res = await auth.signInWithPopup(provider);
      if (res.credential && res.credential.accessToken) {
        cachedAccessToken = res.credential.accessToken;
        currentUser = res.user;
        salvarSessaoUsuario(currentUser);
        return cachedAccessToken;
      }
    } catch (e) {
      console.warn('Erro ao autorizar scopes do Drive:', e);
      mostrarNotificacaoGoogle('Permissão de Drive necessária para sincronização direta: ' + (e.message || e), 'erro');
      throw e;
    }
    return null;
  }

  // Obter token válido para operações da API Google
  async function obterToken() {
    if (cachedAccessToken) return cachedAccessToken;
    return await autorizarScopesSheetsDrive();
  }

  // Helper de requisição à API do Google
  async function apiGoogle(url, options = {}) {
    const token = await obterToken();
    if (!token) {
      throw new Error('Autenticação com o Google necessária para continuar.');
    }
    const headers = options.headers || {};
    headers['Authorization'] = `Bearer ${token}`;
    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    options.headers = headers;

    const res = await fetch(url, options);
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const msg = (errJson.error && errJson.error.message) || `Erro HTTP ${res.status}: ${res.statusText}`;
      if (res.status === 401) {
        cachedAccessToken = null;
        throw new Error('Sessão expirada. Por favor, reconecte sua conta Google.');
      }
      throw new Error(msg);
    }
    return await res.json();
  }

  // -------------------------------------------------------------
  // MÉTODOS DE GOOGLE SHEETS & DRIVE
  // -------------------------------------------------------------

  // Listar planilhas do Google Drive do usuário
  async function listarPlanilhasDrive() {
    try {
      const query = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
      const url = `https://www.googleapis.com/drive/v3/files?q=${query}&orderBy=modifiedTime desc&pageSize=12&fields=files(id,name,modifiedTime,webViewLink,iconLink)`;
      const data = await apiGoogle(url);
      return data.files || [];
    } catch (e) {
      console.error('Erro ao listar planilhas do Drive:', e);
      throw e;
    }
  }

  // Criar uma nova planilha completa no Google Sheets
  async function criarNovaPlanilha(tituloCustomizado) {
    const dataHoje = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    const title = tituloCustomizado || `Painel MINAS II - Dados Operacionais (${dataHoje})`;
    
    // Definição das abas estruturadas
    const abasIniciais = [
      { properties: { title: 'VisaoGeral', tabColor: { red: 0.04, green: 0.15, blue: 0.28 } } },
      { properties: { title: 'Estoque', tabColor: { red: 0.09, green: 0.62, blue: 0.35 } } },
      { properties: { title: 'Equipe', tabColor: { red: 0.17, green: 0.45, blue: 0.70 } } },
      { properties: { title: 'Presenca', tabColor: { red: 0.79, green: 0.64, blue: 0.15 } } },
      { properties: { title: 'Chaves', tabColor: { red: 0.58, green: 0.20, blue: 0.68 } } },
      { properties: { title: 'Radios', tabColor: { red: 0.89, green: 0.35, blue: 0.13 } } },
      { properties: { title: 'SSMPO', tabColor: { red: 0.70, green: 0.27, blue: 0.17 } } },
      { properties: { title: 'Agenda', tabColor: { red: 0.12, green: 0.53, blue: 0.53 } } },
      { properties: { title: 'Contatos', tabColor: { red: 0.35, green: 0.43, blue: 0.49 } } },
      { properties: { title: 'Equipamentos', tabColor: { red: 0.25, green: 0.32, blue: 0.71 } } },
      { properties: { title: 'Checklist', tabColor: { red: 0.20, green: 0.55, blue: 0.30 } } }
    ];

    const body = {
      properties: { title: title },
      sheets: abasIniciais
    };

    const res = await apiGoogle('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      body: body
    });

    const spreadsheetId = res.spreadsheetId;
    const url = res.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    localStorage.setItem(CHAVE_SHEET_ID, spreadsheetId);
    localStorage.setItem(CHAVE_SHEET_NOME, title);
    localStorage.setItem(CHAVE_SHEET_URL, url);

    // Exportar os dados atuais para a planilha recém-criada
    await exportarTodosDadosParaPlanilha(spreadsheetId);

    return { id: spreadsheetId, nome: title, url: url };
  }

  // Obter metadados da planilha conectada
  async function obterInfoPlanilha(spreadsheetId) {
    return await apiGoogle(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties,sheets.properties`);
  }

  // -------------------------------------------------------------
  // COLETORES DE DADOS DO PAINEL PARA AS ABAS
  // -------------------------------------------------------------

  function parseJson(key, fallback = []) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  // 1. Visão Geral
  function gerarDadosVisaoGeral() {
    const agora = new Date().toLocaleString('pt-BR');
    const equipe = parseJson('mtc_equipe_dem2', []);
    const estoque = parseJson('mtc_estoque', []);
    const chaves = parseJson('mtc_chaves', []);
    const radios = parseJson('mtc_radios', []);
    const ssmpo = parseJson('mtc_ssmpo', []);
    const agenda = parseJson('mtc_agenda', []);

    return [
      ['PAINEL MINAS II - MINAS TÊNIS CLUBE', ''],
      ['Relatório Operacional e Sincronização Google Sheets', ''],
      ['Gerado em:', agora],
      ['', ''],
      ['MÓDULO', 'TOTAL DE REGISTROS / STATUS'],
      ['Equipe DEM2', `${equipe.length} colaboradores cadastrados`],
      ['Controle de Estoque', `${estoque.length} itens monitorados`],
      ['Controle de Chaves', `${chaves.length} chaves cadastradas`],
      ['Controle de Rádios', `${radios.length} rádios operacionais`],
      ['SSMPO (Solicitações)', `${ssmpo.length} solicitações registradas`],
      ['Agenda de Eventos', `${agenda.length} compromissos agendados`],
      ['', ''],
      ['Observação:', 'Esta planilha é sincronizada automaticamente com o Painel Operacional MINAS II.']
    ];
  }

  // 2. Estoque
  function gerarDadosEstoque() {
    const estoque = parseJson('mtc_estoque', []);
    const cabecalho = ['ID', 'Código', 'Nome do Material', 'Categoria', 'Unidade', 'Quantidade Atual', 'Estoque Mínimo', 'Status', 'Localização / Observação'];
    const linhas = estoque.map(item => {
      const qtd = Number(item.quantidade || item.qtd || 0);
      const min = Number(item.minimo || item.estoqueMinimo || 0);
      let status = 'Normal';
      if (qtd <= 0) status = 'Zerado';
      else if (qtd <= min) status = 'Abaixo do Mínimo';

      return [
        item.id || '',
        item.codigo || '',
        item.nome || item.descricao || '',
        item.categoria || item.grupo || 'Geral',
        item.unidade || 'UN',
        qtd,
        min,
        status,
        item.local || item.localizacao || item.obs || ''
      ];
    });
    return [cabecalho, ...linhas];
  }

  // 3. Equipe DEM2
  function gerarDadosEquipe() {
    const equipe = parseJson('mtc_equipe_dem2', []);
    const cabecalho = ['ID', 'Nome Completo', 'Cargo / Função', 'Turno', 'Horário de Trabalho', 'Contato / Telefone', 'Status', 'Observações'];
    const linhas = equipe.map(colab => [
      colab.id || '',
      colab.nome || '',
      colab.cargo || colab.funcao || '',
      colab.turno || '',
      colab.horario || colab.escala || '',
      colab.contato || colab.telefone || '',
      colab.status || 'Ativo',
      colab.observacao || colab.obs || ''
    ]);
    return [cabecalho, ...linhas];
  }

  // 4. Presença / Frequência
  function gerarDadosPresenca() {
    const presenca = parseJson('mtc_presenca', {});
    const equipe = parseJson('mtc_equipe_dem2', []);
    const nomeColab = (id) => {
      const c = equipe.find(e => e.id === id);
      return c ? c.nome : id;
    };

    const cabecalho = ['Data (AAAA-MM-DD)', 'Data Formatada', 'ID Colaborador', 'Nome do Colaborador', 'Status de Presença', 'Horário / Observação'];
    const linhas = [];

    Object.keys(presenca).sort().reverse().forEach(dataIso => {
      const registros = presenca[dataIso] || {};
      const partes = dataIso.split('-');
      const dataBr = partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : dataIso;

      Object.keys(registros).forEach(colabId => {
        const reg = registros[colabId];
        const status = typeof reg === 'string' ? reg : (reg && reg.status) || 'Presente';
        const obs = typeof reg === 'object' ? (reg.obs || reg.motivo || reg.horario || '') : '';
        linhas.push([
          dataIso,
          dataBr,
          colabId,
          nomeColab(colabId),
          status,
          obs
        ]);
      });
    });
    return [cabecalho, ...linhas];
  }

  // 5. Controle de Chaves
  function gerarDadosChaves() {
    const chaves = parseJson('mtc_chaves', []);
    const cabecalho = ['ID', 'Identificação da Chave / Sala', 'Setor / Local', 'Status', 'Responsável Atual', 'Retirada em', 'Devolução em', 'Histórico / Observações'];
    const linhas = chaves.map(c => [
      c.id || '',
      c.nome || c.chave || '',
      c.setor || c.ambiente || '',
      c.retirada && !c.devolucao ? 'Em Uso' : 'Disponível',
      c.responsavel || c.colaborador || '',
      c.retirada || '',
      c.devolucao || '',
      c.obs || c.historico || ''
    ]);
    return [cabecalho, ...linhas];
  }

  // 6. Controle de Rádios
  function gerarDadosRadios() {
    const radios = parseJson('mtc_radios', []);
    const conserto = parseJson('mtc_radios_conserto', []);
    const cabecalho = ['ID', 'Número / Identificação', 'Responsável Atual', 'Status', 'Bateria / Condição', 'Turno', 'Manutenção / Conserto'];
    const linhas = radios.map(r => {
      const emManut = conserto.find(c => c.radioId === r.id || c.numero === r.numero);
      return [
        r.id || '',
        r.numero || r.nome || '',
        r.responsavel || '',
        emManut ? 'Em Manutenção / Conserto' : (r.status || 'Operacional'),
        r.bateria || r.condicao || 'OK',
        r.turno || '',
        emManut ? `${emManut.motivo || 'Em conserto'} (${emManut.data || ''})` : 'Normal'
      ];
    });
    return [cabecalho, ...linhas];
  }

  // 7. SSMPO
  function gerarDadosSSMPO() {
    const ssmpo = parseJson('mtc_ssmpo', []);
    const cabecalho = ['ID', 'Número da SSMPO', 'Setor / Local', 'Descrição da Demanda', 'Solicitante', 'Status', 'Data de Abertura', 'Previsão / Conclusão'];
    const linhas = ssmpo.map(s => [
      s.id || '',
      s.numero || '',
      s.setor || s.local || '',
      s.descricao || '',
      s.solicitante || '',
      s.status || 'Pendente',
      s.data || s.dataAbertura || '',
      s.previsao || s.conclusao || ''
    ]);
    return [cabecalho, ...linhas];
  }

  // 8. Agenda Operacional
  function gerarDadosAgenda() {
    const agenda = parseJson('mtc_agenda', []);
    const cabecalho = ['ID', 'Título do Evento / Atividade', 'Data', 'Horário', 'Local', 'Responsável', 'Descrição / Detalhes', 'Status'];
    const linhas = agenda.map(a => [
      a.id || '',
      a.titulo || a.nome || '',
      a.data || '',
      a.horario || a.hora || '',
      a.local || '',
      a.responsavel || '',
      a.descricao || a.detalhes || '',
      a.status || 'Agendado'
    ]);
    return [cabecalho, ...linhas];
  }

  // 9. Contatos / Ramais
  function gerarDadosContatos() {
    const contatos = parseJson('mtc_contatos', []);
    const cabecalho = ['ID', 'Nome / Referência', 'Setor / Departamento', 'Ramal', 'Telefone / Celular', 'E-mail', 'Observações'];
    const linhas = contatos.map(c => [
      c.id || '',
      c.nome || '',
      c.setor || c.depto || '',
      c.ramal || '',
      c.telefone || c.celular || '',
      c.email || '',
      c.obs || ''
    ]);
    return [cabecalho, ...linhas];
  }

  // 10. Equipamentos
  function gerarDadosEquipamentos() {
    const equipamentos = parseJson('mtc_equipamentos', []);
    const cabecalho = ['ID', 'Nome do Equipamento', 'Código / Patrimônio', 'Tipo / Categoria', 'Setor / Local', 'Status', 'Última Revisão', 'Observações'];
    const linhas = equipamentos.map(e => [
      e.id || '',
      e.nome || '',
      e.codigo || e.patrimonio || '',
      e.tipo || e.categoria || '',
      e.setor || e.local || '',
      e.status || 'Operacional',
      e.ultimaRevisao || e.dataRevisao || '',
      e.obs || ''
    ]);
    return [cabecalho, ...linhas];
  }

  // 11. Checklist de Atividades
  function gerarDadosChecklist() {
    const statusAtiv = parseJson('mtc_atividade_status', {});
    const checklistSetor = parseJson('mtc_setor_checklist', {});
    const cabecalho = ['Chave / Identificador', 'Tipo / Categoria', 'Status / Conclusão', 'Última Atualização'];
    const linhas = [];

    Object.keys(statusAtiv).forEach(k => {
      linhas.push([k, 'Atividade Semanal', statusAtiv[k] ? 'Concluída' : 'Pendente', '']);
    });
    Object.keys(checklistSetor).forEach(k => {
      linhas.push([k, 'Checklist de Setor', JSON.stringify(checklistSetor[k]), '']);
    });

    return [cabecalho, ...linhas];
  }

  // -------------------------------------------------------------
  // EXPORTAÇÃO COMPLETA PARA GOOGLE SHEETS
  // -------------------------------------------------------------

  async function exportarTodosDadosParaPlanilha(spreadsheetId) {
    if (!spreadsheetId) {
      spreadsheetId = localStorage.getItem(CHAVE_SHEET_ID);
    }
    if (!spreadsheetId) {
      throw new Error('Nenhuma planilha selecionada ou conectada.');
    }

    // 1. Garantir que as abas existam na planilha
    const info = await obterInfoPlanilha(spreadsheetId);
    const abasExistentes = (info.sheets || []).map(s => s.properties.title);

    const abasDesejadas = [
      'VisaoGeral', 'Estoque', 'Equipe', 'Presenca', 'Chaves',
      'Radios', 'SSMPO', 'Agenda', 'Contatos', 'Equipamentos', 'Checklist'
    ];

    const requestsAdd = [];
    abasDesejadas.forEach(titulo => {
      if (!abasExistentes.includes(titulo)) {
        requestsAdd.push({
          addSheet: {
            properties: { title: titulo }
          }
        });
      }
    });

    if (requestsAdd.length > 0) {
      await apiGoogle(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        body: { requests: requestsAdd }
      });
    }

    // 2. Preparar todos os dados
    const dadosMap = {
      'VisaoGeral': gerarDadosVisaoGeral(),
      'Estoque': gerarDadosEstoque(),
      'Equipe': gerarDadosEquipe(),
      'Presenca': gerarDadosPresenca(),
      'Chaves': gerarDadosChaves(),
      'Radios': gerarDadosRadios(),
      'SSMPO': gerarDadosSSMPO(),
      'Agenda': gerarDadosAgenda(),
      'Contatos': gerarDadosContatos(),
      'Equipamentos': gerarDadosEquipamentos(),
      'Checklist': gerarDadosChecklist()
    };

    // 3. Limpar e atualizar valores em lote
    const dataValues = [];
    Object.keys(dadosMap).forEach(aba => {
      dataValues.push({
        range: `'${aba}'!A1:Z${Math.max(dadosMap[aba].length + 5, 20)}`,
        values: dadosMap[aba]
      });
    });

    await apiGoogle(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
      method: 'POST',
      body: {
        valueInputOption: 'USER_ENTERED',
        data: dataValues
      }
    });

    // 4. Aplicar estilos e formatação de cabeçalho (Azul Minas #0A2647, texto branco em negrito, congelar 1ª linha)
    try {
      const infoAtualizada = await obterInfoPlanilha(spreadsheetId);
      const sheetIdMap = {};
      (infoAtualizada.sheets || []).forEach(s => {
        sheetIdMap[s.properties.title] = s.properties.sheetId;
      });

      const styleRequests = [];
      abasDesejadas.forEach(aba => {
        const sheetId = sheetIdMap[aba];
        if (sheetId !== undefined) {
          // Congelar linha 1
          styleRequests.push({
            updateSheetProperties: {
              properties: {
                sheetId: sheetId,
                gridProperties: { frozenRowCount: 1 }
              },
              fields: 'gridProperties.frozenRowCount'
            }
          });

          // Estilo de cabeçalho da linha 1
          styleRequests.push({
            repeatCell: {
              range: {
                sheetId: sheetId,
                startRowIndex: 0,
                endRowIndex: 1
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.04, green: 0.15, blue: 0.28 },
                  textFormat: {
                    foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 },
                    bold: true,
                    fontSize: 10
                  },
                  horizontalAlignment: 'LEFT'
                }
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
            }
          });
        }
      });

      if (styleRequests.length > 0) {
        await apiGoogle(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
          method: 'POST',
          body: { requests: styleRequests }
        });
      }
    } catch (styleErr) {
      console.warn('Estilização visual concluída com aviso menor:', styleErr);
    }

    const agora = new Date();
    const stamp = agora.toLocaleString('pt-BR');
    localStorage.setItem(CHAVE_ULTIMO_SYNC, stamp);

    mostrarNotificacaoGoogle('Dados sincronizados com sucesso no Google Planilhas!', 'sucesso');
    atualizarUIStatusGoogle();

    return { sucesso: true, timestamp: stamp };
  }

  // -------------------------------------------------------------
  // IMPORTAÇÃO DO GOOGLE SHEETS PARA O PAINEL (COM CONFIRMAÇÃO)
  // -------------------------------------------------------------

  async function lerDadosPlanilha(spreadsheetId) {
    if (!spreadsheetId) {
      spreadsheetId = localStorage.getItem(CHAVE_SHEET_ID);
    }
    if (!spreadsheetId) {
      throw new Error('Nenhuma planilha conectada.');
    }

    const abas = ['Estoque', 'Equipe', 'Presenca', 'Chaves', 'Radios', 'SSMPO', 'Agenda', 'Contatos', 'Equipamentos'];
    const ranges = abas.map(a => `'${a}'!A1:Z500`).join('&ranges=');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?ranges=${ranges}`;
    
    const resp = await apiGoogle(url);
    const valueRanges = resp.valueRanges || [];

    const resultado = {};
    valueRanges.forEach((vr, idx) => {
      const nomeAba = abas[idx];
      const linhas = vr.values || [];
      if (linhas.length > 1) {
        const cabecalho = linhas[0];
        const dados = linhas.slice(1);
        resultado[nomeAba] = { cabecalho, dados };
      } else {
        resultado[nomeAba] = { cabecalho: [], dados: [] };
      }
    });

    return resultado;
  }

  // Executar a aplicação dos dados importados (chamado APÓS confirmação explícita do usuário)
  function aplicarDadosImportados(dadosPlanilha) {
    let contadores = { estoque: 0, equipe: 0, chaves: 0, radios: 0, ssmpo: 0, agenda: 0, contatos: 0 };

    // 1. Estoque
    if (dadosPlanilha.Estoque && dadosPlanilha.Estoque.dados.length > 0) {
      const novosItens = dadosPlanilha.Estoque.dados.map(linha => ({
        id: linha[0] || ('est_' + Math.random().toString(36).substr(2, 9)),
        codigo: linha[1] || '',
        nome: linha[2] || '',
        categoria: linha[3] || 'Geral',
        unidade: linha[4] || 'UN',
        quantidade: Number(linha[5] || 0),
        minimo: Number(linha[6] || 0),
        local: linha[8] || ''
      })).filter(i => i.nome);
      if (novosItens.length > 0) {
        localStorage.setItem('mtc_estoque', JSON.stringify(novosItens));
        contadores.estoque = novosItens.length;
      }
    }

    // 2. Equipe
    if (dadosPlanilha.Equipe && dadosPlanilha.Equipe.dados.length > 0) {
      const novaEquipe = dadosPlanilha.Equipe.dados.map(linha => ({
        id: linha[0] || ('eq_' + Math.random().toString(36).substr(2, 9)),
        nome: linha[1] || '',
        cargo: linha[2] || '',
        turno: linha[3] || '',
        horario: linha[4] || '',
        contato: linha[5] || '',
        status: linha[6] || 'Ativo',
        observacao: linha[7] || ''
      })).filter(e => e.nome);
      if (novaEquipe.length > 0) {
        localStorage.setItem('mtc_equipe_dem2', JSON.stringify(novaEquipe));
        contadores.equipe = novaEquipe.length;
      }
    }

    // 3. Chaves
    if (dadosPlanilha.Chaves && dadosPlanilha.Chaves.dados.length > 0) {
      const novasChaves = dadosPlanilha.Chaves.dados.map(linha => ({
        id: linha[0] || ('ch_' + Math.random().toString(36).substr(2, 9)),
        nome: linha[1] || '',
        setor: linha[2] || '',
        responsavel: linha[4] || '',
        retirada: linha[5] || '',
        devolucao: linha[6] || '',
        obs: linha[7] || ''
      })).filter(c => c.nome);
      if (novasChaves.length > 0) {
        localStorage.setItem('mtc_chaves', JSON.stringify(novasChaves));
        contadores.chaves = novasChaves.length;
      }
    }

    // 4. Rádios
    if (dadosPlanilha.Radios && dadosPlanilha.Radios.dados.length > 0) {
      const novosRadios = dadosPlanilha.Radios.dados.map(linha => ({
        id: linha[0] || ('rad_' + Math.random().toString(36).substr(2, 9)),
        numero: linha[1] || '',
        responsavel: linha[2] || '',
        status: linha[3] || 'Operacional',
        bateria: linha[4] || 'OK',
        turno: linha[5] || ''
      })).filter(r => r.numero);
      if (novosRadios.length > 0) {
        localStorage.setItem('mtc_radios', JSON.stringify(novosRadios));
        contadores.radios = novosRadios.length;
      }
    }

    // 5. SSMPO
    if (dadosPlanilha.SSMPO && dadosPlanilha.SSMPO.dados.length > 0) {
      const novasSSMPO = dadosPlanilha.SSMPO.dados.map(linha => ({
        id: linha[0] || ('ssm_' + Math.random().toString(36).substr(2, 9)),
        numero: linha[1] || '',
        setor: linha[2] || '',
        descricao: linha[3] || '',
        solicitante: linha[4] || '',
        status: linha[5] || 'Pendente',
        data: linha[6] || '',
        previsao: linha[7] || ''
      })).filter(s => s.numero || s.descricao);
      if (novasSSMPO.length > 0) {
        localStorage.setItem('mtc_ssmpo', JSON.stringify(novasSSMPO));
        contadores.ssmpo = novasSSMPO.length;
      }
    }

    // 6. Agenda
    if (dadosPlanilha.Agenda && dadosPlanilha.Agenda.dados.length > 0) {
      const novaAgenda = dadosPlanilha.Agenda.dados.map(linha => ({
        id: linha[0] || ('ag_' + Math.random().toString(36).substr(2, 9)),
        titulo: linha[1] || '',
        data: linha[2] || '',
        horario: linha[3] || '',
        local: linha[4] || '',
        responsavel: linha[5] || '',
        descricao: linha[6] || '',
        status: linha[7] || 'Agendado'
      })).filter(a => a.titulo);
      if (novaAgenda.length > 0) {
        localStorage.setItem('mtc_agenda', JSON.stringify(novaAgenda));
        contadores.agenda = novaAgenda.length;
      }
    }

    // 7. Contatos
    if (dadosPlanilha.Contatos && dadosPlanilha.Contatos.dados.length > 0) {
      const novosContatos = dadosPlanilha.Contatos.dados.map(linha => ({
        id: linha[0] || ('ct_' + Math.random().toString(36).substr(2, 9)),
        nome: linha[1] || '',
        setor: linha[2] || '',
        ramal: linha[3] || '',
        telefone: linha[4] || '',
        email: linha[5] || '',
        obs: linha[6] || ''
      })).filter(c => c.nome);
      if (novosContatos.length > 0) {
        localStorage.setItem('mtc_contatos', JSON.stringify(novosContatos));
        contadores.contatos = novosContatos.length;
      }
    }

    // Atualizar UI do aplicativo se as funções de renderização existirem
    try {
      if (typeof window.renderEstoque === 'function') window.renderEstoque();
      if (typeof window.renderEquipe === 'function') window.renderEquipe();
      if (typeof window.renderChaves === 'function') window.renderChaves();
      if (typeof window.renderRadios === 'function') window.renderRadios();
      if (typeof window.renderSSMPO === 'function') window.renderSSMPO();
      if (typeof window.renderAgenda === 'function') window.renderAgenda();
      if (typeof window.renderContatos === 'function') window.renderContatos();
      if (typeof window.atualizarSelosHub === 'function') window.atualizarSelosHub();
    } catch (e) {
      console.log('Atualização de views pós-importação:', e);
    }

    return contadores;
  }

  // -------------------------------------------------------------
  // UI & FEEDBACK HELPERS
  // -------------------------------------------------------------

  function mostrarNotificacaoGoogle(mensagem, tipo = 'info') {
    let el = document.getElementById('notificacaoSheets');
    if (!el) {
      el = document.createElement('div');
      el.id = 'notificacaoSheets';
      el.className = 'notificacao-sheets';
      document.body.appendChild(el);
    }
    
    let icone = 'ℹ️';
    let corFundo = '#0A2647';
    if (tipo === 'sucesso') {
      icone = '✅';
      corFundo = '#1B5E45';
    } else if (tipo === 'erro') {
      icone = '⚠️';
      corFundo = '#B3462B';
    }

    el.style.backgroundColor = corFundo;
    el.innerHTML = `<span style="font-size:16px;margin-right:8px;">${icone}</span><span>${mensagem}</span>`;
    el.classList.add('visivel');

    setTimeout(() => {
      el.classList.remove('visivel');
    }, 4500);
  }

  function atualizarUIStatusGoogle() {
    const seloHub = document.getElementById('seloSheetsStatus');
    const containerAuth = document.getElementById('sheetsAuthContainer');
    const containerConfig = document.getElementById('sheetsConfigContainer');
    const txtUserEmail = document.getElementById('sheetsUserEmail');
    const imgUserAvatar = document.getElementById('sheetsUserAvatar');
    const txtPlanilhaNome = document.getElementById('sheetsPlanilhaAtualNome');
    const linkPlanilha = document.getElementById('sheetsLinkAbrir');
    const txtUltimoSync = document.getElementById('sheetsUltimoSync');
    const headerAuthBtn = document.getElementById('btnGoogleAuthHeader');

    const sheetId = localStorage.getItem(CHAVE_SHEET_ID);
    const sheetNome = localStorage.getItem(CHAVE_SHEET_NOME) || 'Planilha MINAS II';
    const sheetUrl = localStorage.getItem(CHAVE_SHEET_URL) || (sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit` : '');
    const ultimoSync = localStorage.getItem(CHAVE_ULTIMO_SYNC);

    const telaBloqueio = document.getElementById('telaBloqueioGoogleAuth');

    if (currentUser) {
      // Usuário autenticado com sucesso: desbloqueia tela de acesso
      if (telaBloqueio) {
        telaBloqueio.style.opacity = '0';
        telaBloqueio.style.pointerEvents = 'none';
        setTimeout(() => {
          if (telaBloqueio) telaBloqueio.style.display = 'none';
        }, 300);
      }

      if (seloHub) {
        seloHub.innerText = sheetId ? 'Sincronizado' : 'Conectado';
        seloHub.className = 'selo ok';
      }
      if (containerAuth) containerAuth.style.display = 'none';
      if (containerConfig) containerConfig.style.display = 'block';
      if (txtUserEmail) txtUserEmail.innerText = currentUser.email || currentUser.displayName || 'Conta Google Conectada';
      if (imgUserAvatar) {
        if (currentUser.photoURL) {
          imgUserAvatar.src = currentUser.photoURL;
          imgUserAvatar.style.display = 'block';
        } else {
          imgUserAvatar.style.display = 'none';
        }
      }

      // Atualiza botão do cabeçalho quando autenticado
      if (headerAuthBtn) {
        const foto = currentUser.photoURL ? `<img src="${currentUser.photoURL}" style="width:20px;height:20px;border-radius:50%;object-fit:cover;">` : `<span style="font-size:12px;">👤</span>`;
        const nomeCurto = (currentUser.displayName || currentUser.email || 'Google').split(' ')[0].slice(0, 10);
        headerAuthBtn.innerHTML = `
          <div style="display:flex;align-items:center;gap:6px;">
            ${foto}
            <span style="font-size:12px;font-weight:600;max-width:90px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${nomeCurto}</span>
            <span style="width:7px;height:7px;border-radius:50%;background:#34A853;display:inline-block;" title="Online"></span>
          </div>
        `;
        headerAuthBtn.title = `Conectado como ${currentUser.email || currentUser.displayName}. Clique para abrir Google Planilhas.`;
        headerAuthBtn.onclick = () => abrirModalGoogleSheets();
      }
    } else {
      // Usuário NÃO autenticado: bloqueia serviços e apresenta tela de login com Google
      if (telaBloqueio) {
        telaBloqueio.style.display = 'flex';
        telaBloqueio.style.pointerEvents = 'auto';
        setTimeout(() => {
          if (telaBloqueio) telaBloqueio.style.opacity = '1';
        }, 10);
      }

      if (seloHub) {
        seloHub.innerText = 'Conectar';
        seloHub.className = 'selo alerta';
      }
      if (containerAuth) containerAuth.style.display = 'block';
      if (containerConfig) containerConfig.style.display = 'none';

      // Atualiza botão do cabeçalho quando NÃO autenticado (Botão oficial Google)
      if (headerAuthBtn) {
        headerAuthBtn.innerHTML = `
          <div style="display:flex;align-items:center;gap:6px;">
            <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style="width:16px;height:16px;display:block;">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
            </svg>
            <span style="font-size:12px;font-weight:600;">Entrar com Google</span>
          </div>
        `;
        headerAuthBtn.title = 'Entrar com Conta Google';
        headerAuthBtn.onclick = () => loginGoogle();
      }
    }

    if (sheetId && txtPlanilhaNome) {
      txtPlanilhaNome.innerText = sheetNome;
      if (linkPlanilha) {
        linkPlanilha.href = sheetUrl;
        linkPlanilha.style.display = 'inline-flex';
      }
    } else if (txtPlanilhaNome) {
      txtPlanilhaNome.innerText = 'Nenhuma planilha vinculada ainda.';
      if (linkPlanilha) linkPlanilha.style.display = 'none';
    }

    if (txtUltimoSync) {
      txtUltimoSync.innerText = ultimoSync ? `Última sincronização: ${ultimoSync}` : 'Nunca sincronizado';
    }
  }

  async function carregarPlanilhasRecentesDrive() {
    const listaEl = document.getElementById('listaPlanilhasDrive');
    if (!listaEl) return;
    listaEl.innerHTML = '<div style="padding:12px;text-align:center;color:var(--texto-suave);font-size:13px;">Carregando suas planilhas do Google Drive...</div>';

    try {
      const planilhas = await listarPlanilhasDrive();
      if (planilhas.length === 0) {
        listaEl.innerHTML = '<div style="padding:12px;text-align:center;color:var(--texto-suave);font-size:13px;">Nenhuma planilha encontrada no Drive. Crie uma nova acima!</div>';
        return;
      }

      listaEl.innerHTML = planilhas.map(p => {
        const dataMod = new Date(p.modifiedTime).toLocaleDateString('pt-BR');
        return `
          <div class="item-planilha-drive" onclick="PainelSheets.selecionarPlanilha('${p.id}', '${p.name.replace(/'/g, "\\'")}', '${p.webViewLink}')">
            <div style="display:flex;align-items:center;gap:10px;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#0F9D58"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
              <div>
                <div style="font-weight:600;font-size:14px;color:var(--texto);">${p.name}</div>
                <div style="font-size:12px;color:var(--texto-suave);">Modificado em: ${dataMod}</div>
              </div>
            </div>
            <button class="btn-acao-tabela" style="background:var(--verde-100);color:var(--verde-900);border:1px solid var(--verde-700);padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600;">Vincular</button>
          </div>
        `;
      }).join('');
    } catch (e) {
      listaEl.innerHTML = `<div style="padding:12px;text-align:center;color:var(--alerta);font-size:13px;">Erro ao carregar do Drive: ${e.message}</div>`;
    }
  }

  function selecionarPlanilha(id, nome, url) {
    localStorage.setItem(CHAVE_SHEET_ID, id);
    localStorage.setItem(CHAVE_SHEET_NOME, nome);
    localStorage.setItem(CHAVE_SHEET_URL, url || `https://docs.google.com/spreadsheets/d/${id}/edit`);
    mostrarNotificacaoGoogle(`Planilha "${nome}" vinculada com sucesso!`, 'sucesso');
    atualizarUIStatusGoogle();
  }

  // -------------------------------------------------------------
  // CONTROLES DE MODAIS E EVENTOS
  // -------------------------------------------------------------

  function abrirModalGoogleSheets() {
    initFirebase();
    atualizarUIStatusGoogle();
    const modal = document.getElementById('modalGoogleSheets');
    if (modal) {
      modal.style.display = 'flex';
      if (currentUser) {
        carregarPlanilhasRecentesDrive();
      }
    }
  }

  function fecharModalGoogleSheets() {
    const modal = document.getElementById('modalGoogleSheets');
    if (modal) modal.style.display = 'none';
  }

  // Modal de Confirmação de Importação (MANDATÓRIO para operações de mutação)
  let dadosImportacaoPendentes = null;

  async function iniciarFluxoImportacao() {
    const sheetId = localStorage.getItem(CHAVE_SHEET_ID);
    if (!sheetId) {
      mostrarNotificacaoGoogle('Vincule ou crie uma planilha primeiro antes de importar.', 'erro');
      return;
    }

    try {
      mostrarNotificacaoGoogle('Lendo dados da planilha Google...', 'info');
      const dados = await lerDadosPlanilha(sheetId);
      dadosImportacaoPendentes = dados;

      // Montar resumo de registros
      const contEstoque = (dados.Estoque && dados.Estoque.dados.length) || 0;
      const contEquipe = (dados.Equipe && dados.Equipe.dados.length) || 0;
      const contChaves = (dados.Chaves && dados.Chaves.dados.length) || 0;
      const contRadios = (dados.Radios && dados.Radios.dados.length) || 0;
      const contSSMPO = (dados.SSMPO && dados.SSMPO.dados.length) || 0;
      const contAgenda = (dados.Agenda && dados.Agenda.dados.length) || 0;
      const contContatos = (dados.Contatos && dados.Contatos.dados.length) || 0;

      const resumoHtml = `
        <div style="background:var(--fundo);padding:12px;border-radius:8px;border:1px solid var(--linha);font-size:13px;line-height:1.6;margin-bottom:14px;">
          <div style="font-weight:600;color:var(--verde-900);margin-bottom:6px;">📋 Registros encontrados na planilha:</div>
          <div>• <strong>Estoque:</strong> ${contEstoque} itens</div>
          <div>• <strong>Equipe DEM2:</strong> ${contEquipe} colaboradores</div>
          <div>• <strong>Chaves:</strong> ${contChaves} chaves</div>
          <div>• <strong>Rádios:</strong> ${contRadios} comunicadores</div>
          <div>• <strong>SSMPO:</strong> ${contSSMPO} solicitações</div>
          <div>• <strong>Agenda:</strong> ${contAgenda} eventos</div>
          <div>• <strong>Contatos:</strong> ${contContatos} ramais/telefones</div>
        </div>
      `;

      const corpoEl = document.getElementById('corpoConfirmacaoImportacao');
      if (corpoEl) corpoEl.innerHTML = resumoHtml;

      const modalConf = document.getElementById('modalConfirmacaoImportacaoSheets');
      if (modalConf) modalConf.style.display = 'flex';

    } catch (e) {
      console.error('Erro na leitura da planilha:', e);
      mostrarNotificacaoGoogle('Erro ao ler planilha: ' + e.message, 'erro');
    }
  }

  function confirmarImportacao() {
    if (!dadosImportacaoPendentes) return;
    try {
      const res = aplicarDadosImportados(dadosImportacaoPendentes);
      fecharModalConfirmacaoImportacao();
      mostrarNotificacaoGoogle('Importação concluída com sucesso! Todos os módulos foram atualizados.', 'sucesso');
      dadosImportacaoPendentes = null;
    } catch (e) {
      console.error('Erro ao aplicar dados:', e);
      mostrarNotificacaoGoogle('Erro ao aplicar importação: ' + e.message, 'erro');
    }
  }

  function fecharModalConfirmacaoImportacao() {
    const modalConf = document.getElementById('modalConfirmacaoImportacaoSheets');
    if (modalConf) modalConf.style.display = 'none';
  }

  // Inicializar listeners ao carregar a página
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => {
      initFirebase();
    });
  } else {
    initFirebase();
  }

  // Exportar API global
  window.PainelSheets = {
    loginGoogle,
    loginAcessoRapido,
    abrirModalAcessoRapido,
    fecharModalAcessoRapido,
    confirmarAcessoRapido,
    logoutGoogle,
    obterToken,
    criarNovaPlanilha,
    listarPlanilhasDrive,
    exportarTodosDadosParaPlanilha,
    iniciarFluxoImportacao,
    confirmarImportacao,
    fecharModalConfirmacaoImportacao,
    selecionarPlanilha,
    abrirModalGoogleSheets,
    fecharModalGoogleSheets,
    carregarPlanilhasRecentesDrive,
    atualizarUIStatus: atualizarUIStatusGoogle,
    mostrarNotificacao: mostrarNotificacaoGoogle
  };

})(window);
