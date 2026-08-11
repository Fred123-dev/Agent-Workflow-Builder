// config: { url: "...", method: "GET"|"POST"|..., headers: {...}, body: {...} }
async function attempt(config, input) {
  const res = await fetch(config.url, {
    method: config.method || 'GET',
    headers: { 'content-type': 'application/json', ...(config.headers || {}) },
    body: config.method && config.method !== 'GET' ? JSON.stringify(config.body ?? input ?? {}) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`http_request failed: ${res.status} ${text}`);
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

async function runHttpRequest(config, input) {
  try {
    const result = await attempt(config, input);
    return { ...result, _attempts: 1 };
  } catch (err) {
    await new Promise((r) => setTimeout(r, 500)); // one retry on failure
    try {
      const result = await attempt(config, input);
      return { ...result, _attempts: 2 };
    } catch (err2) {
      err2.attempts = 2;
      throw err2;
    }
  }
}

module.exports = { runHttpRequest };
