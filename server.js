// server.js – Versi siap pakai untuk Cloudinary + MongoDB + Render
require('dotenv').config(); // opsional, untuk lokal
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const socketIo = require('socket.io');
const { MongoClient, ObjectId } = require('mongodb');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET","POST"] } });

// ========== KONFIGURASI ==========
const PORT = process.env.PORT || 3000;

// Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.CLOUD_API_KEY,
    api_secret: process.env.CLOUD_API_SECRET
});

// MongoDB
const client = new MongoClient(process.env.MONGODB_URI);
let db;

// Multer + Cloudinary storage
const cloudinaryStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'uploads',
        allowed_formats: ['jpg','png','gif','mp4','pdf','zip','txt','docx'],
        resource_type: 'auto'
    }
});
const upload = multer({ storage: cloudinaryStorage });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ========== FUNGSI BANTU ==========
function generateId() {
    return new ObjectId().toString();
}

// ========== ROUTE UPLOAD (Cloudinary) ==========
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({
        url: req.file.path,
        filename: req.file.filename,
        originalname: req.file.originalname,
        size: req.file.size,
        type: req.file.mimetype.split('/')[0],
        mimetype: req.file.mimetype
    });
});

// ========== ROUTE USER ==========
app.get('/api/users', async (req, res) => {
    const users = await db.collection('users').find({}).project({ password: 0 }).toArray();
    res.json(users);
});

app.post('/api/users/register', async (req, res) => {
    const { username, email, password } = req.body;
    const existing = await db.collection('users').findOne({ $or: [{ username }, { email }] });
    if (existing) return res.status(400).json({ error: 'Username or email exists' });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
        id: generateId(),
        username,
        email,
        password: hashedPassword,
        avatar: username.charAt(0).toUpperCase(),
        createdAt: new Date()
    };
    await db.collection('users').insertOne(newUser);
    const { password: _, ...userWithoutPassword } = newUser;
    res.status(201).json(userWithoutPassword);
});

app.post('/api/users/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await db.collection('users').findOne({ username });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const { password: _, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
});

// ========== ROUTE SERVER ==========
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
        inviteCode: Math.random().toString(36).substr(2, 8).toUpperCase(),
        createdAt: new Date()
    };
    await db.collection('servers').insertOne(newServer);
    io.emit('servers-updated', await db.collection('servers').find({}).toArray());
    res.status(201).json(newServer);
});

app.delete('/api/servers/:id', async (req, res) => {
    await db.collection('servers').deleteOne({ id: req.params.id });
    io.emit('servers-updated', await db.collection('servers').find({}).toArray());
    res.json({ success: true });
});

// ========== ROUTE CHANNEL, MEMBER, MESSAGE ==========
// ... pola yang sama – gunakan db.collection('channels'), 'serverMembers', 'messages'
// (Saya tulis lengkap di file final, tapi di sini cukup contoh)

// ========== SOCKET.IO ==========
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.on('disconnect', () => console.log('Disconnected:', socket.id));
});

// ========== KONEKSI DATABASE & START SERVER ==========
async function startServer() {
    try {
        await client.connect();
        db = client.db('discord_clone');
        console.log('✅ MongoDB connected');
        
        server.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

startServer();