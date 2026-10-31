import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, 'painel_minas_ii_dados.json');
const HISTORICO_DIAS_FILE = path.join(__dirname, 'painel_minas_ii_historico_dias.json');

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.text({ limit: '50mb', type: 'text/*' }));

// CORS headers for seamless multi-device communication
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Sync store in memory, disk persistence and SSE subscribers
let dadosNuvemLocal = null;
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    if (raw && raw.trim()) dadosNuvemLocal = JSON.parse(raw);
  }
} catch(err) {
  console.warn('Could not read existing DATA_FILE:', err);
}

// Se DATA_FILE ainda não existir ou estiver vazio, tenta carregar do snapshot do dia 30/10 ou 31/10
if (!dadosNuvemLocal || !dadosNuvemLocal.dados || Object.keys(dadosNuvemLocal.dados).length === 0) {
  try {
    if (fs.existsSync(HISTORICO_DIAS_FILE)) {
      const hist = JSON.parse(fs.readFileSync(HISTORICO_DIAS_FILE, 'utf8') || '[]');
      if (Array.isArray(hist) && hist.length > 0 && hist[0].dados) {
        dadosNuvemLocal = JSON.parse(JSON.stringify(hist[0].dados));
        fs.writeFileSync(DATA_FILE, JSON.stringify(dadosNuvemLocal, null, 2), 'utf8');
        console.log('[Server] Inicializado DATA_FILE a partir do histórico diário.');
      }
    }
  } catch(e){}
}

let clientesSse = [];
let presencaPerfis = {};

// Função auxiliar para nomes dos dias da semana
function obterNomeDiaSemana(dataIso) {
  try {
    const d = new Date(dataIso + 'T12:00:00');
    const dias = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
    return dias[d.getDay()] || '';
  } catch(e) {
    return '';
  }
}

// Salva ou atualiza um snapshot do dia em painel_minas_ii_historico_dias.json
function salvarHistoricoDia(dia, dadosCompletos, labelCustom) {
  try {
    if (!dia || !dadosCompletos) return;
    let lista = [];
    if (fs.existsSync(HISTORICO_DIAS_FILE)) {
      try {
        lista = JSON.parse(fs.readFileSync(HISTORICO_DIAS_FILE, 'utf8') || '[]');
      } catch(e) { lista = []; }
    }

    const safeParse = (val, fallback) => {
      if (!val) return fallback;
      if (typeof val === 'object') return val;
      try { return JSON.parse(val); } catch(e) { return fallback; }
    };

    const pres = safeParse(dadosCompletos.mtc_presenca, {});
    const countPres = (pres[dia] && Object.keys(pres[dia]).length) || 0;
    const eq = safeParse(dadosCompletos.mtc_equipe_dem2, []);
    const rad = safeParse(dadosCompletos.mtc_radios, []);
    const ativ = safeParse(dadosCompletos.mtc_atividade_status, {});
    const countAtiv = Object.values(ativ).filter(v => (typeof v === 'string' ? v : v?.status) === 'Concluído').length;

    const resumo = `Presença (${countPres} registros) · Atividades (${countAtiv} concluídas) · Rádios (${Array.isArray(rad) ? rad.length : 29}) · Equipe DEM2 (${Array.isArray(eq) ? eq.length : 117} colaboradores)`;
    
    const partes = dia.split('-');
    const label = labelCustom || `Backup dia ${partes[2] || dia}/${partes[1] || ''} (${obterNomeDiaSemana(dia)})`;

    const idxExistente = lista.findIndex(item => item.data === dia);
    const novoItem = {
      data: dia,
      label: label,
      criadoEm: new Date().toISOString(),
      resumo: resumo,
      dados: {
        dados: Object.assign({}, dadosCompletos),
        enviadoEm: new Date().toISOString()
      }
    };

    if (idxExistente >= 0) {
      lista[idxExistente] = novoItem;
    } else {
      lista.unshift(novoItem);
    }

    // Ordena mais recente primeiro
    lista.sort((a, b) => (b.data || '').localeCompare(a.data || ''));

    // Mantém no mínimo os dias 2026-10-29, 2026-10-30, 2026-10-31 e até 30 dias
    fs.writeFileSync(HISTORICO_DIAS_FILE, JSON.stringify(lista, null, 2), 'utf8');
  } catch(err) {
    console.warn('Erro ao salvar historico dias:', err);
  }
}

// Retorna lista com status online/offline calculado pelo tempo de heartbeat
function obterListaPresenca() {
  const agora = Date.now();
  const LIMITE_ONLINE_MS = 75 * 1000; // 75 segundos
  const lista = Object.values(presencaPerfis).map(p => {
    const inativoMs = agora - (p.ultimaAtividade || 0);
    const estaOnline = p.online !== false && inativoMs < LIMITE_ONLINE_MS;
    return {
      ...p,
      online: estaOnline,
      tempoInativoSegundos: Math.floor(inativoMs / 1000)
    };
  });
  return lista.sort((a, b) => {
    if (a.online && !b.online) return -1;
    if (!a.online && b.online) return 1;
    return (b.ultimaAtividade || 0) - (a.ultimaAtividade || 0);
  });
}

function transmitirPresenca() {
  const lista = obterListaPresenca();
  const payload = JSON.stringify(lista);
  clientesSse.forEach(c => {
    try {
      c.write(`event: presenca\ndata: ${payload}\n\n`);
    } catch(e){}
  });
}

// Limpeza periódica para transmitir transições de online -> offline
setInterval(() => {
  if (clientesSse.length > 0 && Object.keys(presencaPerfis).length > 0) {
    transmitirPresenca();
  }
}, 30000);

// Endpoint principal de sincronização em nuvem e SSE
app.all('/painel_minas_ii.json', (req, res) => {
  if (req.method === 'GET') {
    if (req.headers.accept && req.headers.accept.includes('text/event-stream')) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
      res.write(`event: put\ndata: ${JSON.stringify({ path: '/', data: dadosNuvemLocal || {} })}\n\n`);
      res.write(`event: presenca\ndata: ${JSON.stringify(obterListaPresenca())}\n\n`);
      clientesSse.push(res);
      req.on('close', () => {
        clientesSse = clientesSse.filter(c => c !== res);
      });
      return;
    }
    return res.json(dadosNuvemLocal || { dados: {}, enviadoEm: '' });
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    let payload = req.body;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch(e){}
    }

    if (payload && payload.dados) {
      if (!dadosNuvemLocal) dadosNuvemLocal = { dados: {}, enviadoEm: '' };
      if (!dadosNuvemLocal.dados) dadosNuvemLocal.dados = {};

      // Função auxiliar segura para valores JSON
      const safeParse = (val, fallback) => {
        if (val === null || val === undefined) return fallback;
        if (typeof val === 'object') return val;
        if (typeof val === 'string') {
          try { return JSON.parse(val); } catch(e) { return fallback; }
        }
        return fallback;
      };

      // 1. Preservação e mesclagem inteligente de Presença (data por data)
      if (payload.dados.mtc_presenca && dadosNuvemLocal.dados.mtc_presenca) {
        try {
          const prExist = safeParse(dadosNuvemLocal.dados.mtc_presenca, {});
          const prNovo = safeParse(payload.dados.mtc_presenca, {});
          const prMerged = Object.assign({}, prExist, prNovo);
          payload.dados.mtc_presenca = JSON.stringify(prMerged);
          payload.dados.mtc_presenca_backup_historico = JSON.stringify(prMerged);
        } catch(e){}
      } else if (!payload.dados.mtc_presenca && dadosNuvemLocal.dados.mtc_presenca) {
        payload.dados.mtc_presenca = dadosNuvemLocal.dados.mtc_presenca;
        if (dadosNuvemLocal.dados.mtc_presenca_backup_historico) {
          payload.dados.mtc_presenca_backup_historico = dadosNuvemLocal.dados.mtc_presenca_backup_historico;
        }
      }

      // 2. Preservação e mesclagem inteligente de Agenda (por id de evento)
      if (payload.dados.mtc_agenda && dadosNuvemLocal.dados.mtc_agenda) {
        try {
          const agExist = safeParse(dadosNuvemLocal.dados.mtc_agenda, []);
          const agNovo = safeParse(payload.dados.mtc_agenda, []);
          const mapAg = new Map();
          if (Array.isArray(agExist)) agExist.forEach(i => { if (i && i.id) mapAg.set(i.id, i); });
          if (Array.isArray(agNovo)) agNovo.forEach(i => { if (i && i.id) mapAg.set(i.id, i); });
          payload.dados.mtc_agenda = JSON.stringify(Array.from(mapAg.values()));
        } catch(e){}
      } else if (!payload.dados.mtc_agenda && dadosNuvemLocal.dados.mtc_agenda) {
        payload.dados.mtc_agenda = dadosNuvemLocal.dados.mtc_agenda;
      }

      // 3. Preservação de Rádios e Consertos (impede payload vazio zerar a lista de 29 rádios)
      if (payload.dados.mtc_radios) {
        const radNovo = safeParse(payload.dados.mtc_radios, []);
        const radExist = safeParse(dadosNuvemLocal.dados.mtc_radios, []);
        if (Array.isArray(radNovo) && radNovo.length === 0 && Array.isArray(radExist) && radExist.length > 0) {
          payload.dados.mtc_radios = dadosNuvemLocal.dados.mtc_radios;
        }
      } else if (!payload.dados.mtc_radios && dadosNuvemLocal.dados.mtc_radios) {
        payload.dados.mtc_radios = dadosNuvemLocal.dados.mtc_radios;
      }

      if (!payload.dados.mtc_radios_conserto && dadosNuvemLocal.dados.mtc_radios_conserto) {
        payload.dados.mtc_radios_conserto = dadosNuvemLocal.dados.mtc_radios_conserto;
      }

      // 4. Preservação e mesclagem inteligente de Atividades Semanais
      if (payload.dados.mtc_atividade_status_historico && dadosNuvemLocal.dados.mtc_atividade_status_historico) {
        try {
          const histExist = safeParse(dadosNuvemLocal.dados.mtc_atividade_status_historico, {});
          const histNovo = safeParse(payload.dados.mtc_atividade_status_historico, {});
          const histMerged = Object.assign({}, histExist);
          Object.keys(histNovo).forEach(d => {
            histMerged[d] = Object.assign({}, histMerged[d] || {}, histNovo[d] || {});
          });
          payload.dados.mtc_atividade_status_historico = JSON.stringify(histMerged);
        } catch(e){}
      } else if (!payload.dados.mtc_atividade_status_historico && dadosNuvemLocal.dados.mtc_atividade_status_historico) {
        payload.dados.mtc_atividade_status_historico = dadosNuvemLocal.dados.mtc_atividade_status_historico;
      }

      if (payload.dados.mtc_atividade_status && dadosNuvemLocal.dados.mtc_atividade_status) {
        try {
          const ativNovo = safeParse(payload.dados.mtc_atividade_status, {});
          const ativExist = safeParse(dadosNuvemLocal.dados.mtc_atividade_status, {});
          if (Object.keys(ativNovo).length === 0 && Object.keys(ativExist).length > 0) {
            payload.dados.mtc_atividade_status = dadosNuvemLocal.dados.mtc_atividade_status;
          }
        } catch(e){}
      } else if (!payload.dados.mtc_atividade_status && dadosNuvemLocal.dados.mtc_atividade_status) {
        payload.dados.mtc_atividade_status = dadosNuvemLocal.dados.mtc_atividade_status;
      }

      // 5. Preservação inteligente de Equipe DEM2 (impede reversão por payload mais antigo)
      if (payload.dados.mtc_equipe_dem2) {
        const modExistente = (dadosNuvemLocal.dados && dadosNuvemLocal.dados.mtc_equipe_dem2_modificado_em) || dadosNuvemLocal.enviadoEm;
        const modNovo = payload.dados.mtc_equipe_dem2_modificado_em || payload.enviadoEm;
        if (modExistente && modNovo && new Date(modExistente).getTime() > new Date(modNovo).getTime()) {
          payload.dados.mtc_equipe_dem2 = dadosNuvemLocal.dados.mtc_equipe_dem2;
          if (dadosNuvemLocal.dados.mtc_equipe_dem2_modificado_em) {
            payload.dados.mtc_equipe_dem2_modificado_em = dadosNuvemLocal.dados.mtc_equipe_dem2_modificado_em;
          }
        }
      } else if (!payload.dados.mtc_equipe_dem2 && dadosNuvemLocal.dados.mtc_equipe_dem2) {
        payload.dados.mtc_equipe_dem2 = dadosNuvemLocal.dados.mtc_equipe_dem2;
        if (dadosNuvemLocal.dados.mtc_equipe_dem2_modificado_em) {
          payload.dados.mtc_equipe_dem2_modificado_em = dadosNuvemLocal.dados.mtc_equipe_dem2_modificado_em;
        }
      }

      // 6. Preservação e mesclagem de snapshots de histórico da equipe
      if (payload.dados.mtc_equipe_snapshots || (dadosNuvemLocal.dados && dadosNuvemLocal.dados.mtc_equipe_snapshots)) {
        try {
          const sExist = safeParse(dadosNuvemLocal.dados && dadosNuvemLocal.dados.mtc_equipe_snapshots, []);
          const sNovo = safeParse(payload.dados.mtc_equipe_snapshots, []);
          const mapS = new Map();
          if (Array.isArray(sExist)) sExist.forEach(s => { if (s && (s.id || s.timestamp)) mapS.set(s.id || s.timestamp, s); });
          if (Array.isArray(sNovo)) sNovo.forEach(s => { if (s && (s.id || s.timestamp)) mapS.set(s.id || s.timestamp, s); });
          const sMerged = Array.from(mapS.values()).sort((a,b) => (b.timestamp||0) - (a.timestamp||0)).slice(0, 60);
          payload.dados.mtc_equipe_snapshots = JSON.stringify(sMerged);
        } catch(e){}
      }

      // 7. Mesclagem de todos os outros módulos (não descarta chaves existentes)
      dadosNuvemLocal.dados = Object.assign({}, dadosNuvemLocal.dados, payload.dados);
      dadosNuvemLocal.enviadoEm = payload.enviadoEm || new Date().toISOString();
    } else if (payload) {
      dadosNuvemLocal = payload;
    }

    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(dadosNuvemLocal, null, 2), 'utf8');
      // Atualiza o snapshot diário para a data corrente
      const hojeIso = new Date().toISOString().slice(0, 10);
      salvarHistoricoDia(hojeIso, dadosNuvemLocal.dados);
    } catch(err) {
      console.warn('Failed to persist DATA_FILE:', err);
    }

    clientesSse.forEach(c => {
      try {
        c.write(`event: put\ndata: ${JSON.stringify({ path: '/', data: dadosNuvemLocal })}\n\n`);
      } catch(e){}
    });
    return res.json(dadosNuvemLocal || { ok: true });
  }

  res.sendStatus(405);
});

// Endpoint: Retorna a lista de backups diários disponíveis para restauração em nuvem
app.get('/api/nuvem/historico-dias', (req, res) => {
  try {
    if (fs.existsSync(HISTORICO_DIAS_FILE)) {
      const lista = JSON.parse(fs.readFileSync(HISTORICO_DIAS_FILE, 'utf8') || '[]');
      const resumos = lista.map(item => ({
        data: item.data,
        label: item.label,
        criadoEm: item.criadoEm,
        resumo: item.resumo
      }));
      return res.json({ ok: true, dias: resumos });
    }
  } catch(e){}
  res.json({ ok: true, dias: [] });
});

// Endpoint: Restaura na nuvem um dia específico (ex: 2026-10-30), sincronizando todos os aparelhos
app.post('/api/nuvem/restaurar-dia', (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e){}
  }
  const diaAlvo = body && body.dia;
  if (!diaAlvo) {
    return res.status(400).json({ error: 'Data do backup obrigatória (ex: 2026-10-30)' });
  }

  try {
    if (!fs.existsSync(HISTORICO_DIAS_FILE)) {
      return res.status(404).json({ error: 'Nenhum histórico de backups diários encontrado.' });
    }
    const lista = JSON.parse(fs.readFileSync(HISTORICO_DIAS_FILE, 'utf8') || '[]');
    const snapshot = lista.find(item => item.data === diaAlvo);
    if (!snapshot || !snapshot.dados) {
      return res.status(404).json({ error: `Backup do dia ${diaAlvo} não localizado.` });
    }

    // Aplica o snapshot restaurado
    dadosNuvemLocal = JSON.parse(JSON.stringify(snapshot.dados));
    dadosNuvemLocal.enviadoEm = new Date().toISOString();

    fs.writeFileSync(DATA_FILE, JSON.stringify(dadosNuvemLocal, null, 2), 'utf8');

    // Transmite a restauração via SSE para todos os dispositivos conectados
    clientesSse.forEach(c => {
      try {
        c.write(`event: put\ndata: ${JSON.stringify({ path: '/', data: dadosNuvemLocal })}\n\n`);
      } catch(e){}
    });

    console.log(`[Backup Nuvem] Dia ${diaAlvo} restaurado com sucesso e propagado via SSE.`);
    return res.json({
      ok: true,
      dia: diaAlvo,
      label: snapshot.label,
      resumo: snapshot.resumo,
      dados: dadosNuvemLocal.dados,
      enviadoEm: dadosNuvemLocal.enviadoEm
    });
  } catch(err) {
    console.error('Erro ao restaurar dia:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Endpoint para consulta de presença e perfis conectados
app.get('/api/presenca', (req, res) => {
  res.json(obterListaPresenca());
});

// Heartbeat de presença de um perfil
app.post('/api/presenca', (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e){}
  }
  if (!body || !body.sessaoId) {
    return res.status(400).json({ error: 'sessaoId obrigatorio' });
  }

  const agora = Date.now();
  const sessaoId = body.sessaoId;

  presencaPerfis[sessaoId] = {
    sessaoId: sessaoId,
    uid: body.uid || '',
    nome: body.nome || 'Operador',
    email: body.email || '',
    tipo: body.tipo || 'Operador',
    foto: body.foto || '',
    dispositivo: body.dispositivo || 'Navegador Web',
    online: body.online !== false,
    ultimaAtividade: agora,
    conectadoEm: presencaPerfis[sessaoId]?.conectadoEm || agora
  };

  transmitirPresenca();
  res.json({ ok: true, perfis: obterListaPresenca() });
});

// Desconexão manual imediata (offline)
app.post('/api/presenca/offline', (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e){}
  }
  if (body && body.sessaoId && presencaPerfis[body.sessaoId]) {
    presencaPerfis[body.sessaoId].online = false;
    presencaPerfis[body.sessaoId].ultimaAtividade = Date.now();
    transmitirPresenca();
  }
  res.json({ ok: true });
});

// Serve static assets from project root
app.use(express.static(__dirname));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Fallback to index.html for SPA/Static site routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
