const express = require('express');
const rateLimit = require('express-rate-limit');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

const sttLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

function isEnabled() {
  return !!(process.env.STT_API_KEY && String(process.env.STT_API_KEY).trim());
}

router.get('/status', authRequired, (req, res) => {
  res.json({
    enabled: isEnabled(),
    provider: process.env.STT_PROVIDER || (isEnabled() ? 'openai-compatible' : null),
    mode: 'mediarecorder',
  });
});

router.post('/transcribe', authRequired, sttLimiter, express.json({ limit: '12mb' }), async (req, res) => {
  try {
    if (!isEnabled()) {
      return res.status(501).json({ error: 'STT não configurado no servidor. Use a Entrada Manual.', fallback: true });
    }

    let { audio, mimeType } = req.body || {};
    if (!audio || typeof audio !== 'string') {
      return res.status(400).json({ error: 'Áudio ausente', fallback: true });
    }

    // aceita data URL
    const m = audio.match(/^data:([^;]+);base64,(.+)$/);
    if (m) { mimeType = mimeType || m[1]; audio = m[2]; }
    mimeType = mimeType || 'audio/webm';

    const buf = Buffer.from(audio, 'base64');
    if (!buf || buf.length < 1024) {
      return res.status(400).json({ error: 'Áudio muito curto ou inválido', fallback: true });
    }
    if (buf.length > 10 * 1024 * 1024) {
      return res.status(413).json({ error: 'Áudio muito grande', fallback: true });
    }

    const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a' : mimeType.includes('wav') ? 'wav' : 'webm';
    const blob = new Blob([buf], { type: mimeType });
    const form = new FormData();
    form.append('file', blob, `audio.${ext}`);
    form.append('model', process.env.STT_MODEL || 'whisper-1');
    form.append('language', process.env.STT_LANGUAGE || 'pt');
    form.append('response_format', 'json');

    const url = process.env.STT_API_URL || 'https://api.openai.com/v1/audio/transcriptions';
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.STT_API_KEY}`,
      },
      body: form,
    });

    const textBody = await resp.text();
    let data = null;
    try { data = textBody ? JSON.parse(textBody) : null; } catch (e) { data = { raw: textBody }; }

    if (!resp.ok) {
      console.error('[STT] erro', resp.status, data);
      return res.status(502).json({ error: 'Falha na transcrição', detail: (data && (data.error?.message || data.error || data.message)) || resp.status, fallback: true });
    }

    const transcript = (data && (data.text || data.transcript || data.result)) ? String(data.text || data.transcript || data.result).trim() : '';
    if (!transcript) {
      return res.json({ transcript: '', empty: true, fallback: true });
    }
    return res.json({ transcript });
  } catch (e) {
    console.error('[STT] exception', e);
    return res.status(500).json({ error: 'Erro interno na transcrição', fallback: true });
  }
});

module.exports = router;
