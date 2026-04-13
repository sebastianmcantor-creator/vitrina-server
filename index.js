const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

async function callAnthropic(body) {
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
  return response.json();
}

app.post('/api/claude', async (req, res) => {
  try {
    const { messages, system, tools, model, max_tokens } = req.body;

    let body = {
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: max_tokens || 4000,
      messages: [...messages],
    };
    if (system) body.system = system;
    if (tools) body.tools = tools;

    // Loop hasta obtener end_turn (máximo 5 rondas)
    let data;
    for (let i = 0; i < 5; i++) {
      data = await callAnthropic(body);

      if (data.stop_reason !== 'tool_use') break;

      // Hay tool_use — agregar respuesta del asistente y resultados de tools
      const assistantMsg = { role: 'assistant', content: data.content };
      const toolResults = data.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({
          type: 'tool_result',
          tool_use_id: b.id,
          content: 'Búsqueda completada. Continuá con el análisis y devolvé el JSON.'
        }));

      body.messages = [
        ...body.messages,
        assistantMsg,
        { role: 'user', content: toolResults }
      ];
    }

    res.json(data);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Vitrina server corriendo en puerto ${PORT}`);
});
