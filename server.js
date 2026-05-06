// server.js - Final version for Render + MongoDB + Cloudinary
require('dotenv').config(); // opsional untuk local testing, di Render tidak wajib karena sudah set env vars

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const socketIo = require('socket.io');
const { MongoClient } = require('mongodb');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// ========== INISIALISASI APP ==========
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",  // Sesuaikan jika perlu, untuk production sebaiknya domain spesifik
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// ========== MIDDLEWARE ==========
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // static files (frontend)

// ========== KONFIGURASI CLOUDINARY ==========
cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.CLOUD_API_KEY,
    api_secret: process.env.CLOUD_API_SECRET
});

// ========== MULTER + CLOUDINARY STORAGE ==========
const cloudinaryStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'discord-clone',
        allowed_formats: ['jpg', 'png', 'gif', 'mp4', 'pdf', 'zip', 'txt', 'docx'],
        resource_type: 'auto'
    }
});
const upload = multer({ storage: cloudinaryStorage });

// ========== KONEKSI MONGODB ==========
const client = new MongoClient(process.env.MONGODB_URI);
let db;

async function connectDB() {
    try {
        await client.connect();
        db = client.db('discord_clone'); // nama database
        console.log('✅ MongoDB connected');
    } catch (err) {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    }
}

// ========== FUNGSI BANTU ==========
function generateId() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

function generateInviteCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// ========== ENDPOINT UPLOAD (Cloudinary) ==========
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    // req.file.path adalah URL dari Cloudinary
    res.json({
        url: req.file.path,
        filename: req.file.filename,
        originalname: req.file.originalname,
        size: req.file.size,
        type: req.file.mimetype.split('/')[0],
        mimetype: req.file.mimetype,
        extension: req.file.originalname.split('.').pop().toLowerCase()
    });
});

// ========== ROUTES USERS ==========
app.get('/api/users', async (req, res) => {
    const users = await db.collection('users').find({}).project({ password: 0 }).toArray();
    res.json(users);
});

app.post('/api/users/register', async (req, res) => {
    const { username, email, password } = req.body;
    // cek duplikat
    const existing = await db.collection('users').findOne({ $or: [{ username }, { email }] });
    if (existing) {
        return res.status(400).json({ error: 'Username or email already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
        id: generateId(),
        username,
        email,
        password: hashedPassword,
        avatar: username.charAt(0).toUpperCase(),
        createdAt: new Date().toISOString()
    };
    await db.collection('users').insertOne(newUser);
    const { password: _, ...userWithoutPassword } = newUser;
    res.status(201).json(userWithoutPassword);
});

app.post('/api/users/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await db.collection('users').findOne({ username });
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(401).json({ error: 'Invalid username or password' });
    const { password: _, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
});

// ========== ROUTES SERVERS ==========
app.get('/api/servers', async (req, res) => {
    const servers = await db.collection('servers').find({}).toArray();
    res.json(servers);
});

app.post('/api/servers', async (req, res) => {
    const { name, ownerId } = req.body;
    const newServer = {
        id: generateId(),
        name,
        ownerId,
        inviteCode: generateInviteCode(),
        createdAt: new Date().toISOString()
    };
    await db.collection('servers').insertOne(newServer);
    io.emit('servers-updated', await db.collection('servers').find({}).toArray());
    res.status(201).json(newServer);
});

app.delete('/api/servers/:id', async (req, res) => {
    const { id } = req.params;
    await db.collection('servers').deleteOne({ id });
    // juga hapus semua channel, member, message yang terkait (optional, sesuai kebutuhan)
    await db.collection('channels').deleteMany({ serverId: id });
    await db.collection('serverMembers').deleteMany({ serverId: id });
    io.emit('servers-updated', await db.collection('servers').find({}).toArray());
    res.json({ success: true });
});

// ========== ROUTES SERVER MEMBERS ==========
app.get('/api/serverMembers', async (req, res) => {
    const members = await db.collection('serverMembers').find({}).toArray();
    res.json(members);
});

app.post('/api/serverMembers', async (req, res) => {
    const { serverId, userId } = req.body;
    const newMember = {
        id: generateId(),
        serverId,
        userId,
        role: 'member',
        joinedAt: new Date().toISOString()
    };
    await db.collection('serverMembers').insertOne(newMember);
    io.emit('members-updated', await db.collection('serverMembers').find({}).toArray());
    res.status(201).json(newMember);
});

app.put('/api/serverMembers/:id', async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;
    const result = await db.collection('serverMembers').findOneAndUpdate(
        { id },
        { $set: { role } },
        { returnDocument: 'after' }
    );
    if (!result.value) return res.status(404).json({ error: 'Member not found' });
    io.emit('members-updated', await db.collection('serverMembers').find({}).toArray());
    res.json(result.value);
});

app.delete('/api/serverMembers/:id', async (req, res) => {
    const { id } = req.params;
    await db.collection('serverMembers').deleteOne({ id });
    io.emit('members-updated', await db.collection('serverMembers').find({}).toArray());
    res.json({ success: true });
});

// ========== ROUTES CHANNELS ==========
app.get('/api/channels', async (req, res) => {
    const channels = await db.collection('channels').find({}).toArray();
    res.json(channels);
});

app.post('/api/channels', async (req, res) => {
    const { serverId, name } = req.body;
    const newChannel = {
        id: generateId(),
        serverId,
        name,
        createdAt: new Date().toISOString()
    };
    await db.collection('channels').insertOne(newChannel);
    io.emit('channels-updated', await db.collection('channels').find({}).toArray());
    res.status(201).json(newChannel);
});

app.delete('/api/channels/:id', async (req, res) => {
    const { id } = req.params;
    // hapus juga semua pesan di channel ini
    await db.collection('messages').deleteMany({ channelId: id });
    await db.collection('channels').deleteOne({ id });
    io.emit('channels-updated', await db.collection('channels').find({}).toArray());
    io.emit('messages-updated', await db.collection('messages').find({}).toArray());
    res.json({ success: true });
});

// ========== ROUTES MESSAGES ==========
app.get('/api/messages', async (req, res) => {
    const messages = await db.collection('messages').find({}).toArray();
    res.json(messages);
});

app.post('/api/messages', async (req, res) => {
    const { channelId, userId, username, content, fileUrl, fileType } = req.body;
    const newMessage = {
        id: generateId(),
        channelId,
        userId,
        username,
        content: content || '',
        fileUrl: fileUrl || null,
        fileType: fileType || null,
        timestamp: new Date().toISOString()
    };
    await db.collection('messages').insertOne(newMessage);
    io.emit('messages-updated', await db.collection('messages').find({}).toArray());
    res.status(201).json(newMessage);
});

app.put('/api/messages/:id', async (req, res) => {
    const { id } = req.params;
    const { content } = req.body;
    const result = await db.collection('messages').findOneAndUpdate(
        { id },
        { $set: { content, editedAt: new Date().toISOString() } },
        { returnDocument: 'after' }
    );
    if (!result.value) return res.status(404).json({ error: 'Message not found' });
    io.emit('messages-updated', await db.collection('messages').find({}).toArray());
    res.json(result.value);
});

app.delete('/api/messages/:id', async (req, res) => {
    const { id } = req.params;
    await db.collection('messages').deleteOne({ id });
    io.emit('messages-updated', await db.collection('messages').find({}).toArray());
    res.json({ success: true });
});

// ========== SOCKET.IO ==========
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// ========== START SERVER AFTER DB CONNECTION ==========
async function startServer() {
    await connectDB();
    server.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
}

startServer();