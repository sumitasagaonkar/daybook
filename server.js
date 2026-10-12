require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { MONGODB_URI, JWT_SECRET, PORT = 3000 } = process.env;
if (!MONGODB_URI || !JWT_SECRET) {
  console.error('Missing MONGODB_URI or JWT_SECRET in .env');
  process.exit(1);
}

const { Schema, model } = mongoose;
const ts = { timestamps: true };
const owner = { userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true } };
const DATE = { type: String, match: /^\d{4}-\d{2}-\d{2}$/ };
const TIME = { type: String, match: /^\d{2}:\d{2}$/ };

// ---------- Models ----------
const User = model('User', new Schema({
  name: { type: String, trim: true, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
}, ts));

const Todo = model('Todo', new Schema({
  ...owner,
  title: { type: String, required: true, trim: true, maxlength: 300 },
  notes: { type: String, maxlength: 5000 },
  tags: { type: [String], default: [] },
  repeat: { type: String, enum: ['once', 'daily'], default: 'once' },
  dueDate: DATE,
  time: TIME,
  done: { type: Boolean, default: false },
  doneAt: Date,
  completedDates: { type: [String], default: [] }, // for daily todos
  checklist: [{ text: String, done: Boolean }],
}, ts));

const Thought = model('Thought', new Schema({
  ...owner,
  text: { type: String, required: true, maxlength: 20000 },
  tags: { type: [String], default: [] },
}, ts));

const Reminder = model('Reminder', new Schema({
  ...owner,
  title: { type: String, required: true, trim: true, maxlength: 200 },
  message: { type: String, maxlength: 1000 },
  time: { ...TIME, required: true },
  repeat: { type: String, enum: ['once', 'daily'], default: 'daily' },
  date: DATE,
  active: { type: Boolean, default: true },
  lastFired: String,
  action: {
    kind: { type: String, enum: ['none', 'thought', 'todo', 'virtues'], default: 'none' },
    tag: String,
    todoId: { type: Schema.Types.ObjectId, default: null },
  },
}, ts));

const virtueSchema = new Schema({
  ...owner,
  date: { ...DATE, required: true },
  virtues: { type: Schema.Types.Mixed, default: {} },
  morning: String,
  evening: String,
}, { ...ts, minimize: false });
virtueSchema.index({ userId: 1, date: 1 }, { unique: true });
const Virtue = model('Virtue', virtueSchema);

// ---------- App ----------
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sign = u => jwt.sign({ uid: String(u._id) }, JWT_SECRET, { expiresIn: '30d' });
const pub = u => ({ id: u._id, name: u.name, email: u.email });
const strip = ({ _id, userId, createdAt, updatedAt, __v, ...rest } = {}) => rest;

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    req.uid = jwt.verify(token, JWT_SECRET).uid;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// ---------- Auth ----------
app.post('/api/auth/register', h(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (await User.exists({ email: String(email).toLowerCase().trim() })) return res.status(409).json({ error: 'Email already registered' });
  const user = await User.create({ name: String(name), email: String(email), password: await bcrypt.hash(String(password), 10) });
  res.status(201).json({ token: sign(user), user: pub(user) });
}));

app.post('/api/auth/login', h(async (req, res) => {
  const { email, password } = req.body || {};
  const user = await User.findOne({ email: String(email || '').toLowerCase().trim() });
  if (!user || !(await bcrypt.compare(String(password || ''), user.password))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json({ token: sign(user), user: pub(user) });
}));

app.get('/api/me', auth, h(async (req, res) => {
  const user = await User.findById(req.uid);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  res.json(pub(user));
}));

// ---------- Generic owned CRUD ----------
function crud(Model, { sort = { createdAt: -1 }, onDelete } = {}) {
  const r = express.Router();
  r.use(auth);
  r.get('/', h(async (req, res) => res.json(await Model.find({ userId: req.uid }).sort(sort).lean())));
  r.post('/', h(async (req, res) => res.status(201).json(await Model.create({ ...strip(req.body), userId: req.uid }))));
  r.patch('/:id', h(async (req, res) => {
    const doc = await Model.findOneAndUpdate(
      { _id: req.params.id, userId: req.uid },
      { $set: strip(req.body) },
      { new: true, runValidators: true }
    );
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  }));
  r.delete('/:id', h(async (req, res) => {
    const doc = await Model.findOneAndDelete({ _id: req.params.id, userId: req.uid });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (onDelete) await onDelete(doc, req);
    res.status(204).end();
  }));
  return r;
}

// Toggle a todo (daily → per-date, once → done flag)
app.post('/api/todos/:id/toggle', auth, h(async (req, res) => {
  const t = await Todo.findOne({ _id: req.params.id, userId: req.uid });
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (t.repeat === 'daily') {
    const d = String(req.body?.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: 'date required' });
    const i = t.completedDates.indexOf(d);
    i >= 0 ? t.completedDates.splice(i, 1) : t.completedDates.push(d);
  } else {
    t.done = !t.done;
    t.doneAt = t.done ? new Date() : null;
  }
  await t.save();
  res.json(t);
}));

app.use('/api/todos', crud(Todo, {
  onDelete: (doc, req) => Reminder.deleteMany({ userId: req.uid, 'action.todoId': doc._id }),
}));
app.use('/api/thoughts', crud(Thought));
app.use('/api/reminders', crud(Reminder, { sort: { time: 1 } }));

// ---------- Franklin virtues ----------
app.get('/api/virtues', auth, h(async (req, res) => {
  const q = { userId: req.uid };
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;
  if (from || to) q.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
  res.json(await Virtue.find(q).sort({ date: 1 }).lean());
}));

app.put('/api/virtues/:date', auth, h(async (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date' });
  const { virtues = {}, morning = '', evening = '' } = req.body || {};
  const doc = await Virtue.findOneAndUpdate(
    { userId: req.uid, date },
    { $set: { virtues, morning: String(morning), evening: String(evening) } },
    { new: true, upsert: true, runValidators: true }
  );
  res.json(doc);
}));

// ---------- Errors ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err.name === 'CastError') return res.status(400).json({ error: 'Invalid id or value' });
  if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
  if (err.code === 11000) return res.status(409).json({ error: 'Already exists' });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

mongoose.connect(MONGODB_URI)
  .then(() => app.listen(PORT, () => console.log(`Daybook running → http://localhost:${PORT}`)))
  .catch(e => { console.error('MongoDB connection failed:', e.message); process.exit(1); });
