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

app.all('/painel_minas_ii.json', (req, res) => {
  if (req.method === 'GET') {
    if (req.headers.accept && req.headers.accept.includes('text/event-stream')) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
      res.write(`event: put\ndata: ${JSON.stringify({ path: '/', data: dadosNuvemLocal || {} })}\n\n`);
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
