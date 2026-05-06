const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Create uploads folder if not exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

app.use('/uploads', express.static(uploadsDir));

// Multer configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const originalName = file.originalname.replace(/[^a-zA-Z0-9.\-_,\s]/g, '_');
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 6);
        const filename = `${timestamp}-${random}-${originalName}`;
        cb(null, filename);
    }
});

// ini harusnya dihapus
const fileFilter = (req, file, cb) => {
    cb(null, true);
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 1024 * 1024 * 1024 }
});

// Database path
const DB_PATH = path.join(__dirname, 'database.json');

function readDatabase() {
    try {
        if (!fs.existsSync(DB_PATH)) {
            const defaultData = {
                users: [],
                servers: [],
                serverMembers: [],
                channels: [],
                messages: []
            };
            writeDatabase(defaultData);
            return defaultData;
        }
        const data = fs.readFileSync(DB_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading database:', error);
        return { users: [], servers: [], serverMembers: [], channels: [], messages: [] };
    }
}

function writeDatabase(data) {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('Error writing database:', error);
        return false;
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

// File upload
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const fileUrl = `/uploads/${req.file.filename}`;
    const fileType = req.file.mimetype.split('/')[0];
    const originalname = req.file.originalname;
    const fileSize = req.file.size;
    const extension = originalname.split('.').pop().toLowerCase();
    
    res.json({
        url: fileUrl,
        filename: req.file.filename,
        originalname: originalname,
        type: fileType,
        mimetype: req.file.mimetype,
        size: fileSize,
        extension: extension
    });
});

// User routes
app.get('/api/users', (req, res) => {
    const db = readDatabase();
    const safeUsers = db.users.map(user => ({
        id: user.id,
        username: user.username,
        email: user.email,
        avatar: user.avatar
    }));
    res.json(safeUsers);
});

app.post('/api/users/register', async (req, res) => {
    const { username, email, password } = req.body;
    const db = readDatabase();
    
    if (db.users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Username already exists' });
    }
    if (db.users.find(u => u.email === email)) {
        return res.status(400).json({ error: 'Email already exists' });
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
    
    db.users.push(newUser);
    if (writeDatabase(db)) {
        const { password: _, ...userWithoutPassword } = newUser;
        res.status(201).json(userWithoutPassword);
    } else {
        res.status(500).json({ error: 'Failed to save user' });
    }
});

app.post('/api/users/login', async (req, res) => {
    const { username, password } = req.body;
    const db = readDatabase();
    const user = db.users.find(u => u.username === username);
    
    if (!user) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    const { password: _, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
});

// Server routes
app.get('/api/servers', (req, res) => {
    const db = readDatabase();
    res.json(db.servers);
});

app.post('/api/servers', (req, res) => {
    const { name, ownerId } = req.body;
    const db = readDatabase();
    const newServer = {
        id: generateId(),
        name,
        ownerId,
        inviteCode: generateInviteCode(),
        createdAt: new Date().toISOString()
    };
    db.servers.push(newServer);
    if (writeDatabase(db)) {
        io.emit('servers-updated', db.servers);
        res.status(201).json(newServer);
    } else {
        res.status(500).json({ error: 'Failed to create server' });
    }
});

app.delete('/api/servers/:id', (req, res) => {
    const { id } = req.params;
    const db = readDatabase();
    db.servers = db.servers.filter(s => s.id !== id);
    if (writeDatabase(db)) {
        io.emit('servers-updated', db.servers);
        res.json({ success: true });
    } else {
        res.status(500).json({ error: 'Failed to delete server' });
    }
});

// Server Members routes (dengan role)
app.get('/api/serverMembers', (req, res) => {
    const db = readDatabase();
    res.json(db.serverMembers);
});

app.post('/api/serverMembers', (req, res) => {
    const { serverId, userId } = req.body;
    const db = readDatabase();
    const newMember = {
        id: generateId(),
        serverId,
        userId,
        role: 'member', // 'owner', 'moderator', 'member'
        joinedAt: new Date().toISOString()
    };
    db.serverMembers.push(newMember);
    if (writeDatabase(db)) {
        io.emit('members-updated', db.serverMembers);
        res.status(201).json(newMember);
    } else {
        res.status(500).json({ error: 'Failed to add member' });
    }
});

app.put('/api/serverMembers/:id', (req, res) => {
    const { id } = req.params;
    const { role } = req.body;
    const db = readDatabase();
    const memberIndex = db.serverMembers.findIndex(m => m.id === id);
    if (memberIndex === -1) {
        return res.status(404).json({ error: 'Member not found' });
    }
    db.serverMembers[memberIndex].role = role;
    if (writeDatabase(db)) {
        io.emit('members-updated', db.serverMembers);
        res.json(db.serverMembers[memberIndex]);
    } else {
        res.status(500).json({ error: 'Failed to update member role' });
    }
});

app.delete('/api/serverMembers/:id', (req, res) => {
    const { id } = req.params;
    const db = readDatabase();
    db.serverMembers = db.serverMembers.filter(m => m.id !== id);
    if (writeDatabase(db)) {
        io.emit('members-updated', db.serverMembers);
        res.json({ success: true });
    } else {
        res.status(500).json({ error: 'Failed to remove member' });
    }
});

// Channel routes
app.get('/api/channels', (req, res) => {
    const db = readDatabase();
    res.json(db.channels);
});

app.post('/api/channels', (req, res) => {
    const { serverId, name } = req.body;
    const db = readDatabase();
    const newChannel = {
        id: generateId(),
        serverId,
        name,
        createdAt: new Date().toISOString()
    };
    db.channels.push(newChannel);
    if (writeDatabase(db)) {
        io.emit('channels-updated', db.channels);
        res.status(201).json(newChannel);
    } else {
        res.status(500).json({ error: 'Failed to create channel' });
    }
});

app.delete('/api/channels/:id', (req, res) => {
    const { id } = req.params;
    const db = readDatabase();
    db.messages = db.messages.filter(m => m.channelId !== id);
    db.channels = db.channels.filter(c => c.id !== id);
    if (writeDatabase(db)) {
        io.emit('channels-updated', db.channels);
        io.emit('messages-updated', db.messages);
        res.json({ success: true });
    } else {
        res.status(500).json({ error: 'Failed to delete channel' });
    }
});

// Message routes
app.get('/api/messages', (req, res) => {
    const db = readDatabase();
    res.json(db.messages);
});

app.post('/api/messages', (req, res) => {
    const { channelId, userId, username, content, fileUrl, fileType } = req.body;
    const db = readDatabase();
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
    db.messages.push(newMessage);
    if (writeDatabase(db)) {
        io.emit('messages-updated', db.messages);
        res.status(201).json(newMessage);
    } else {
        res.status(500).json({ error: 'Failed to send message' });
    }
});

app.put('/api/messages/:id', (req, res) => {
    const { id } = req.params;
    const { content } = req.body;
    const db = readDatabase();
    const messageIndex = db.messages.findIndex(m => m.id === id);
    if (messageIndex === -1) {
        return res.status(404).json({ error: 'Message not found' });
    }
    db.messages[messageIndex].content = content;
    db.messages[messageIndex].editedAt = new Date().toISOString();
    if (writeDatabase(db)) {
        io.emit('messages-updated', db.messages);
        res.json(db.messages[messageIndex]);
    } else {
        res.status(500).json({ error: 'Failed to update message' });
    }
});

app.delete('/api/messages/:id', (req, res) => {
    const { id } = req.params;
    const db = readDatabase();
    db.messages = db.messages.filter(m => m.id !== id);
    if (writeDatabase(db)) {
        io.emit('messages-updated', db.messages);
        res.json({ success: true });
    } else {
        res.status(500).json({ error: 'Failed to delete message' });
    }
});

// Socket.IO
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// mongodb, cloudinary
const { MongoClient } = require('mongodb');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// Konfigurasi Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.CLOUD_API_KEY,
    api_secret: process.env.CLOUD_API_SECRET
});

// Storage Cloudinary
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'discord-clone',
        allowed_formats: ['jpg', 'png', 'gif', 'mp4', 'pdf', 'zip', 'txt', 'docx'],
        resource_type: 'auto'
    }
});

const upload = multer({ storage: storage });

// Koneksi MongoDB
const client = new MongoClient(process.env.MONGODB_URI);
let db;

async function connectDB() {
    await client.connect();
    db = client.db('discord_clone');
    console.log('MongoDB connected');
}

// endpoint upload
app.post('/api/upload', upload.single('file'), (req, res) => {
    res.json({
        url: req.file.path,
        originalname: req.file.originalname,
        size: req.file.size,
        type: req.file.mimetype.split('/')[0]
    });
});