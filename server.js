import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, 'painel_minas_ii_dados.json');

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

let clientesSse = [];
let presencaPerfis = {};

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
    dadosNuvemLocal = payload;
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(dadosNuvemLocal, null, 2), 'utf8');
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
