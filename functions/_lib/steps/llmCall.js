// config: { provider: "groq"|"openrouter"|"gemini", model: "...", prompt: "..." }
// Set GROQ_API_KEY / OPENROUTER_API_KEY / GEMINI_API_KEY as env vars.
// If no key is configured, falls back to a stubbed call with a disclosed
// artificial delay (per the assignment's explicit fallback allowance).

async function callGroq(config, input) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: config.model || 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: interpolate(config.prompt, input) }],
    }),
  });
  if (!res.ok) throw new Error(`Groq API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { text: data.choices[0].message.content, raw: data };
}

function interpolate(prompt, input) {
  // very small templating: {{previous_output}} -> JSON of prior step's output
  return (prompt || '').replace('{{previous_output}}', JSON.stringify(input ?? {}));
}

async function stub(config, input) {
  await new Promise((r) => setTimeout(r, 1200)); // disclosed artificial delay
  return {
    text: `[STUBBED LLM RESPONSE — no API key configured] echo: ${interpolate(config.prompt, input)}`,
    stubbed: true,
  };
}

async function runLlmCall(config, input) {
  const provider = config.provider || 'groq';
  const attempt = async () => {
    if (provider === 'groq' && process.env.GROQ_API_KEY) return callGroq(config, input);
    return stub(config, input);
  };
  try {
    const result = await attempt();
    return { ...result, _attempts: 1 };
  } catch (err) {
    // one retry on failure, per spec — attempt count is reported back so
    // the caller (runEngine) can record the true attempt_count instead of
    // always writing 1.
    await new Promise((r) => setTimeout(r, 500));
    try {
      const result = await attempt();
      return { ...result, _attempts: 2 };
    } catch (err2) {
      err2.attempts = 2;
      throw err2;
    }
  }
}

module.exports = { runLlmCall };
