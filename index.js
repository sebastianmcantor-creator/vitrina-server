const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

let pedidos = [];
let pedidoCounter = 1;

wss.on('connection', (ws) => {
  console.log('Cocina conectada');
  ws.send(JSON.stringify({ type: 'init', pedidos }));
  ws.on('close', () => console.log('Cocina desconectada'));
});

function broadcast(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(JSON.stringify(data));
  });
}

app.post('/api/claude', async (req, res) => {
  try {
    const { messages, system, model, max_tokens } = req.body;
    const body = {
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: max_tokens || 4000,
      messages,
    };
    if (system) body.system = system;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error('Anthropic error ' + response.status + ': ' + err);
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/pedido', (req, res) => {
  const { mesa, items } = req.body;
  if (!mesa || !items || items.length === 0) {
    return res.status(400).json({ error: 'Faltan datos del pedido' });
  }
  const pedido = {
    id: pedidoCounter++,
    mesa,
    items,
    hora: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
    estado: 'pendiente',
    timestamp: Date.now()
  };
  pedidos.push(pedido);
  broadcast({ type: 'nuevo_pedido', pedido });
  res.json({ ok: true, pedido });
});

app.post('/api/pedido/:id/estado', (req, res) => {
  const id = Number(req.params.id);
  const { estado } = req.body;
  const pedido = pedidos.find(p => p.id === id);
  if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
  pedido.estado = estado;
  broadcast({ type: 'actualizar_pedido', pedido });
  res.json({ ok: true, pedido });
});

app.get('/api/pedidos', (req, res) => {
  res.json(pedidos);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Vitrina server corriendo en puerto ${PORT}`);
});
