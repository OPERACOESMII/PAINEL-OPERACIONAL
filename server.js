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

if (dadosNuvemLocal && dadosNuvemLocal.dados) {
  if (!dadosNuvemLocal.dados.mtc_chaves) {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
      const m = html.match(/const CHAVES_SEED = (\[[\s\S]*?\]);/);
      if (m) {
        dadosNuvemLocal.dados.mtc_chaves = m[1];
        fs.writeFileSync(DATA_FILE, JSON.stringify(dadosNuvemLocal, null, 2), 'utf8');
        console.log('[Server] Inicializado mtc_chaves em dadosNuvemLocal a partir do catálogo oficial de chaves.');
      }
    } catch(e){}
  }
}

// Estruturação e separação de backups por KPIs correspondentes
function gerarEstruturaKpis(dadosBrutos) {
  const dados = dadosBrutos || {};
  const safeParse = (val, fallback) => {
    if (!val) return fallback;
    if (typeof val === 'object') return val;
    try { return JSON.parse(val); } catch(e) { return fallback; }
  };

  const presenca = safeParse(dados.mtc_presenca, {});
  const presencaHistorico = safeParse(dados.mtc_presenca_backup_historico, {});
  const equipe = safeParse(dados.mtc_equipe_dem2, []);
  const equipeSnapshots = safeParse(dados.mtc_equipe_snapshots, []);
  const terceirizados = safeParse(dados.mtc_terceirizados, []);

  const checklistSetores = safeParse(dados.mtc_setor_checklist, {});
  const statusAtividades = safeParse(dados.mtc_atividade_status, {});
  const historicoAtividades = safeParse(dados.mtc_atividade_status_historico, {});
  const atividadesExtras = safeParse(dados.mtc_atividades_extras, {});

  const agenda = safeParse(dados.mtc_agenda, []);
  const agendaHistorico = safeParse(dados.mtc_agenda_backup_historico, []);

  const radios = safeParse(dados.mtc_radios, []);
  const radiosConserto = safeParse(dados.mtc_radios_conserto, []);

  const chaves = safeParse(dados.mtc_chaves, []);
  const estoque = safeParse(dados.mtc_estoque, []);
  const solicitacoes = safeParse(dados.mtc_solicitacoes_materiais, []);
  const ssmpo = safeParse(dados.mtc_ssmpo, []);
  const contatos = safeParse(dados.mtc_contatos, []);
  const equipamentos = safeParse(dados.mtc_equipamentos, []);

  const hoje = new Date().toISOString().slice(0, 10);
  const presHoje = (presenca[hoje] && Object.keys(presenca[hoje]).length) || 0;
  const concluidasHoje = Object.values(statusAtividades).filter(v => {
    const s = typeof v === 'string' ? v : v?.status;
    return s === 'Concluída' || s === 'Concluído';
  }).length;

  return {
    presenca_equipe: {
      id: 'presenca_equipe',
      titulo: 'Presença e Equipe DEM2',
      icone: '👥',
      resumo: `${presHoje} presenças hoje · ${Array.isArray(equipe) ? equipe.length : 117} colaboradores DEM2`,
      chaves: ['mtc_presenca', 'mtc_presenca_backup_historico', 'mtc_equipe_dem2', 'mtc_equipe_snapshots', 'mtc_equipe_dem2_modificado_em', 'mtc_terceirizados'],
      dados: {
        presenca,
        presencaHistorico,
        equipe,
        equipeSnapshots,
        equipeModificadoEm: dados.mtc_equipe_dem2_modificado_em || null,
        terceirizados
      }
    },
    conservacao_limpeza: {
      id: 'conservacao_limpeza',
      titulo: 'Conservação e Limpeza',
      icone: '🧹',
      resumo: `${concluidasHoje} rotinas concluídas · ${Object.keys(checklistSetores).length} setores ativos`,
      chaves: ['mtc_setor_checklist', 'mtc_atividade_status', 'mtc_atividade_status_historico', 'mtc_atividades_extras', 'mtc_atividades_edicoes', 'mtc_atividades_removidas'],
      dados: {
        checklistSetores,
        statusAtividades,
        historicoAtividades,
        atividadesExtras
      }
    },
    agenda_eventos: {
      id: 'agenda_eventos',
      titulo: 'Agenda e Eventos',
      icone: '📅',
      resumo: `${agenda.length} eventos cadastrados`,
      chaves: ['mtc_agenda', 'mtc_agenda_backup_historico', 'mtc_agenda_excluidos'],
      dados: {
        agenda,
        agendaHistorico,
        excluidos: safeParse(dadosBrutos?.mtc_agenda_excluidos, [])
      }
    },
    controle_radios: {
      id: 'controle_radios',
      titulo: 'Controle de Rádios',
      icone: '📻',
      resumo: `${radios.length} rádios cadastrados · ${radiosConserto.length} em conserto`,
      chaves: ['mtc_radios', 'mtc_radios_conserto'],
      dados: {
        radios,
        radiosConserto
      }
    },
    controle_chaves: {
      id: 'controle_chaves',
      titulo: 'Controle de Chaves',
      icone: '🔑',
      resumo: `${chaves.length} chaves registradas`,
      chaves: ['mtc_chaves'],
      dados: {
        chaves
      }
    },
    estoque_materiais: {
      id: 'estoque_materiais',
      titulo: 'Depósito e Estoque',
      icone: '📦',
      resumo: `${estoque.length} itens de estoque · ${solicitacoes.length} solicitações`,
      chaves: ['mtc_estoque', 'mtc_solicitacoes_materiais'],
      dados: {
        estoque,
        solicitacoes
      }
    },
    ssmpo: {
      id: 'ssmpo',
      titulo: 'SSMPO - Segurança Operacional',
      icone: '🛡️',
      resumo: `${ssmpo.length} vistorias registradas`,
      chaves: ['mtc_ssmpo'],
      dados: {
        ssmpo
      }
    },
    contatos_ramais: {
      id: 'contatos_ramais',
      titulo: 'Contatos e Ramais',
      icone: '📞',
      resumo: `${contatos.length} contatos cadastrados`,
      chaves: ['mtc_contatos'],
      dados: {
        contatos
      }
    },
    equipamentos: {
      id: 'equipamentos',
      titulo: 'Controle de Equipamentos',
      icone: '⚙️',
      resumo: `${equipamentos.length} equipamentos cadastrados`,
      chaves: ['mtc_equipamentos'],
      dados: {
        equipamentos
      }
    }
  };
}

if (dadosNuvemLocal && dadosNuvemLocal.dados) {
  dadosNuvemLocal.kpis = gerarEstruturaKpis(dadosNuvemLocal.dados);
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
    const countAtiv = Object.values(ativ).filter(v => {
      const s = typeof v === 'string' ? v : v?.status;
      return s === 'Concluído' || s === 'Concluída';
    }).length;

    let finalDadosCompletos = Object.assign({}, dadosCompletos);

    const idxExistente = lista.findIndex(item => item.data === dia);
    if (idxExistente >= 0) {
      const presExist = safeParse(lista[idxExistente]?.dados?.dados?.mtc_presenca, {});
      const countPresExist = (presExist[dia] && Object.keys(presExist[dia]).length) || 0;
      if (countPres < countPresExist && countPresExist > 0) {
        pres[dia] = Object.assign({}, presExist[dia], pres[dia] || {});
        finalDadosCompletos.mtc_presenca = JSON.stringify(pres);
      }
      const radExist = safeParse(lista[idxExistente]?.dados?.dados?.mtc_radios, []);
      if ((!Array.isArray(rad) || rad.length === 0) && Array.isArray(radExist) && radExist.length > 0) {
        finalDadosCompletos.mtc_radios = JSON.stringify(radExist);
      }
    }

    const countPresFinal = (pres[dia] && Object.keys(pres[dia]).length) || countPres;
    const radFinal = safeParse(finalDadosCompletos.mtc_radios, rad);
    const countRadFinal = Array.isArray(radFinal) && radFinal.length > 0 ? radFinal.length : 29;

    const resumo = `Presença (${countPresFinal} registros) · Atividades (${countAtiv} concluídas) · Rádios (${countRadFinal} cadastrados) · Equipe DEM2 (${Array.isArray(eq) ? eq.length : 117} colaboradores)`;
    
    const partes = dia.split('-');
    const label = labelCustom || `Backup dia ${partes[2] || dia}/${partes[1] || ''} (${obterNomeDiaSemana(dia)})`;

    const novoItem = {
      data: dia,
      label: label,
      criadoEm: new Date().toISOString(),
      resumo: resumo,
      dados: {
        dados: finalDadosCompletos,
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
app.all(['/painel_minas_ii.json', '/api/backup-nuvem'], (req, res) => {
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

      // 1. Preservação e mesclagem inteligente e profunda de Presença (data por data e colaborador por colaborador)
      if (payload.dados.mtc_presenca || dadosNuvemLocal.dados.mtc_presenca) {
        try {
          const prExist = safeParse(dadosNuvemLocal.dados.mtc_presenca, {});
          const prNovo = safeParse(payload.dados.mtc_presenca, {});
          const todasDatas = new Set([...Object.keys(prExist), ...Object.keys(prNovo)]);
          const prMerged = {};

          todasDatas.forEach(d => {
            const diaExist = prExist[d] || {};
            const diaNovo = prNovo[d] || {};
            prMerged[d] = Object.assign({}, diaExist);

            // Mapeia por chave e normaliza v2 -> v3
            Object.keys(diaNovo).forEach(k => {
              const itemNovo = diaNovo[k];
              if (!itemNovo) return;

              let chaveAlvo = k;
              if (chaveAlvo.startsWith('equipe_v2_')) {
                chaveAlvo = chaveAlvo.replace('equipe_v2_', 'equipe_v3_');
              }
              const itemExist = prMerged[d][chaveAlvo] || diaExist[chaveAlvo] || diaExist[k];

              if (!itemExist) {
                prMerged[d][chaveAlvo] = Object.assign({}, itemNovo, { colaboradorId: itemNovo.colaboradorId || chaveAlvo });
              } else {
                const tsNovo = itemNovo.atualizadoEm ? new Date(itemNovo.atualizadoEm).getTime() : 0;
                const tsExist = itemExist.atualizadoEm ? new Date(itemExist.atualizadoEm).getTime() : 0;

                // Se o novo tem timestamp estritamente maior, atualiza
                if (tsNovo > tsExist) {
                  prMerged[d][chaveAlvo] = Object.assign({}, itemExist, itemNovo, { colaboradorId: itemNovo.colaboradorId || chaveAlvo });
                } else if (tsNovo === tsExist && tsNovo > 0) {
                  prMerged[d][chaveAlvo] = Object.assign({}, itemExist, itemNovo);
                } else if (tsExist === 0 && tsNovo > 0) {
                  prMerged[d][chaveAlvo] = Object.assign({}, itemExist, itemNovo);
                } else if (tsExist > 0 && tsNovo === 0) {
                  prMerged[d][chaveAlvo] = itemExist;
                } else {
                  const stNovo = itemNovo.status;
                  const stExist = itemExist.status;
                  if (stNovo && !stExist) {
                    prMerged[d][chaveAlvo] = Object.assign({}, itemExist, itemNovo);
                  } else {
                    prMerged[d][chaveAlvo] = itemExist;
                  }
                }
              }

              if (chaveAlvo !== k && prMerged[d][k]) {
                delete prMerged[d][k];
              }
            });
          });

          payload.dados.mtc_presenca = JSON.stringify(prMerged);
          payload.dados.mtc_presenca_backup_historico = JSON.stringify(prMerged);
        } catch(e){
          console.warn('[Server] Erro na mesclagem de presenca:', e);
        }
      }

      // 2. Preservação, mesclagem inteligente e deduplicação de Agenda (respeitando exclusões)
      const excluidosAg = new Set([
        ...safeParse(payload.dados.mtc_agenda_excluidos, []),
        ...safeParse(dadosNuvemLocal.dados.mtc_agenda_excluidos, [])
      ]);
      if (excluidosAg.size > 0) {
        payload.dados.mtc_agenda_excluidos = JSON.stringify(Array.from(excluidosAg));
      }

      if (payload.dados.mtc_agenda || dadosNuvemLocal.dados.mtc_agenda) {
        try {
          const agExist = safeParse(dadosNuvemLocal.dados.mtc_agenda, []);
          const agNovo = safeParse(payload.dados.mtc_agenda, []);
          const mapAg = new Map();
          const assinaturasVistas = new Set();

          const processarItemAgenda = (i) => {
            if (!i || !i.id) return;
            if (excluidosAg.has(i.id)) return; // ignora eventos excluídos
            const assinatura = `${i.data || ''}|${(i.hora || '').trim().toLowerCase()}|${(i.titulo || '').trim().toLowerCase()}|${(i.local || '').trim().toLowerCase()}`;
            if (assinaturasVistas.has(assinatura)) return; // descarta duplicata exata
            assinaturasVistas.add(assinatura);
            mapAg.set(i.id, i);
          };

          if (Array.isArray(agNovo)) agNovo.forEach(processarItemAgenda);
          if (Array.isArray(agExist)) agExist.forEach(processarItemAgenda);

          payload.dados.mtc_agenda = JSON.stringify(Array.from(mapAg.values()));
          payload.dados.mtc_agenda_backup_historico = payload.dados.mtc_agenda;
        } catch(e){}
      }

      // 3. Preservação e mesclagem de Rádios por ID (impede payload vazio ou seed zerar rádios)
      if (payload.dados.mtc_radios || dadosNuvemLocal.dados.mtc_radios) {
        try {
          const radExist = safeParse(dadosNuvemLocal.dados.mtc_radios, []);
          const radNovo = safeParse(payload.dados.mtc_radios, []);
          const mapRadios = new Map();

          if (Array.isArray(radExist)) {
            radExist.forEach(r => {
              if (r && (r.id || r.identificacao)) mapRadios.set(r.id || r.identificacao, r);
            });
          }

          if (Array.isArray(radNovo) && radNovo.length > 0) {
            radNovo.forEach(rNovo => {
              if (!rNovo || (!rNovo.id && !rNovo.identificacao)) return;
              const chaveR = rNovo.id || rNovo.identificacao;
              const rExist = mapRadios.get(chaveR);
              if (!rExist) {
                mapRadios.set(chaveR, rNovo);
              } else {
                const tsNovo = (rNovo.atualizadoEm || rNovo.modificadoEm) ? new Date(rNovo.atualizadoEm || rNovo.modificadoEm).getTime() : 0;
                const tsExist = (rExist.atualizadoEm || rExist.modificadoEm) ? new Date(rExist.atualizadoEm || rExist.modificadoEm).getTime() : 0;
                if (tsNovo >= tsExist) {
                  mapRadios.set(chaveR, Object.assign({}, rExist, rNovo));
                }
              }
            });
          }

          const radiosFinais = Array.from(mapRadios.values());
          if (radiosFinais.length > 0) {
            payload.dados.mtc_radios = JSON.stringify(radiosFinais);
          } else if (dadosNuvemLocal.dados.mtc_radios) {
            payload.dados.mtc_radios = dadosNuvemLocal.dados.mtc_radios;
          }
        } catch(e){}
      }

      // 3.1 Preservação de Consertos de Rádios por ID
      if (payload.dados.mtc_radios_conserto || dadosNuvemLocal.dados.mtc_radios_conserto) {
        try {
          const cExist = safeParse(dadosNuvemLocal.dados.mtc_radios_conserto, []);
          const cNovo = safeParse(payload.dados.mtc_radios_conserto, []);
          const mapConserto = new Map();
          if (Array.isArray(cExist)) cExist.forEach(c => { if(c && c.id) mapConserto.set(c.id, c); });
          if (Array.isArray(cNovo)) cNovo.forEach(c => {
            if(!c || !c.id) return;
            const ex = mapConserto.get(c.id);
            mapConserto.set(c.id, ex ? Object.assign({}, ex, c) : c);
          });
          payload.dados.mtc_radios_conserto = JSON.stringify(Array.from(mapConserto.values()));
        } catch(e){}
      }

      // 3.2 Preservação e mesclagem de Estoque por ID/Código
      if (payload.dados.mtc_estoque || dadosNuvemLocal.dados.mtc_estoque) {
        try {
          const estExist = safeParse(dadosNuvemLocal.dados.mtc_estoque, []);
          const estNovo = safeParse(payload.dados.mtc_estoque, []);
          const mapEstoque = new Map();

          if (Array.isArray(estExist)) {
            estExist.forEach(it => {
              const k = it.id || it.codigo || it.item;
              if (k) mapEstoque.set(k, it);
            });
          }

          if (Array.isArray(estNovo) && estNovo.length > 0) {
            estNovo.forEach(itNovo => {
              const k = itNovo.id || itNovo.codigo || itNovo.item;
              if (!k) return;
              const itExist = mapEstoque.get(k);
              if (!itExist) {
                mapEstoque.set(k, itNovo);
              } else {
                const tsNovo = itNovo.atualizadoEm ? new Date(itNovo.atualizadoEm).getTime() : 0;
                const tsExist = itExist.atualizadoEm ? new Date(itExist.atualizadoEm).getTime() : 0;
                if (tsNovo >= tsExist) {
                  mapEstoque.set(k, Object.assign({}, itExist, itNovo));
                }
              }
            });
          }

          const estoqueFinal = Array.from(mapEstoque.values());
          if (estoqueFinal.length > 0) {
            payload.dados.mtc_estoque = JSON.stringify(estoqueFinal);
          } else if (dadosNuvemLocal.dados.mtc_estoque) {
            payload.dados.mtc_estoque = dadosNuvemLocal.dados.mtc_estoque;
          }
        } catch(e){}
      }

      // 3.3 Preservação e mesclagem de Chaves por Número/ID
      if (payload.dados.mtc_chaves || dadosNuvemLocal.dados.mtc_chaves) {
        try {
          const chExist = safeParse(dadosNuvemLocal.dados.mtc_chaves, []);
          const chNovo = safeParse(payload.dados.mtc_chaves, []);
          const mapChaves = new Map();

          if (Array.isArray(chExist)) {
            chExist.forEach(ch => {
              const k = ch.id || ch.numero;
              if (k) mapChaves.set(k, ch);
            });
          }

          if (Array.isArray(chNovo) && chNovo.length > 0) {
            chNovo.forEach(chNovoItem => {
              const k = chNovoItem.id || chNovoItem.numero;
              if (!k) return;
              const chExistItem = mapChaves.get(k);
              if (!chExistItem) {
                mapChaves.set(k, chNovoItem);
              } else {
                const tsNovo = chNovoItem.atualizadoEm ? new Date(chNovoItem.atualizadoEm).getTime() : 0;
                const tsExist = chExistItem.atualizadoEm ? new Date(chExistItem.atualizadoEm).getTime() : 0;
                if (tsNovo >= tsExist) {
                  mapChaves.set(k, Object.assign({}, chExistItem, chNovoItem));
                }
              }
            });
          }

          const chavesFinais = Array.from(mapChaves.values());
          if (chavesFinais.length > 0) {
            payload.dados.mtc_chaves = JSON.stringify(chavesFinais);
          } else if (dadosNuvemLocal.dados.mtc_chaves) {
            payload.dados.mtc_chaves = dadosNuvemLocal.dados.mtc_chaves;
          }
        } catch(e){}
      }

      // 3.4 Preservação e mesclagem de Solicitações de Materiais
      if (payload.dados.mtc_solicitacoes_materiais || dadosNuvemLocal.dados.mtc_solicitacoes_materiais) {
        try {
          const sExist = safeParse(dadosNuvemLocal.dados.mtc_solicitacoes_materiais, []);
          const sNovo = safeParse(payload.dados.mtc_solicitacoes_materiais, []);
          const mapSol = new Map();
          if (Array.isArray(sExist)) sExist.forEach(s => { if(s && s.id) mapSol.set(s.id, s); });
          if (Array.isArray(sNovo)) sNovo.forEach(s => { if(s && s.id) mapSol.set(s.id, s); });
          payload.dados.mtc_solicitacoes_materiais = JSON.stringify(Array.from(mapSol.values()));
        } catch(e){}
      }

      // 3.5 Preservação de Terceirizados
      if (payload.dados.mtc_terceirizados || dadosNuvemLocal.dados.mtc_terceirizados) {
        try {
          const tExist = safeParse(dadosNuvemLocal.dados.mtc_terceirizados, []);
          const tNovo = safeParse(payload.dados.mtc_terceirizados, []);
          const mapT = new Map();
          if (Array.isArray(tExist)) tExist.forEach(t => { if(t && (t.id || t.nome)) mapT.set(t.id || t.nome, t); });
          if (Array.isArray(tNovo)) tNovo.forEach(t => { if(t && (t.id || t.nome)) mapT.set(t.id || t.nome, t); });
          payload.dados.mtc_terceirizados = JSON.stringify(Array.from(mapT.values()));
        } catch(e){}
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

      // 4.1 Preservação e mesclagem inteligente de Atividades Semanais (chave a chave por timestamp)
      if (payload.dados.mtc_atividade_status && dadosNuvemLocal.dados.mtc_atividade_status) {
        try {
          const ativNovo = safeParse(payload.dados.mtc_atividade_status, {});
          const ativExist = safeParse(dadosNuvemLocal.dados.mtc_atividade_status, {});
          if (Object.keys(ativNovo).length === 0 && Object.keys(ativExist).length > 0) {
            payload.dados.mtc_atividade_status = dadosNuvemLocal.dados.mtc_atividade_status;
          } else {
            const ativMerged = Object.assign({}, ativExist);
            Object.keys(ativNovo).forEach(idAtiv => {
              const novoItem = ativNovo[idAtiv];
              const existItem = ativExist[idAtiv];
              if (!existItem) {
                ativMerged[idAtiv] = novoItem;
              } else {
                const dataNovo = (novoItem && (novoItem.atualizadoEm || novoItem.data)) ? new Date(novoItem.atualizadoEm || novoItem.data).getTime() : 0;
                const dataExist = (existItem && (existItem.atualizadoEm || existItem.data)) ? new Date(existItem.atualizadoEm || existItem.data).getTime() : 0;
                if (dataNovo >= dataExist) {
                  ativMerged[idAtiv] = novoItem;
                }
              }
            });
            payload.dados.mtc_atividade_status = JSON.stringify(ativMerged);
          }
        } catch(e){}
      } else if (!payload.dados.mtc_atividade_status && dadosNuvemLocal.dados.mtc_atividade_status) {
        payload.dados.mtc_atividade_status = dadosNuvemLocal.dados.mtc_atividade_status;
      }

      // 4.2 Preservação e mesclagem inteligente de Checklist de Setores
      if (payload.dados.mtc_setor_checklist && dadosNuvemLocal.dados.mtc_setor_checklist) {
        try {
          const setNovo = safeParse(payload.dados.mtc_setor_checklist, {});
          const setExist = safeParse(dadosNuvemLocal.dados.mtc_setor_checklist, {});
          if (Object.keys(setNovo).length === 0 && Object.keys(setExist).length > 0) {
            payload.dados.mtc_setor_checklist = dadosNuvemLocal.dados.mtc_setor_checklist;
          } else {
            const setMerged = Object.assign({}, setExist);
            Object.keys(setNovo).forEach(setor => {
              setMerged[setor] = Object.assign({}, setMerged[setor] || {});
              const horasNovo = setNovo[setor] || {};
              Object.keys(horasNovo).forEach(hora => {
                const nItem = horasNovo[hora];
                const eItem = setMerged[setor] && setMerged[setor][hora];
                if (!eItem) {
                  setMerged[setor][hora] = nItem;
                } else {
                  const dNovo = (nItem && (nItem.atualizadoEm || nItem.data)) ? new Date(nItem.atualizadoEm || nItem.data).getTime() : 0;
                  const dExist = (eItem && (eItem.atualizadoEm || eItem.data)) ? new Date(eItem.atualizadoEm || eItem.data).getTime() : 0;
                  if (dNovo >= dExist) {
                    setMerged[setor][hora] = Object.assign({}, eItem, nItem);
                  }
                }
              });
            });
            payload.dados.mtc_setor_checklist = JSON.stringify(setMerged);
          }
        } catch(e){}
      } else if (!payload.dados.mtc_setor_checklist && dadosNuvemLocal.dados.mtc_setor_checklist) {
        payload.dados.mtc_setor_checklist = dadosNuvemLocal.dados.mtc_setor_checklist;
      }

      // 5. Preservação inteligente de Equipe DEM2 por colaborador e ID
      if (payload.dados.mtc_equipe_dem2 || dadosNuvemLocal.dados.mtc_equipe_dem2) {
        try {
          const eqExist = safeParse(dadosNuvemLocal.dados.mtc_equipe_dem2, []);
          const eqNovo = safeParse(payload.dados.mtc_equipe_dem2, []);
          if (Array.isArray(eqNovo) && eqNovo.length === 0 && Array.isArray(eqExist) && eqExist.length > 0) {
            payload.dados.mtc_equipe_dem2 = dadosNuvemLocal.dados.mtc_equipe_dem2;
          } else if (Array.isArray(eqNovo) && Array.isArray(eqExist) && eqExist.length > 0) {
            const mapEq = new Map();
            eqExist.forEach(c => {
              if (c && (c.id || c.matricula)) mapEq.set(c.id || c.matricula, c);
            });
            eqNovo.forEach(cNovo => {
              if (!cNovo || (!cNovo.id && !cNovo.matricula)) return;
              const chaveC = cNovo.id || cNovo.matricula;
              const cExist = mapEq.get(chaveC);
              if (!cExist) {
                mapEq.set(chaveC, cNovo);
              } else {
                mapEq.set(chaveC, Object.assign({}, cExist, cNovo));
              }
            });
            payload.dados.mtc_equipe_dem2 = JSON.stringify(Array.from(mapEq.values()));
          }
        } catch(e){}
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

    dadosNuvemLocal.kpis = gerarEstruturaKpis(dadosNuvemLocal.dados);

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

    dadosNuvemLocal.kpis = gerarEstruturaKpis(dadosNuvemLocal.dados);
    console.log(`[Backup Nuvem] Dia ${diaAlvo} restaurado com sucesso e propagado via SSE.`);
    return res.json({
      ok: true,
      dia: diaAlvo,
      label: snapshot.label,
      resumo: snapshot.resumo,
      dados: dadosNuvemLocal.dados,
      kpis: dadosNuvemLocal.kpis,
      enviadoEm: dadosNuvemLocal.enviadoEm
    });
  } catch(err) {
    console.error('Erro ao restaurar dia:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Endpoint: Retorna os backups estruturados e separados por KPIs operacionais
app.get('/api/nuvem/kpis', (req, res) => {
  if (!dadosNuvemLocal || !dadosNuvemLocal.dados) {
    return res.json({ ok: true, kpis: {}, enviadoEm: '' });
  }
  const kpis = dadosNuvemLocal.kpis || gerarEstruturaKpis(dadosNuvemLocal.dados);
  res.json({ ok: true, kpis, enviadoEm: dadosNuvemLocal.enviadoEm || new Date().toISOString() });
});

// Endpoint: Retorna um KPI específico
app.get('/api/nuvem/kpis/:id', (req, res) => {
  const kpis = (dadosNuvemLocal && dadosNuvemLocal.kpis) || gerarEstruturaKpis(dadosNuvemLocal?.dados);
  const kpi = kpis[req.params.id];
  if (!kpi) {
    return res.status(404).json({ error: `KPI '${req.params.id}' não encontrado.` });
  }
  res.json({ ok: true, kpi, enviadoEm: dadosNuvemLocal?.enviadoEm || new Date().toISOString() });
});

// Endpoint: Restaura na nuvem apenas os dados de um KPI específico (sem afetar os outros módulos)
app.post('/api/nuvem/restaurar-kpi', (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e){}
  }
  const kpiId = body && body.kpiId;
  const diaAlvo = body && body.dia;
  if (!kpiId) {
    return res.status(400).json({ error: 'Identificador do KPI obrigatório (ex: conservacao_limpeza, presenca_equipe)' });
  }

  try {
    let fonteDados = null;
    if (diaAlvo && fs.existsSync(HISTORICO_DIAS_FILE)) {
      const lista = JSON.parse(fs.readFileSync(HISTORICO_DIAS_FILE, 'utf8') || '[]');
      const snap = lista.find(item => item.data === diaAlvo);
      if (snap && snap.dados && snap.dados.dados) {
        fonteDados = snap.dados.dados;
      }
    }
    if (!fonteDados && fs.existsSync(HISTORICO_DIAS_FILE)) {
      const lista = JSON.parse(fs.readFileSync(HISTORICO_DIAS_FILE, 'utf8') || '[]');
      if (lista.length > 0 && lista[0].dados && lista[0].dados.dados) {
        fonteDados = lista[0].dados.dados;
      }
    }
    if (!fonteDados && dadosNuvemLocal) {
      fonteDados = dadosNuvemLocal.dados;
    }

    const mapaKpis = gerarEstruturaKpis(fonteDados);
    const kpiAlvo = mapaKpis[kpiId];
    if (!kpiAlvo) {
      return res.status(404).json({ error: `KPI '${kpiId}' não reconhecido.` });
    }

    if (!dadosNuvemLocal) dadosNuvemLocal = { dados: {}, enviadoEm: '' };
    if (!dadosNuvemLocal.dados) dadosNuvemLocal.dados = {};

    const chavesRestauradas = {};
    kpiAlvo.chaves.forEach(ch => {
      if (fonteDados && fonteDados[ch] !== undefined) {
        dadosNuvemLocal.dados[ch] = fonteDados[ch];
        chavesRestauradas[ch] = fonteDados[ch];
      }
    });

    dadosNuvemLocal.enviadoEm = new Date().toISOString();
    dadosNuvemLocal.kpis = gerarEstruturaKpis(dadosNuvemLocal.dados);

    fs.writeFileSync(DATA_FILE, JSON.stringify(dadosNuvemLocal, null, 2), 'utf8');

    clientesSse.forEach(c => {
      try {
        c.write(`event: put\ndata: ${JSON.stringify({ path: '/', data: dadosNuvemLocal })}\n\n`);
      } catch(e){}
    });

    return res.json({
      ok: true,
      kpiId,
      titulo: kpiAlvo.titulo,
      chaves: kpiAlvo.chaves,
      dadosRestaurados: chavesRestauradas,
      enviadoEm: dadosNuvemLocal.enviadoEm
    });
  } catch(err) {
    console.error('Erro ao restaurar KPI:', err);
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
