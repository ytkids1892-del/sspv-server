const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 1e8
});

const PORT = process.env.PORT || 3001;

// Создаём директорию для файлов
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Инициализация SQLite
const db = new Database(path.join(__dirname, 'sspv.db'));

// Создание таблиц
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'newbie',
    reputation INTEGER DEFAULT 0,
    is_banned INTEGER DEFAULT 0,
    is_invisible INTEGER DEFAULT 0,
    is_approved INTEGER DEFAULT 1,
    avatar TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    last_seen INTEGER DEFAULT (strftime('%s', 'now'))
  );
  
  CREATE TABLE IF NOT EXISTS invite_codes (
    code TEXT PRIMARY KEY,
    created_by TEXT,
    is_used INTEGER DEFAULT 0,
    max_uses INTEGER DEFAULT 1,
    uses_count INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );
  
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    name TEXT,
    type TEXT DEFAULT 'group',
    created_by TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    avatar TEXT
  );
  
  CREATE TABLE IF NOT EXISTS chat_members (
    chat_id TEXT,
    user_id TEXT,
    role TEXT DEFAULT 'member',
    joined_at INTEGER DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (chat_id, user_id),
    FOREIGN KEY (chat_id) REFERENCES chats(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT,
    user_id TEXT,
    text TEXT,
    type TEXT DEFAULT 'text',
    file_url TEXT,
    reply_to TEXT,
    is_edited INTEGER DEFAULT 0,
    edited_at INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (chat_id) REFERENCES chats(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  
  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    name TEXT,
    chat_ids TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  
  CREATE TABLE IF NOT EXISTS reputation_log (
    id TEXT PRIMARY KEY,
    from_user_id TEXT,
    to_user_id TEXT,
    value INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (from_user_id) REFERENCES users(id),
    FOREIGN KEY (to_user_id) REFERENCES users(id)
  );
  
  CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT,
    description TEXT,
    created_by TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );
  
  CREATE TABLE IF NOT EXISTS channel_subscribers (
    channel_id TEXT,
    user_id TEXT,
    subscribed_at INTEGER DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (channel_id, user_id),
    FOREIGN KEY (channel_id) REFERENCES channels(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  
  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    type TEXT,
    message TEXT,
    created_by TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );
`);

// Создаём босса по умолчанию
const bossCheck = db.prepare('SELECT id FROM users WHERE username = ?').get('БОСС');
if (!bossCheck) {
  const bossId = uuidv4();
  const hashedPassword = bcrypt.hashSync('boss123', 10);
  db.prepare(`
    INSERT INTO users (id, username, password, role, reputation)
    VALUES (?, ?, ?, ?, ?)
  `).run(bossId, 'БОСС', hashedPassword, 'boss', 1000);
  
  // Стартовый код
  db.prepare(`
    INSERT INTO invite_codes (code, created_by, max_uses)
    VALUES (?, ?, ?)
  `).run('SSPV2026', bossId, 40);
  
  // Создаём дефолтные чаты
  const generalChat = uuidv4();
  db.prepare(`INSERT INTO chats (id, name, type, created_by) VALUES (?, ?, ?, ?)`)
    .run(generalChat, '💬 Общая флудилка', 'group', bossId);
  
  const memesChat = uuidv4();
  db.prepare(`INSERT INTO chats (id, name, type, created_by) VALUES (?, ?, ?, ?)`)
    .run(memesChat, '🎭 Мемасы', 'group', bossId);
  
  const deloChat = uuidv4();
  db.prepare(`INSERT INTO chats (id, name, type, created_by) VALUES (?, ?, ?, ?)`)
    .run(deloChat, '💼 Дела', 'group', bossId);
  
  const razborkiChat = uuidv4();
  db.prepare(`INSERT INTO chats (id, name, type, created_by) VALUES (?, ?, ?, ?)`)
    .run(razborkiChat, '🔥 Разборки', 'group', bossId);
  
  const voiceChat = uuidv4();
  db.prepare(`INSERT INTO chats (id, name, type, created_by) VALUES (?, ?, ?, ?)`)
    .run(voiceChat, '🎤 Голосовая', 'voice', bossId);
  
  // Канал от босса
  const channel = uuidv4();
  db.prepare(`INSERT INTO channels (id, name, description, created_by) VALUES (?, ?, ?, ?)`)
    .run(channel, '📢 Объявления Босса', 'Официальные объявления SSPV', bossId);
  
  console.log('✅ Босс создан: логин=БОСС, пароль=boss123');
  console.log('✅ Стартовый код: SSPV2026');
}

// Роли
const ROLES = {
  BOSS: 'boss',
  ADMIN: 'admin',
  MEMBER: 'member',
  NEWBIE: 'newbie'
};

const ROLE_COLORS = {
  boss: '#9b59b6',
  admin: '#e74c3c',
  member: '#2ecc71',
  newbie: '#95a5a6'
};

// Хранилище активных пользователей
const onlineUsers = new Map();
const userSockets = new Map();

// API: Регистрация (без кода, ждёт подтверждения админа)
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Нужен логин и пароль' });
  }
  
  // Проверяем, есть ли уже пользователь с таким логином
  const existingUser = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  
  if (existingUser) {
    // Если пользователь есть — проверяем пароль и входим (если подтверждён)
    if (!bcrypt.compareSync(password, existingUser.password)) {
      return res.status(400).json({ error: 'Неверный пароль' });
    }
    
    if (existingUser.is_banned) {
      return res.status(403).json({ error: 'Вы забанены в SSPV' });
    }
    
    if (!existingUser.is_approved) {
      return res.status(403).json({ error: 'Аккаунт ещё не подтверждён админом', pending: true });
    }
    
    db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), existingUser.id);
    
    return res.json({
      userId: existingUser.id,
      username: existingUser.username,
      role: existingUser.role,
      reputation: existingUser.reputation
    });
  }
  
  // Если пользователя нет — создаём заявку (pending)
  const userId = uuidv4();
  const hashedPassword = bcrypt.hashSync(password, 10);
  
  db.prepare(`
    INSERT INTO users (id, username, password, role, reputation, is_approved)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, username, hashedPassword, ROLES.NEWBIE, 0, 0);
  
  res.json({
    userId,
    username,
    role: ROLES.NEWBIE,
    reputation: 0,
    pending: true,
    message: 'Заявка создана! Жди подтверждения админа.'
  });
});

// API: Подтвердить пользователя (админ)
app.post('/api/users/:userId/approve', (req, res) => {
  const { userId } = req.params;
  const { adminId } = req.body;
  
  const admin = db.prepare('SELECT * FROM users WHERE id = ?').get(adminId);
  if (!admin || (admin.role !== ROLES.BOSS && admin.role !== ROLES.ADMIN)) {
    return res.status(403).json({ error: 'Только админы' });
  }
  
  db.prepare('UPDATE users SET is_approved = 1 WHERE id = ?').run(userId);
  
  // Уведомляем через сокет
  io.emit('user:approved', { userId });
  
  res.json({ success: true });
});

// API: Отклонить пользователя (админ)
app.delete('/api/users/:userId', (req, res) => {
  const { userId } = req.params;
  const { adminId } = req.body;
  
  const admin = db.prepare('SELECT * FROM users WHERE id = ?').get(adminId);
  if (!admin || (admin.role !== ROLES.BOSS && admin.role !== ROLES.ADMIN)) {
    return res.status(403).json({ error: 'Только админы' });
  }
  
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  
  res.json({ success: true });
});

// API: Получить всех пользователей (админ)
app.get('/api/users', (req, res) => {
  const users = db.prepare(`
    SELECT id, username, role, reputation, is_banned, is_invisible, is_approved, created_at, last_seen
    FROM users
    ORDER BY 
      CASE WHEN is_approved = 0 THEN 0 ELSE 1 END,
      CASE role WHEN 'boss' THEN 1 WHEN 'admin' THEN 2 WHEN 'member' THEN 3 ELSE 4 END,
      reputation DESC
  `).all();
  
  const usersWithOnline = users.map(u => ({
    ...u,
    isOnline: onlineUsers.has(u.id)
  }));
  
  res.json(usersWithOnline);
});

// API: Сменить пароль
app.post('/api/users/:userId/change-password', (req, res) => {
  const { userId } = req.params;
  const { oldPassword, newPassword, adminId } = req.body;
  
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  
  // Проверка: либо сам пользователь, либо админ
  const isAdmin = adminId && (() => {
    const admin = db.prepare('SELECT * FROM users WHERE id = ?').get(adminId);
    return admin && (admin.role === ROLES.BOSS || admin.role === ROLES.ADMIN);
  })();
  
  if (!isAdmin && oldPassword) {
    if (!bcrypt.compareSync(oldPassword, user.password)) {
      return res.status(400).json({ error: 'Неверный старый пароль' });
    }
  } else if (!isAdmin && !oldPassword) {
    return res.status(400).json({ error: 'Нужен старый пароль' });
  }
  
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'Пароль должен быть не менее 4 символов' });
  }
  
  const hashedPassword = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, userId);
  
  res.json({ success: true, message: 'Пароль изменён' });
});

// API: Вход
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    return res.status(400).json({ error: 'Неверный логин или пароль' });
  }
  
  if (!bcrypt.compareSync(password, user.password)) {
    return res.status(400).json({ error: 'Неверный логин или пароль' });
  }
  
  if (user.is_banned) {
    return res.status(403).json({ error: 'Вы забанены в SSPV' });
  }
  
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), user.id);
  
  const token = bcrypt.hashSync(user.id + Date.now(), 10);
  
  res.json({
    userId: user.id,
    username: user.username,
    role: user.role,
    reputation: user.reputation,
    token
  });
});

// API: Health check для Render
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// API: Получить все чаты
app.get('/api/chats', (req, res) => {
  const chats = db.prepare('SELECT * FROM chats ORDER BY created_at DESC').all();
  res.json(chats);
});

// API: Получить сообщения чата
app.get('/api/messages/:chatId', (req, res) => {
  const { chatId } = req.params;
  const { limit = 50, offset = 0 } = req.query;

  const messages = db.prepare(`
    SELECT m.*, u.username, u.role, u.avatar,
           r.text as reply_text
    FROM messages m
    JOIN users u ON m.user_id = u.id
    LEFT JOIN messages r ON m.reply_to = r.id
    LEFT JOIN users r_user ON r.user_id = r_user.id
    WHERE m.chat_id = ?
    ORDER BY m.created_at DESC
    LIMIT ? OFFSET ?
  `).all(chatId, parseInt(limit), parseInt(offset));

  res.json(messages.reverse());
});

// API: Создать код приглашения (админ)
app.post('/api/invite-codes', (req, res) => {
  const { userId, maxUses = 1 } = req.body;
  
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || (user.role !== ROLES.BOSS && user.role !== ROLES.ADMIN)) {
    return res.status(403).json({ error: 'Только админы' });
  }
  
  const code = Math.random().toString(36).substring(2, 10).toUpperCase();
  
  db.prepare(`
    INSERT INTO invite_codes (code, created_by, max_uses)
    VALUES (?, ?, ?)
  `).run(code, userId, maxUses);
  
  res.json({ code, maxUses });
});

// API: Получить все коды (админ)
app.get('/api/invite-codes', (req, res) => {
  const codes = db.prepare(`
    SELECT ic.*, u.username as created_by_name
    FROM invite_codes ic
    JOIN users u ON ic.created_by = u.id
    ORDER BY ic.created_at DESC
  `).all();
  res.json(codes);
});

// API: Создать пользователя (админ)
app.post('/api/users/create', (req, res) => {
  const { adminId, username, password, role = 'newbie' } = req.body;
  
  const admin = db.prepare('SELECT * FROM users WHERE id = ?').get(adminId);
  if (!admin || (admin.role !== ROLES.BOSS && admin.role !== ROLES.ADMIN)) {
    return res.status(403).json({ error: 'Только админы' });
  }
  
  const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existingUser) {
    return res.status(400).json({ error: 'Такой логин уже занят' });
  }
  
  const userId = uuidv4();
  const hashedPassword = bcrypt.hashSync(password, 10);
  
  db.prepare(`
    INSERT INTO users (id, username, password, role, reputation)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, username, hashedPassword, role, 0);
  
  // Создаём персональный код
  const personalCode = Math.random().toString(36).substring(2, 10).toUpperCase();
  db.prepare(`
    INSERT INTO invite_codes (code, created_by, max_uses)
    VALUES (?, ?, ?)
  `).run(personalCode, userId, 1);
  
  res.json({
    userId,
    username,
    password,
    personalCode
  });
});

// API: Получить всех пользователей (админ) - с is_approved
app.get('/api/users', (req, res) => {
  const users = db.prepare(`
    SELECT id, username, role, reputation, is_banned, is_invisible, is_approved, created_at, last_seen
    FROM users
    ORDER BY 
      CASE WHEN is_approved = 0 THEN 0 ELSE 1 END,
      CASE role WHEN 'boss' THEN 1 WHEN 'admin' THEN 2 WHEN 'member' THEN 3 ELSE 4 END,
      reputation DESC
  `).all();

  const usersWithOnline = users.map(u => ({
    ...u,
    isOnline: onlineUsers.has(u.id)
  }));

  res.json(usersWithOnline);
});

// API: Бан пользователя (админ)
app.post('/api/users/:userId/ban', (req, res) => {
  const { userId } = req.params;
  const { adminId } = req.body;

  const admin = db.prepare('SELECT * FROM users WHERE id = ?').get(adminId);
  if (!admin || (admin.role !== ROLES.BOSS && admin.role !== ROLES.ADMIN)) {
    return res.status(403).json({ error: 'Только админы' });
  }

  db.prepare('UPDATE users SET is_banned = 1 WHERE id = ?').run(userId);

  const socket = userSockets.get(userId);
  if (socket) {
    socket.emit('user:banned');
    socket.disconnect();
  }

  io.emit('user:banned', { userId });

  res.json({ success: true });
});

// API: Удалить пользователя (только босс)
app.delete('/api/users/:userId', (req, res) => {
  const { userId } = req.params;
  const { adminId } = req.body;

  const admin = db.prepare('SELECT * FROM users WHERE id = ?').get(adminId);
  if (!admin || admin.role !== ROLES.BOSS) {
    return res.status(403).json({ error: 'Только босс' });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  io.emit('user:kicked', { userId });

  res.json({ success: true });
});

// API: Репутация
app.post('/api/reputation', (req, res) => {
  const { fromId, toId, value } = req.body;
  
  const repId = uuidv4();
  db.prepare(`
    INSERT INTO reputation_log (id, from_user_id, to_user_id, value)
    VALUES (?, ?, ?, ?)
  `).run(repId, fromId, toId, value);
  
  db.prepare('UPDATE users SET reputation = reputation + ? WHERE id = ?').run(value, toId);
  
  const user = db.prepare('SELECT reputation FROM users WHERE id = ?').get(toId);
  res.json({ newReputation: user.reputation });
});

// API: Каналы
app.get('/api/channels', (req, res) => {
  const channels = db.prepare(`
    SELECT c.*, u.username as creator_name,
           (SELECT COUNT(*) FROM channel_subscribers WHERE channel_id = c.id) as subscribers
    FROM channels c
    JOIN users u ON c.created_by = u.id
  `).all();
  res.json(channels);
});

app.post('/api/channels', (req, res) => {
  const { name, description, createdBy } = req.body;
  
  const admin = db.prepare('SELECT * FROM users WHERE id = ?').get(createdBy);
  if (!admin || admin.role !== ROLES.BOSS) {
    return res.status(403).json({ error: 'Только босс' });
  }
  
  const channelId = uuidv4();
  db.prepare(`
    INSERT INTO channels (id, name, description, created_by)
    VALUES (?, ?, ?, ?)
  `).run(channelId, name, description, createdBy);
  
  res.json({ id: channelId, name, description });
});

// API: Загрузка файлов
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Нет файла' });
  }
  
  const fileUrl = `/uploads/${req.file.filename}`;
  const fileType = req.file.mimetype.startsWith('image/') ? 'image' : 
                   req.file.mimetype.startsWith('video/') ? 'video' : 'file';
  
  res.json({ url: fileUrl, type: fileType, filename: req.file.originalname });
});

// API: Папки
app.get('/api/folders/:userId', (req, res) => {
  const { userId } = req.params;
  const folders = db.prepare('SELECT * FROM folders WHERE user_id = ?').all(userId);
  
  // Если нет папок, создаём дефолтные
  if (folders.length === 0) {
    const defaultFolders = [
      { id: uuidv4(), user_id: userId, name: '📌 Избранное', chat_ids: '[]' },
      { id: uuidv4(), user_id: userId, name: '💬 Общее', chat_ids: '[]' },
      { id: uuidv4(), user_id: userId, name: '👥 Друзья', chat_ids: '[]' }
    ];
    
    defaultFolders.forEach(f => {
      db.prepare('INSERT INTO folders (id, user_id, name, chat_ids) VALUES (?, ?, ?, ?)')
        .run(f.id, f.user_id, f.name, f.chat_ids);
    });
    
    return res.json(defaultFolders);
  }
  
  res.json(folders);
});

app.post('/api/folders', (req, res) => {
  const { userId, name, chatIds } = req.body;
  const folderId = uuidv4();
  
  db.prepare(`
    INSERT INTO folders (id, user_id, name, chat_ids)
    VALUES (?, ?, ?, ?)
  `).run(folderId, userId, name, JSON.stringify(chatIds));
  
  res.json({ id: folderId, name, chatIds });
});

// SOCKET.IO
io.on('connection', (socket) => {
  console.log(`🔌 Подключился: ${socket.id}`);

  // Обработка ошибок
  socket.on('error', (err) => {
    console.error(`❌ Socket error:`, err);
  });

  socket.on('disconnect', (reason) => {
    console.log(`🔌 Отключился: ${socket.id}, причина: ${reason}`);
  });
  
  // Вход пользователя
  socket.on('user:auth', (data) => {
    try {
      const { userId, username } = data;
      socket.userId = userId;
      socket.username = username;

      onlineUsers.set(userId, { username, lastSeen: Date.now() });
      userSockets.set(userId, socket);

      db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), userId);

      socket.emit('user:authSuccess', { userId, username });
      io.emit('user:online', { userId, username });

      console.log(`✅ Вошёл: ${username}`);
    } catch (err) {
      console.error('❌ Error in user:auth:', err);
      socket.emit('error', { message: 'Ошибка авторизации' });
    }
  });
  
  // Присоединение к чату
  socket.on('chat:join', (data) => {
    try {
      const { chatId } = data;
      socket.join(chatId);
      console.log(`${socket.username} присоединился к ${chatId}`);
    } catch (err) {
      console.error('❌ Error in chat:join:', err);
    }
  });

  // Отправка сообщения
  socket.on('message:send', (data) => {
    try {
      const { chatId, text, type = 'text', fileUrl, replyTo, duration } = data;

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(socket.userId);
      if (!user || user.is_banned) return;

      const messageId = uuidv4();

      db.prepare(`
        INSERT INTO messages (id, chat_id, user_id, text, type, file_url, reply_to)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(messageId, chatId, socket.userId, text, type, fileUrl || null, replyTo || null);

      const message = db.prepare(`
        SELECT m.*, u.username, u.role, u.avatar
        FROM messages m
        JOIN users u ON m.user_id = u.id
        WHERE m.id = ?
      `).get(messageId);

      io.to(chatId).emit('message:new', message);
    } catch (err) {
      console.error('❌ Error in message:send:', err);
      socket.emit('error', { message: 'Ошибка отправки сообщения' });
    }
  });
  
  // Редактирование сообщения
  socket.on('message:edit', (data) => {
    try {
      const { messageId, text } = data;

      const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
      if (!message || message.user_id !== socket.userId) return;

      db.prepare(`
        UPDATE messages SET text = ?, is_edited = 1, edited_at = ?
        WHERE id = ?
      `).run(text, Date.now(), messageId);

      io.to(message.chat_id).emit('message:edited', { messageId, text });
    } catch (err) {
      console.error('❌ Error in message:edit:', err);
    }
  });

  // Удаление сообщения
  socket.on('message:delete', (data) => {
    try {
      const { messageId } = data;

      const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
      if (!message) return;

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(socket.userId);
      if (message.user_id !== socket.userId && user.role !== ROLES.BOSS && user.role !== ROLES.ADMIN) return;

      db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
      io.to(message.chat_id).emit('message:deleted', { messageId });
    } catch (err) {
      console.error('❌ Error in message:delete:', err);
    }
  });

  // Статус "печатает..."
  socket.on('typing:start', (data) => {
    try {
      const { chatId } = data;
      socket.to(chatId).emit('typing:update', {
        userId: socket.userId,
        username: socket.username,
        isTyping: true
      });
    } catch (err) {
      console.error('❌ Error in typing:start:', err);
    }
  });

  socket.on('typing:stop', (data) => {
    try {
      const { chatId } = data;
      socket.to(chatId).emit('typing:update', {
        userId: socket.userId,
        username: socket.username,
        isTyping: false
      });
    } catch (err) {
      console.error('❌ Error in typing:stop:', err);
    }
  });
  
  // WebRTC
  socket.on('webrtc:offer', (data) => {
    try {
      socket.to(data.to).emit('webrtc:offer', data);
    } catch (err) {
      console.error('❌ Error in webrtc:offer:', err);
    }
  });

  socket.on('webrtc:answer', (data) => {
    try {
      socket.to(data.to).emit('webrtc:answer', data);
    } catch (err) {
      console.error('❌ Error in webrtc:answer:', err);
    }
  });

  socket.on('webrtc:ice-candidate', (data) => {
    try {
      socket.to(data.to).emit('webrtc:ice-candidate', data);
    } catch (err) {
      console.error('❌ Error in webrtc:ice-candidate:', err);
    }
  });

  // ТРЕВОГА! (теперь для всех)
  socket.on('alert:trigger', (data) => {
    try {
      const { type, message } = data;

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(socket.userId);
      if (!user) {
        socket.emit('alert:error', { error: 'Пользователь не найден' });
        return;
      }

      // Сохраняем тревогу
      const alertId = uuidv4();
      db.prepare(`
        INSERT INTO alerts (id, type, message, created_by)
        VALUES (?, ?, ?, ?)
      `).run(alertId, type, message, socket.userId);

      // Отправляем ВСЕМ
      io.emit('alert:triggered', {
        type,
        message,
        triggeredBy: user.username,
        timestamp: Date.now()
      });

      console.log(`🚨 ТРЕВОГА! Тип: ${type}, Сообщение: ${message}`);
    } catch (err) {
      console.error('❌ Error in alert:trigger:', err);
    }
  });

  // Голосовое сообщение (WebRTC для голосовых комнат)
  socket.on('voice:join', (data) => {
    try {
      const { chatId } = data;
      socket.join(`voice:${chatId}`);
      socket.to(`voice:${chatId}`).emit('voice:userJoined', {
        userId: socket.userId,
        username: socket.username
      });
    } catch (err) {
      console.error('❌ Error in voice:join:', err);
    }
  });

  socket.on('voice:leave', (data) => {
    try {
      const { chatId } = data;
      socket.leave(`voice:${chatId}`);
      socket.to(`voice:${chatId}`).emit('voice:userLeft', {
        userId: socket.userId,
        username: socket.username
      });
    } catch (err) {
      console.error('❌ Error in voice:leave:', err);
    }
  });

  // Отключение
  socket.on('disconnect', () => {
    try {
      if (socket.userId) {
        onlineUsers.delete(socket.userId);
        userSockets.delete(socket.userId);

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(socket.userId);
        if (user && !user.is_invisible) {
          io.emit('user:offline', { userId: socket.userId, username: socket.username });
        }
        console.log(`❌ Вышел: ${socket.username}`);
      }
    } catch (err) {
      console.error('❌ Error in disconnect:', err);
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n🚀 SSPV V2 SERVER запущен на порту ${PORT}`);
  console.log(`📁 Директория: ${__dirname}`);
  console.log(`💾 База данных: ${path.join(__dirname, 'sspv.db')}`);
  console.log(`\n👑 БОСС: логин=БОСС, пароль=boss123`);
  console.log(`🎫 Стартовый код: SSPV2026\n`);
});
