const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3026;

// ─── Paths ────────────────────────────────────────────────────────────────────
const DATA_FILE  = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');

[PUBLIC_DIR, UPLOADS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ─── Data Layer ───────────────────────────────────────────────────────────────
let db = { events: [], routines: [], media: [], settings: { pushoverToken: '', pushoverUser: '' } };

function loadDb() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      db = {
        events:   raw.events   || [],
        routines: raw.routines || [],
        media:    raw.media    || [],
        settings: raw.settings || { pushoverToken: '', pushoverUser: '' }
      };
    }
  } catch (e) { console.error('Load error:', e.message); }
}

function saveDb() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }
  catch (e) { console.error('Save error:', e.message); }
}

loadDb();

const notifiedSet = new Set(db.routines.filter(r => r.notificationSent).map(r => r.id));

// ─── Multer ───────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname).toLowerCase())
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
  fileFilter: (req, file, cb) => {
    if (/\.(jpe?g|png|gif|webp|mp4|mov|avi|webm|mkv)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Unsupported file type'));
  }
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(PUBLIC_DIR));
// Log every API request with body size
app.use('/api', (req, _res, next) => {
  console.log(`[API] ${req.method} ${req.path}`, Object.keys(req.body||{}).length ? req.body : '');
  next();
});

// ─── Helper: find event by UUID token OR custom slug ─────────────────────────
function findEventByShare(key) {
  return db.events.find(e => e.shareToken === key || (e.shareSlug && e.shareSlug === key));
}

// ─── API: Events ──────────────────────────────────────────────────────────────
app.get('/api/events', (req, res) => res.json(db.events));

app.post('/api/events', (req, res) => {
  const event = {
    id: uuidv4(), shareToken: uuidv4(), shareSlug: '',
    createdAt: new Date().toISOString(),
    name:        req.body.name        || 'New Competition',
    date:        req.body.date        || '',
    venue:       req.body.venue       || '',
    description: req.body.description || ''
  };
  db.events.push(event);
  saveDb();
  io.emit('data-updated', { type: 'event', action: 'create' });
  res.json(event);
});

app.put('/api/events/:id', (req, res) => {
  const i = db.events.findIndex(e => e.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Not found' });

  // Validate & sanitize custom slug
  if (req.body.shareSlug !== undefined) {
    const slug = req.body.shareSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (slug && db.events.some(e => e.id !== req.params.id && (e.shareSlug === slug || e.shareToken === slug))) {
      return res.status(409).json({ error: 'That slug is already taken' });
    }
    req.body.shareSlug = slug;
  }

  db.events[i] = { ...db.events[i], ...req.body, id: req.params.id, shareToken: db.events[i].shareToken };
  saveDb();
  io.emit('data-updated', { type: 'event', action: 'update' });
  res.json(db.events[i]);
});

app.delete('/api/events/:id', (req, res) => {
  db.routines.filter(r => r.eventId === req.params.id).forEach(r => notifiedSet.delete(r.id));
  db.events   = db.events.filter(e => e.id !== req.params.id);
  db.routines = db.routines.filter(r => r.eventId !== req.params.id);
  db.media    = db.media.filter(m => m.eventId !== req.params.id);
  saveDb();
  io.emit('data-updated', { type: 'event', action: 'delete' });
  res.json({ ok: true });
});

// ─── API: Share — public read ─────────────────────────────────────────────────
app.get('/api/share/:key', (req, res) => {
  const event = findEventByShare(req.params.key);
  if (!event) return res.status(404).json({ error: 'Not found' });
  const routines = db.routines.filter(r => r.eventId === event.id)
    .sort((a, b) => new Date(a.scheduledTime || 0) - new Date(b.scheduledTime || 0));
  const media = db.media.filter(m => m.eventId === event.id);
  res.json({ event, routines, media });
});

// ─── API: Share — public upload ───────────────────────────────────────────────
app.post('/api/share/:key/media', upload.single('file'), (req, res) => {
  const event = findEventByShare(req.params.key);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  const item = {
    id: uuidv4(), eventId: event.id,
    routineId:    req.body.routineId    || null,
    filename:     req.file.filename,
    originalName: req.file.originalname,
    size:         req.file.size,
    type:         req.file.mimetype.startsWith('video/') ? 'video' : 'image',
    caption:      req.body.caption      || '',
    uploadedBy:   req.body.uploaderName || 'Guest',
    uploadedAt:   new Date().toISOString()
  };
  db.media.push(item);
  saveDb();
  io.emit('data-updated', { type: 'media', action: 'create' });
  res.json(item);
});

// ─── API: Share — "I'm seated" ping ──────────────────────────────────────────
app.post('/api/share/:key/seated', async (req, res) => {
  const event = findEventByShare(req.params.key);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const senderName = (req.body.senderName || 'Someone').trim();
  const now = Date.now();
  const next = db.routines
    .filter(r => r.eventId === event.id && r.scheduledTime && new Date(r.scheduledTime) > now)
    .sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime))[0];

  const nextStr = next
    ? ` · Next up: ${next.dancerName} at ${new Date(next.scheduledTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
    : '';

  if (db.settings.pushoverToken && db.settings.pushoverUser) {
    try {
      await axios.post('https://api.pushover.net/1/messages.json', {
        token:    db.settings.pushoverToken,
        user:     db.settings.pushoverUser,
        title:    `🪑 ${senderName} is seated`,
        message:  `${senderName} just sat down at ${event.name}${nextStr}`,
        priority: 1,
        sound:    'classical'
      });
    } catch (e) { console.error('[Pushover] Seated:', e.response?.data || e.message); }
  }

  io.emit('seated-alert', { senderName, eventName: event.name, nextRoutine: next || null });
  res.json({ ok: true });
});

// ─── API: Routines ────────────────────────────────────────────────────────────
app.get('/api/events/:eid/routines', (req, res) => {
  res.json(db.routines.filter(r => r.eventId === req.params.eid)
    .sort((a, b) => new Date(a.scheduledTime || 0) - new Date(b.scheduledTime || 0)));
});

app.post('/api/events/:eid/routines', (req, res) => {
  const routine = {
    id: uuidv4(), eventId: req.params.eid,
    notificationSent: false, createdAt: new Date().toISOString(),
    dancerName:    req.body.dancerName    || '',
    studio:        req.body.studio        || '',
    age:           req.body.age           || '',
    danceStyle:    req.body.danceStyle    || '',
    scheduledTime: req.body.scheduledTime || '',
    stage:         req.body.stage         || '',
    orderNumber:   req.body.orderNumber   || '',
    notes:         req.body.notes         || '',
    awards:        Array.isArray(req.body.awards) ? req.body.awards : []
  };
  db.routines.push(routine);
  saveDb();
  io.emit('data-updated', { type: 'routine', action: 'create' });
  res.json(routine);
});

app.put('/api/routines/:id', (req, res) => {
  const i = db.routines.findIndex(r => r.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Not found' });
  const prev = db.routines[i];
  db.routines[i] = { ...prev, ...req.body, id: req.params.id, eventId: prev.eventId };
  if (req.body.scheduledTime && req.body.scheduledTime !== prev.scheduledTime) {
    db.routines[i].notificationSent = false;
    notifiedSet.delete(req.params.id);
  }
  saveDb();
  io.emit('data-updated', { type: 'routine', action: 'update' });
  res.json(db.routines[i]);
});

app.delete('/api/routines/:id', (req, res) => {
  notifiedSet.delete(req.params.id);
  db.routines = db.routines.filter(r => r.id !== req.params.id);
  saveDb();
  io.emit('data-updated', { type: 'routine', action: 'delete' });
  res.json({ ok: true });
});

// ─── API: Bulk schedule shift ─────────────────────────────────────────────────
// body: { minutes: 15 | -15 | 60 | -60 }
app.post('/api/events/:id/shift', (req, res) => {
  const minutes = parseInt(req.body.minutes, 10);
  console.log(`[shift] event=${req.params.id} minutes=${minutes} body=`, req.body);
  if (isNaN(minutes) || minutes === 0 || ![-60, -15, 15, 60].includes(minutes))
    return res.status(400).json({ error: 'minutes must be ±15 or ±60', received: req.body });

  const eventExists = db.events.some(e => e.id === req.params.id);
  if (!eventExists) return res.status(404).json({ error: 'Event not found' });

  const ms = minutes * 60 * 1000;
  let changed = 0;
  db.routines.forEach(r => {
    if (r.eventId !== req.params.id || !r.scheduledTime) return;
    r.scheduledTime = new Date(new Date(r.scheduledTime).getTime() + ms).toISOString();
    r.notificationSent = false;
    notifiedSet.delete(r.id);
    changed++;
  });
  saveDb();
  io.emit('data-updated', { type: 'routine', action: 'shift' });
  console.log(`[shift] done — ${changed} routines updated`);
  res.json({ ok: true, changed });
});

// ─── API: Media (admin) ───────────────────────────────────────────────────────
app.get('/api/events/:eid/media', (req, res) => {
  res.json(db.media.filter(m => m.eventId === req.params.eid)
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)));
});

app.post('/api/events/:eid/media', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const item = {
    id: uuidv4(), eventId: req.params.eid,
    routineId:    req.body.routineId || null,
    filename:     req.file.filename,
    originalName: req.file.originalname,
    size:         req.file.size,
    type:         req.file.mimetype.startsWith('video/') ? 'video' : 'image',
    caption:      req.body.caption || '',
    uploadedBy:   'Host',
    uploadedAt:   new Date().toISOString()
  };
  db.media.push(item);
  saveDb();
  io.emit('data-updated', { type: 'media', action: 'create' });
  res.json(item);
});

app.delete('/api/media/:id', (req, res) => {
  const item = db.media.find(m => m.id === req.params.id);
  if (item) {
    try { fs.unlinkSync(path.join(UPLOADS_DIR, item.filename)); } catch (_) {}
    db.media = db.media.filter(m => m.id !== req.params.id);
    saveDb();
    io.emit('data-updated', { type: 'media', action: 'delete' });
  }
  res.json({ ok: true });
});

// ─── API: Settings ────────────────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  res.json({
    pushoverToken: db.settings.pushoverToken ? '●●●●●●●●' : '',
    pushoverUser:  db.settings.pushoverUser  || '',
    configured:    !!(db.settings.pushoverToken && db.settings.pushoverUser)
  });
});

app.put('/api/settings', (req, res) => {
  const { pushoverToken, pushoverUser } = req.body;
  if (pushoverToken && !pushoverToken.startsWith('●')) db.settings.pushoverToken = pushoverToken;
  if (pushoverUser !== undefined) db.settings.pushoverUser = pushoverUser;
  saveDb();
  res.json({ ok: true });
});

app.post('/api/settings/test', async (req, res) => {
  if (!db.settings.pushoverToken || !db.settings.pushoverUser)
    return res.status(400).json({ error: 'Pushover not configured' });
  try {
    await axios.post('https://api.pushover.net/1/messages.json', {
      token: db.settings.pushoverToken,
      user:  db.settings.pushoverUser,
      title: '🎭 StageCall',
      message: 'Test successful! You\'ll receive alerts 15 minutes before each routine.'
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.errors?.join(', ') || e.message });
  }
});

// ─── Notification Scheduler ───────────────────────────────────────────────────
setInterval(async () => {
  const now = Date.now();
  for (const routine of db.routines) {
    if (!routine.scheduledTime || notifiedSet.has(routine.id)) continue;
    const diff = new Date(routine.scheduledTime).getTime() - now;
    const diffMin = diff / 60000;
    if (diffMin >= 14 && diffMin <= 16) {
      notifiedSet.add(routine.id);
      routine.notificationSent = true;
      saveDb();

      const event = db.events.find(e => e.id === routine.eventId);
      const timeStr = new Date(routine.scheduledTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

      if (db.settings.pushoverToken && db.settings.pushoverUser) {
        try {
          await axios.post('https://api.pushover.net/1/messages.json', {
            token:    db.settings.pushoverToken,
            user:     db.settings.pushoverUser,
            title:    `⏰ On in 15 min — ${routine.dancerName}`,
            message:  `${routine.danceStyle || 'Routine'} at ${timeStr}${routine.stage ? '\nStage: ' + routine.stage : ''}${event ? '\n' + event.name : ''}`,
            priority: 1,
            sound:    'magic'
          });
          console.log(`[Pushover] Sent for ${routine.dancerName}`);
        } catch (e) {
          console.error('[Pushover] Error:', e.response?.data || e.message);
        }
      }

      io.emit('routine-alert', {
        id:            routine.id,
        dancerName:    routine.dancerName,
        danceStyle:    routine.danceStyle,
        stage:         routine.stage,
        scheduledTime: routine.scheduledTime,
        eventName:     event ? event.name : ''
      });
    }
  }
}, 30000);

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log(`[WS] +${socket.id.slice(0, 6)}`);
  socket.on('disconnect', () => console.log(`[WS] -${socket.id.slice(0, 6)}`));
});

// ─── Health / debug ───────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    version: '2.0',
    routes: ['GET /api/events', 'POST /api/events', 'PUT /api/events/:id',
             'DELETE /api/events/:id', 'GET /api/share/:key',
             'POST /api/share/:key/media', 'POST /api/share/:key/seated',
             'GET /api/events/:eid/routines', 'POST /api/events/:eid/routines',
             'PUT /api/routines/:id', 'DELETE /api/routines/:id',
             'POST /api/events/:id/shift',
             'GET /api/events/:eid/media', 'POST /api/events/:eid/media',
             'DELETE /api/media/:id', 'GET /api/settings', 'PUT /api/settings',
             'POST /api/settings/test'],
    events: db.events.length,
    routines: db.routines.length,
    uptime: Math.floor(process.uptime()) + 's'
  });
});

// ─── SPA Fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

server.listen(PORT, () => {
  console.log(`\n✦ StageCall running → http://localhost:${PORT}\n`);
});
