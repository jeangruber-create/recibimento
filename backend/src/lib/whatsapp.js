// Envio de texto por WhatsApp via API (Evolution por padrão; Cloud API opcional).
// Nenhuma credencial é devolvida ao front — apenas o estado "configurado".

const config = require('../config');

function providerName() {
  return config.whatsapp.provider === 'cloud' ? 'cloud' : 'evolution';
}

function isConfigured() {
  const w = config.whatsapp;
  if (providerName() === 'cloud') {
    return Boolean(w.cloudToken && w.cloudPhoneNumberId);
  }
  return Boolean(w.apiUrl && w.apiKey && w.instance);
}

function publicConfig() {
  return {
    configured: isConfigured(),
    provider: providerName(),
    number: config.whatsapp.number || null,
  };
}

function trimText(value, max = 300) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function extractExternalId(data) {
  if (!data || typeof data !== 'object') return null;
  return (
    data.key?.id ||
    data.id ||
    data.messageId ||
    data.messages?.[0]?.id ||
    null
  );
}

function errorMessage(status, body) {
  let parsed = null;
  if (body) {
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = null;
    }
  }
  const msg =
    parsed?.message ||
    parsed?.error?.message ||
    (typeof parsed === 'string' ? parsed : '') ||
    (body ? trimText(body) : '') ||
    'falha desconhecida';
  return `WhatsApp ${status}: ${trimText(msg)}`;
}

async function parseBody(res) {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: trimText(text) };
  }
}

async function postJson(url, headers, payload) {
  if (typeof fetch !== 'function') {
    throw new Error('Este runtime não possui fetch para chamar a API de WhatsApp');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, config.whatsapp.timeoutMs || 15000));
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await parseBody(res);
    if (!res.ok) throw new Error(errorMessage(res.status, JSON.stringify(data)));
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Tempo limite ao chamar a API de WhatsApp');
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

async function sendText({ phone, message }) {
  if (!isConfigured()) throw new Error('API de WhatsApp não configurada no servidor');
  if (!phone || !message) throw new Error('Telefone ou mensagem ausente');

  if (providerName() === 'cloud') {
    const w = config.whatsapp;
    const url = `https://graph.facebook.com/${encodeURIComponent(w.apiVersion)}/${encodeURIComponent(w.cloudPhoneNumberId)}/messages`;
    const data = await postJson(
      url,
      { Authorization: `Bearer ${w.cloudToken}` },
      {
        messaging_product: 'whatsapp',
        to: String(phone),
        type: 'text',
        text: { body: String(message) },
      }
    );
    return { id: extractExternalId(data), provider: 'cloud' };
  }

  const w = config.whatsapp;
  const base = String(w.apiUrl).replace(/\/+$/, '');
  const url = `${base}/message/sendText/${encodeURIComponent(w.instance)}`;
  const data = await postJson(
    url,
    { apikey: w.apiKey },
    { number: String(phone), text: String(message) }
  );
  return { id: extractExternalId(data), provider: 'evolution' };
}

module.exports = { providerName, isConfigured, publicConfig, sendText };
