require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const http = require('http');
const socketIo = require('socket.io');
const { MongoClient } = require('mongodb');
const cloudinary = require('cloudinary').v2;

// ========== INISIALISASI APP ==========
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

// ========== MIDDLEWARE ==========
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ========== KONFIGURASI CLOUDINARY ==========
cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.CLOUD_API_KEY,
    api_secret: process.env.CLOUD_API_SECRET
});

// ========== MULTER MEMORY STORAGE ==========
const memoryStorage = multer.memoryStorage();
const upload = multer({ storage: memoryStorage });

// ========== KONEKSI MONGODB (DENGAN OPSI TLS UNTUK MENGATASI ERROR SSL) ==========
const client = new MongoClient(process.env.MONGODB_URI, {
    tlsAllowInvalidCertificates: true,  // Solusi sementara untuk error SSL
    tlsAllowInvalidHostnames: true,     // Solusi sementara untuk error SSL
    connectTimeoutMS: 10000,
    serverSelectionTimeoutMS: 30000
});
let db;

async function connectDB() {
    try {
        await client.connect();
        db = client.db('gathering');
        console.log('✅ MongoDB connected to database: gathering');
        
        // Buat indeks untuk performa (opsional)
        await db.collection('users').createIndex({ username: 1 }, { unique: true });
        await db.collection('users').createIndex({ email: 1 }, { unique: true });
        await db.collection('messages').createIndex({ channelId: 1, timestamp: -1 });
        
    } catch (err) {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    }
}

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

// ========== ENDPOINT UPLOAD ==========
app.post('/api/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    try {
        const result = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                {
                    folder: 'gathering-app',
                    resource_type: 'auto',
                    allowed_formats: ['jpg', 'png', 'gif', 'mp4', 'pdf', 'zip', 'txt', 'docx']
                },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            );
            uploadStream.end(req.file.buffer);
        });
        res.json({
            url: result.secure_url,
            filename: result.public_id,
            originalname: req.file.originalname,
            size: req.file.size,
            type: req.file.mimetype.split('/')[0],
            mimetype: req.file.mimetype,
            extension: req.file.originalname.split('.').pop().toLowerCase()
        });
    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ error: 'Upload failed', details: err.message });
    }
});

// ========== ROUTES USERS ==========
app.get('/api/users', async (req, res) => {
    try {
        const users = await db.collection('users').find({}).project({ password: 0 }).toArray();
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/users/register', async (req, res) => {
    try {
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
            createdAt: new Date().toISOString()
        };
        await db.collection('users').insertOne(newUser);
        const { password: _, ...userWithoutPassword } = newUser;
        res.status(201).json(userWithoutPassword);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/users/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await db.collection('users').findOne({ username });
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });
        
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
        
        const { password: _, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== ROUTES SERVERS ==========
app.get('/api/servers', async (req, res) => {
    try {
        const servers = await db.collection('servers').find({}).toArray();
        res.json(servers);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/servers', async (req, res) => {
    try {
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
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/servers/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.collection('servers').deleteOne({ id });
        await db.collection('channels').deleteMany({ serverId: id });
        await db.collection('serverMembers').deleteMany({ serverId: id });
        io.emit('servers-updated', await db.collection('servers').find({}).toArray());
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== SERVER MEMBERS ==========
app.get('/api/serverMembers', async (req, res) => {
    try {
        const members = await db.collection('serverMembers').find({}).toArray();
        res.json(members);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/serverMembers', async (req, res) => {
    try {
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
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/serverMembers/:id', async (req, res) => {
    try {
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
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/serverMembers/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.collection('serverMembers').deleteOne({ id });
        io.emit('members-updated', await db.collection('serverMembers').find({}).toArray());
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== CHANNELS ==========
app.get('/api/channels', async (req, res) => {
    try {
        const channels = await db.collection('channels').find({}).toArray();
        res.json(channels);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/channels', async (req, res) => {
    try {
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
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/channels/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.collection('messages').deleteMany({ channelId: id });
        await db.collection('channels').deleteOne({ id });
        io.emit('channels-updated', await db.collection('channels').find({}).toArray());
        io.emit('messages-updated', await db.collection('messages').find({}).toArray());
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== MESSAGES ==========
app.get('/api/messages', async (req, res) => {
    try {
        const messages = await db.collection('messages').find({}).toArray();
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/messages', async (req, res) => {
    try {
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
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/messages/:id', async (req, res) => {
    try {
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
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/messages/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.collection('messages').deleteOne({ id });
        io.emit('messages-updated', await db.collection('messages').find({}).toArray());
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== SOCKET.IO ==========
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// ========== START SERVER ==========
async function startServer() {
    await connectDB();
    server.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
}

startServer();