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
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

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

// Claude
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

// Crear preferencia de pago en Mercado Pago
app.post('/api/crear-pago', async (req, res) => {
  try {
    const { mesa, items } = req.body;
    if (!mesa || !items || items.length === 0) {
      return res.status(400).json({ error: 'Faltan datos' });
    }

    // Guardar pedido pendiente de pago
    const pedidoId = pedidoCounter++;
    const pedido = {
      id: pedidoId,
      mesa,
      items,
      hora: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      estado: 'esperando_pago',
      timestamp: Date.now()
    };
    pedidos.push(pedido);

    // Armar items para MP
    const mpItems = items.map(item => ({
      id: item.name,
      title: item.name,
      quantity: item.qty,
      unit_price: item.price,
      currency_id: 'ARS'
    }));

    const total = items.reduce((acc, i) => acc + i.price * i.qty, 0);

    const preference = {
      items: mpItems,
      external_reference: String(pedidoId),
      back_urls: {
        success: 'https://sebastianmcantor-creator.github.io/vitrina-app/pago-ok.html?mesa=' + mesa,
        failure: 'https://sebastianmcantor-creator.github.io/vitrina-app/menu.html?mesa=' + mesa + '&pago=error',
        pending: 'https://sebastianmcantor-creator.github.io/vitrina-app/pago-ok.html?mesa=' + mesa
      },
      auto_return: 'approved',
      notification_url: 'https://proud-illumination-production-ed01.up.railway.app/api/mp-webhook',
      statement_descriptor: 'VITRINA',
      metadata: { mesa, pedido_id: pedidoId }
    };

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + MP_ACCESS_TOKEN
      },
      body: JSON.stringify(preference)
    });

    if (!mpRes.ok) {
      const err = await mpRes.text();
      throw new Error('MP error: ' + err);
    }

    const mpData = await mpRes.json();
    res.json({ init_point: mpData.sandbox_init_point, pedido_id: pedidoId });

  } catch (error) {
    console.error('Error crear-pago:', error);
    res.status(500).json({ error: error.message });
  }
});

// Webhook de Mercado Pago — notifica cuando el pago fue aprobado
app.post('/api/mp-webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const { type, data } = req.body;
    if (type !== 'payment') return;

    const paymentRes = await fetch('https://api.mercadopago.com/v1/payments/' + data.id, {
      headers: { 'Authorization': 'Bearer ' + MP_ACCESS_TOKEN }
    });
    const payment = await paymentRes.json();

    if (payment.status === 'approved') {
      const pedidoId = Number(payment.external_reference);
      const pedido = pedidos.find(p => p.id === pedidoId);
      if (pedido) {
        pedido.estado = 'pendiente';
        broadcast({ type: 'nuevo_pedido', pedido });
      }
    }
  } catch (e) {
    console.error('Webhook error:', e);
  }
});

// Recibir pedido directo (sin pago, para pruebas)
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

// Actualizar estado
app.post('/api/pedido/:id/estado', (req, res) => {
  const id = Number(req.params.id);
  const { estado } = req.body;
  const pedido = pedidos.find(p => p.id === id);
  if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
  pedido.estado = estado;
  broadcast({ type: 'actualizar_pedido', pedido });
  res.json({ ok: true, pedido });
});

app.get('/api/pedidos', (req, res) => res.json(pedidos));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Vitrina server corriendo en puerto ${PORT}`);
});
