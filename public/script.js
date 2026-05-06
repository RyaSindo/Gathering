// Socket.IO connection
const socket = io();

// API Configuration
const API_URL = window.location.origin + '/api';

// Data Storage
let currentUser = null;
let users = [];
let servers = [];
let serverMembers = [];
let channels = [];
let messages = [];
let currentServerId = null;
let currentChannelId = null;
let editingMessageId = null;
let selectedMemberId = null;
let selectedMemberName = null;

// File upload queue
let pendingFile = null;
let pendingFileType = null;
let pendingFileUrl = null;
let pendingFileObject = null;
let pendingFileOriginalName = null;
let pendingFileSize = null;

// Helper Functions
function showNotification(message, type = 'info') {
    const colors = {
        success: '#3ba55d',
        error: '#ed4245',
        info: '#5865f2'
    };
    
    let notification = document.getElementById('notification');
    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'notification';
        document.body.appendChild(notification);
    }
    
    notification.style.backgroundColor = colors[type];
    notification.textContent = message;
    notification.style.display = 'block';
    notification.style.animation = 'slideIn 0.3s ease';
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            notification.style.display = 'none';
        }, 300);
    }, 3000);
}

// Detect GIF URL from message
function detectGifUrl(text) {
    const gifRegex = /(https?:\/\/[^\s]+\.(?:gif|giphy|tenor)[^\s]*)/gi;
    const match = text.match(gifRegex);
    return match ? match[0] : null;
}

// Get file icon based on extension
function getFileIcon(filename) {
    if (!filename) return 'fa-file';
    const ext = filename.split('.').pop().toLowerCase();
    const iconMap = {
        'pdf': 'fa-file-pdf',
        'doc': 'fa-file-word',
        'docx': 'fa-file-word',
        'xls': 'fa-file-excel',
        'xlsx': 'fa-file-excel',
        'ppt': 'fa-file-powerpoint',
        'pptx': 'fa-file-powerpoint',
        'txt': 'fa-file-alt',
        'zip': 'fa-file-archive',
        'rar': 'fa-file-archive',
        '7z': 'fa-file-archive',
        'jar': 'fa-file-code',
        'exe': 'fa-file-code',
        'mp3': 'fa-file-audio',
        'wav': 'fa-file-audio',
        'mp4': 'fa-file-video',
        'mov': 'fa-file-video',
        'avi': 'fa-file-video',
        'mkv': 'fa-file-video',
        'jpg': 'fa-file-image',
        'jpeg': 'fa-file-image',
        'png': 'fa-file-image',
        'gif': 'fa-file-image',
        'webp': 'fa-file-image',
        'json': 'fa-file-code',
        'xml': 'fa-file-code',
        'html': 'fa-file-code',
        'css': 'fa-file-code',
        'js': 'fa-file-code'
    };
    return iconMap[ext] || 'fa-file';
}

// FUNGSI UNTUK CEK OWNER DAN ROLE

function getUserRoleInServer(serverId, userId) {
    const member = serverMembers.find(m => m.serverId === serverId && m.userId === userId);
    return member ? member.role : null;
}

function isOwner(serverId, userId) {
    const server = servers.find(s => s.id === serverId);
    if (server && server.ownerId === userId) return true;
    const member = serverMembers.find(m => m.serverId === serverId && m.userId === userId);
    return member && member.role === 'owner';
}

function isModerator(serverId, userId) {
    const member = serverMembers.find(m => m.serverId === serverId && m.userId === userId);
    return member && member.role === 'moderator';
}

// Cek user bisa hapus chat
function canDeleteMessage(message, currentUserId, currentServerId) {
    const messageUserId = message.userId;
    const messageAuthorRole = getUserRoleInServer(currentServerId, messageUserId);
    const currentUserRole = getUserRoleInServer(currentServerId, currentUserId);
    
    // Owner: bisa menghapus semua pesan (termasuk owner sendiri)
    if (currentUserRole === 'owner') {
        return true;
    }
    
    // Moderator: bisa menghapus pesan dari member dan moderator (tidak bisa owner)
    if (currentUserRole === 'moderator') {
        return messageAuthorRole !== 'owner';
    }
    
    // Member: hanya bisa menghapus pesan sendiri
    return messageUserId === currentUserId;
}

// Cek apakah user bisa membuat channel
function canCreateChannel(serverId, userId) {
    const userRole = getUserRoleInServer(serverId, userId);
    // Owner dan moderator bisa membuat channel
    return userRole === 'owner' || userRole === 'moderator';
}

// Cek apakah user bisa menghapus channel
function canDeleteChannel(serverId, userId) {
    const userRole = getUserRoleInServer(serverId, userId);
    // Hanya owner yang bisa menghapus channel
    return userRole === 'owner' || userRole === 'moderator';
}

// Cek apakah user bisa mengelola member (ubah role)
function canManageMembers(serverId, userId) {
    // Hanya owner yang bisa mengubah role member
    return isOwner(serverId, userId);
}

// Cek apakah user bisa menghapus server
function canDeleteServer(serverId, userId) {
    // Hanya owner yang bisa menghapus server
    return isOwner(serverId, userId);
}

// delete massage
async function deleteMessage(messageId) {
    const message = messages.find(m => m.id === messageId);
    if (!message) return;
    
    // Cek permission sebelum menghapus
    if (!canDeleteMessage(message, currentUser.id, currentServerId)) {
        showNotification('Anda tidak memiliki izin untuk menghapus pesan ini!', 'error');
        return;
    }
    
    if (confirm('Hapus pesan ini?')) {
        await fetch(`${API_URL}/messages/${messageId}`, { method: 'DELETE' });
        // Pesan akan terupdate via socket
    }
}

// 

// FILE PREVIEW AREA

function showPreviewArea(file, fileType, previewUrl) {
    const previewArea = document.getElementById('filePreviewArea');
    const previewContent = document.getElementById('filePreviewContent');
    const removeBtn = document.getElementById('removeFilePreviewBtn');
    
    if (!previewArea || !previewContent) return;
    
    const fileSize = (file.size / 1024 / 1024).toFixed(2);
    const fileExt = file.name.split('.').pop().toUpperCase();
    
    let previewHtml = '';
    
    if (fileType === 'image' && previewUrl) {
        previewHtml = `
            <div class="preview-image-container">
                <img src="${previewUrl}" class="preview-image" alt="Preview">
                <div class="preview-file-info">
                    <span class="file-name">${escapeHtml(file.name)}</span>
                    <span class="file-size">${fileSize} MB</span>
                </div>
            </div>
        `;
    } else if (fileType === 'video' && previewUrl) {
        previewHtml = `
            <div class="preview-video-container">
                <video src="${previewUrl}" class="preview-video" controls></video>
                <div class="preview-file-info">
                    <span class="file-name">${escapeHtml(file.name)}</span>
                    <span class="file-size">${fileSize} MB</span>
                </div>
            </div>
        `;
    } else {
        const fileIcon = getFileIcon(file.name);
        previewHtml = `
            <div class="preview-file">
                <i class="fas ${fileIcon}"></i>
                <div class="file-info">
                    <span class="file-name">${escapeHtml(file.name)}</span>
                    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                        <small class="file-size">${fileSize} MB</small>
                        <span class="file-type-badge">${fileExt}</span>
                    </div>
                </div>
            </div>
        `;
    }
    
    previewContent.innerHTML = previewHtml;
    previewArea.style.display = 'block';
    
    if (removeBtn) {
        removeBtn.onclick = () => {
            clearFilePreview();
        };
    }
}

function clearFilePreview() {
    const previewArea = document.getElementById('filePreviewArea');
    if (previewArea) {
        previewArea.style.display = 'none';
        const previewContent = document.getElementById('filePreviewContent');
        if (previewContent) previewContent.innerHTML = '';
    }
    
    pendingFile = null;
    pendingFileType = null;
    pendingFileUrl = null;
    pendingFileObject = null;
    pendingFileOriginalName = null;
    pendingFileSize = null;
}

// Upload file and show preview
async function uploadFileAndPreview(file) {
    console.log('Uploading file:', file.name, file.type);
    
    let fileType = 'file';
    const ext = file.name.split('.').pop().toLowerCase();
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
    const videoExts = ['mp4', 'webm', 'mov', 'avi', 'mkv'];
    
    if (imageExts.includes(ext)) {
        fileType = 'image';
    } else if (videoExts.includes(ext)) {
        fileType = 'video';
    } else {
        fileType = ext;
    }
    
    pendingFileType = fileType;
    pendingFileObject = file;
    
    let previewUrl = null;
    if (fileType === 'image' || fileType === 'video') {
        previewUrl = URL.createObjectURL(file);
    }
    
    showPreviewArea(file, fileType, previewUrl);
    
    showNotification('Mengupload file...', 'info');
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        if (response.ok) {
            const result = await response.json();
            pendingFile = result;
            pendingFileUrl = result.url;
            pendingFileOriginalName = result.originalname;
            pendingFileSize = result.size || file.size;
            pendingFileType = result.type || fileType;
            console.log('Upload success:', result);
            showNotification(`File "${file.name}" siap dikirim!`, 'success');
        } else {
            const error = await response.json();
            showNotification('Upload gagal: ' + (error.error || 'Unknown error'), 'error');
            clearFilePreview();
        }
    } catch (error) {
        console.error('Upload error:', error);
        showNotification('Error upload: ' + error.message, 'error');
        clearFilePreview();
    }

}

// Send message with file
async function sendMessageWithFile(content, fileUrl, fileType, originalname = null, fileSize = null) {
    if (!currentChannelId) {
        showNotification('Pilih channel terlebih dahulu', 'error');
        return false;
    }
    
    const response = await fetch(`${API_URL}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            channelId: currentChannelId,
            userId: currentUser.id,
            username: currentUser.username,
            content: content || '',
            fileUrl: fileUrl || null,
            fileType: fileType || null,
            originalname: originalname,
            fileSize: fileSize || null
        })
    });
    
    if (!response.ok) {
        const error = await response.json();
        showNotification('Gagal mengirim pesan: ' + (error.error || 'Unknown error'), 'error');
        return false;
    }
    
    return true;
}

async function sendMessage(content) {
    if (!content.trim() && !pendingFile) {
        showNotification('Tulis pesan atau pilih file terlebih dahulu', 'error');
        return;
    }
    
    if (!currentChannelId) {
        showNotification('Pilih channel terlebih dahulu', 'error');
        return;
    }
    
    // Cek apakah ada GIF URL dalam pesan
    const gifUrl = detectGifUrl(content);
    if (gifUrl && !pendingFile) {
        await sendMessageWithFile('', gifUrl, 'gif');
        document.getElementById('messageInput').value = '';
        clearFilePreview();
        return;
    }
    
    // Kirim pesan dengan file yang sudah diupload
    if (pendingFile && pendingFileUrl) {
        const success = await sendMessageWithFile(content, pendingFileUrl, pendingFileType, pendingFileOriginalName, pendingFileSize);
        if (success) {
            document.getElementById('messageInput').value = '';
            clearFilePreview();
        }
    } else if (pendingFileObject && !pendingFileUrl) {
        showNotification('Tunggu hingga file selesai diupload', 'error');
        return;
    } else {
        const success = await sendMessageWithFile(content, null, null);
        if (success) {
            document.getElementById('messageInput').value = '';
        }
    }
    
    document.getElementById('messageInput').focus();
}

// API Functions
async function loadData() {
    try {
        const [usersRes, serversRes, membersRes, channelsRes, messagesRes] = await Promise.all([
            fetch(`${API_URL}/users`),
            fetch(`${API_URL}/servers`),
            fetch(`${API_URL}/serverMembers`),
            fetch(`${API_URL}/channels`),
            fetch(`${API_URL}/messages`)
        ]);
        
        users = await usersRes.json();
        servers = await serversRes.json();
        serverMembers = await membersRes.json();
        channels = await channelsRes.json();
        messages = await messagesRes.json();
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

async function login(username, password) {
    try {
        const response = await fetch(`${API_URL}/users/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        if (response.ok) {
            currentUser = await response.json();
            localStorage.setItem('discord_current_user', JSON.stringify(currentUser));
            return { success: true };
        } else {
            const error = await response.json();
            return { success: false, message: error.error };
        }
    } catch (error) {
        return { success: false, message: 'Login gagal' };
    }
}

async function register(username, email, password, confirmPassword) {
    if (password !== confirmPassword) {
        return { success: false, message: 'Password tidak cocok' };
    }
    
    if (password.length < 6) {
        return { success: false, message: 'Password minimal 6 karakter' };
    }
    
    try {
        const response = await fetch(`${API_URL}/users/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });
        
        if (response.ok) {
            return { success: true, message: 'Registrasi berhasil! Silakan login.' };
        } else {
            const error = await response.json();
            return { success: false, message: error.error };
        }
    } catch (error) {
        return { success: false, message: 'Registrasi gagal' };
    }
}

function logout() {
    currentUser = null;
    localStorage.removeItem('discord_current_user');
    currentServerId = null;
    currentChannelId = null;
    clearFilePreview();
}

function checkLogin() {
    const saved = localStorage.getItem('discord_current_user');
    if (saved) {
        currentUser = JSON.parse(saved);
        return true;
    }
    return false;
}

function getUserServers() {
    const userMemberships = serverMembers.filter(m => m.userId === currentUser.id);
    return servers.filter(s => userMemberships.some(m => m.serverId === s.id));
}

async function createServer(name) {
    const response = await fetch(`${API_URL}/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ownerId: currentUser.id })
    });
    
    if (response.ok) {
        const newServer = await response.json();
        
        await fetch(`${API_URL}/serverMembers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serverId: newServer.id, userId: currentUser.id })
        });
        
        // Update role menjadi owner
        const ownerMember = serverMembers.find(m => m.serverId === newServer.id && m.userId === currentUser.id);
        if (ownerMember) {
            await fetch(`${API_URL}/serverMembers/${ownerMember.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: 'owner' })
            });
        }
        
        await fetch(`${API_URL}/channels`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serverId: newServer.id, name: 'umum' })
        });
        
        await loadData();
        showNotification(`Server "${name}" berhasil dibuat! Kode: ${newServer.inviteCode}`, 'success');
        return newServer;
    }
    return null;
}

async function deleteServer(serverId) {
    if (!isOwner(serverId, currentUser.id)) {
        showNotification('Hanya owner yang bisa menghapus server!', 'error');
        return false;
    }
    
    const server = servers.find(s => s.id === serverId);
    if (!server) return false;
    
    if (confirm(`Apakah Anda yakin ingin menghapus server "${server.name}"?`)) {
        await fetch(`${API_URL}/servers/${serverId}`, { method: 'DELETE' });
        
        const relatedMembers = serverMembers.filter(m => m.serverId === serverId);
        for (const member of relatedMembers) {
            await fetch(`${API_URL}/serverMembers/${member.id}`, { method: 'DELETE' });
        }
        
        const relatedChannels = channels.filter(c => c.serverId === serverId);
        for (const channel of relatedChannels) {
            await fetch(`${API_URL}/channels/${channel.id}`, { method: 'DELETE' });
        }
        
        await loadData();
        
        if (currentServerId === serverId) {
            const userServers = getUserServers();
            if (userServers.length > 0) {
                selectServer(userServers[0].id);
            } else {
                currentServerId = null;
                currentChannelId = null;
                renderServers();
                renderChannels();
                renderMessages();
                updateServerInfo();
            }
        }
        
        showNotification(`Server "${server.name}" berhasil dihapus`, 'success');
        return true;
    }
    return false;
}

async function joinServer(inviteCode) {
    const cleanCode = inviteCode.trim().toUpperCase();
    const server = servers.find(s => s.inviteCode === cleanCode);
    
    if (!server) {
        showNotification('Kode invite tidak valid!', 'error');
        return { success: false };
    }
    
    const alreadyMember = serverMembers.some(m => m.serverId === server.id && m.userId === currentUser.id);
    if (alreadyMember) {
        showNotification('Anda sudah menjadi member server ini!', 'info');
        return { success: false };
    }
    
    await fetch(`${API_URL}/serverMembers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId: server.id, userId: currentUser.id })
    });
    
    await loadData();
    showNotification(`Berhasil bergabung ke server ${server.name}!`, 'success');
    return { success: true, server };
}

async function addChannel(serverId, name) {
    await fetch(`${API_URL}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, name })
    });
    
    await loadData();
    renderChannels();
    showNotification(`Channel #${name} dibuat`, 'success');
}


// delete channel
async function deleteChannel(channelId) {
    if (!canDeleteChannel(currentServerId, currentUser.id)) {
        showNotification('Hanya owner yang bisa menghapus channel!', 'error');
        return;
    }
    
    const channel = channels.find(c => c.id === channelId);
    if (!channel) return;
    
    if (confirm(`Hapus channel #${channel.name}?`)) {
        await fetch(`${API_URL}/channels/${channelId}`, { method: 'DELETE' });
        await loadData();
        
        if (currentChannelId === channelId) {
            const serverChannels = channels.filter(c => c.serverId === currentServerId);
            if (serverChannels.length > 0) {
                selectChannel(serverChannels[0].id);
            } else {
                currentChannelId = null;
                renderMessages();
            }
        }
        
        renderChannels();
        showNotification(`Channel #${channel.name} berhasil dihapus`, 'success');
    }
}

async function updateMemberRole(memberId, newRole) {
    const member = serverMembers.find(m => m.id === memberId);
    if (!member) return;
    
    if (!isOwner(member.serverId, currentUser.id)) {
        showNotification('Hanya owner yang bisa mengatur role member!', 'error');
        return;
    }
    
    if (member.role === 'owner') {
        showNotification('Tidak bisa mengubah role owner!', 'error');
        return;
    }
    
    await fetch(`${API_URL}/serverMembers/${memberId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole })
    });
    
    await loadData();
    renderMembers();
    showNotification(`Role member berhasil diubah menjadi ${newRole}`, 'success');
}

// Render Functions
function renderServers() {
    const container = document.getElementById('serverList');
    if (!container) return;
    
    const userServers = getUserServers();
    
    if (userServers.length === 0) {
        container.innerHTML = '<div style="padding: 16px; text-align: center; color: #949ba4;"><i class="fas fa-server"></i><br>Belum ada server<br>Buat atau join server</div>';
        return;
    }
    
    container.innerHTML = '';
    userServers.forEach(server => {
        const isUserOwner = isOwner(server.id, currentUser.id);
        
        const div = document.createElement('div');
        div.className = `server-item ${currentServerId === server.id ? 'active' : ''}`;
        div.innerHTML = `
            <div class="server-name">
                ${escapeHtml(server.name)}
            </div>
            <div class="server-actions">
                <button class="invite-server" data-id="${server.id}" title="Undang Teman">
                    <i class="fas fa-user-plus"></i>
                </button>
                ${isUserOwner ? `
                    <button class="delete-server-btn" data-id="${server.id}" title="Hapus Server">
                        <i class="fas fa-trash"></i>
                    </button>
                ` : `
                    <button class="leave-server-btn" data-id="${server.id}" title="Keluar dari Server">
                        <i class="fas fa-sign-out-alt"></i>
                    </button>
                `}
            </div>
        `;
        
        div.addEventListener('click', (e) => {
            if (!e.target.closest('.server-actions')) {
                selectServer(server.id);
            }
        });
        
        container.appendChild(div);
    });
    
    // Event listeners untuk tombol invite
    document.querySelectorAll('.invite-server').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const server = servers.find(s => s.id === btn.dataset.id);
            if (server) showInviteModal(server);
        });
    });
    
    // Event listeners untuk tombol hapus server (owner)
    document.querySelectorAll('.delete-server-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteServer(btn.dataset.id);
        });
    });
    
    // Event listeners untuk tombol keluar server (non-owner)
    document.querySelectorAll('.leave-server-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            leaveServer(btn.dataset.id);
        });
    });
}

function selectServer(serverId) {
    currentServerId = serverId;
    currentChannelId = null;
    renderServers();
    updateServerInfo();
    clearFilePreview();
    
    // Update mobile header title
    const mobileServerName = document.getElementById('mobileServerName');
    const server = servers.find(s => s.id === serverId);
    if (mobileServerName && server) {
        mobileServerName.textContent = server.name;
    }
    
    const serverChannels = channels.filter(c => c.serverId === serverId);
    if (serverChannels.length > 0) {
        selectChannel(serverChannels[0].id);
    } else {
        renderChannels();
        renderMessages();
    }
    
    renderMembers();
}

function updateServerInfo() {
    const serverNameEl = document.getElementById('currentServerName');
    const serverMembersEl = document.getElementById('serverMembers');
    
    if (currentServerId) {
        const server = servers.find(s => s.id === currentServerId);
        if (server && serverNameEl) {
            serverNameEl.textContent = server.name;
        }
        if (serverMembersEl) {
            const members = serverMembers.filter(m => m.serverId === currentServerId).length;
            serverMembersEl.textContent = `${members} members`;
        }
    } else {
        if (serverNameEl) serverNameEl.textContent = 'Pilih Server';
        if (serverMembersEl) serverMembersEl.textContent = '';
    }
}

function renderChannels() {
    const container = document.getElementById('channelList');
    if (!container) return;
    
    if (!currentServerId) {
        container.innerHTML = '<div style="padding: 12px; text-align: center; color: #949ba4;"><i class="fas fa-hashtag"></i> Pilih server</div>';
        return;
    }
    
    const serverChannels = channels.filter(c => c.serverId === currentServerId);
    const canDelete = isOwner(currentServerId, currentUser.id);
    
    if (serverChannels.length === 0) {
        container.innerHTML = '<div style="padding: 12px; text-align: center; color: #949ba4;"><i class="fas fa-hashtag"></i> Tidak ada channel</div>';
        return;
    }
    
    container.innerHTML = '';
    serverChannels.forEach(channel => {
        const div = document.createElement('div');
        div.className = `channel-item ${currentChannelId === channel.id ? 'active' : ''}`;
        div.innerHTML = `
            <div class="channel-name">
                <i class="fas fa-hashtag"></i> ${escapeHtml(channel.name)}
            </div>
            ${canDelete ? `
                <div class="channel-actions">
                    <button class="delete-channel-btn" data-id="${channel.id}" title="Hapus Channel">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            ` : ''}
        `;
        
        div.addEventListener('click', (e) => {
            if (!e.target.closest('.channel-actions')) {
                selectChannel(channel.id);
            }
        });
        
        container.appendChild(div);
    });
    
    document.querySelectorAll('.delete-channel-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteChannel(btn.dataset.id);
        });
    });
}

function selectChannel(channelId) {
    currentChannelId = channelId;
    renderChannels();
    clearFilePreview();
    
    const channel = channels.find(c => c.id === channelId);
    const channelNameEl = document.getElementById('currentChannelName');
    if (channel && channelNameEl) {
        channelNameEl.innerHTML = `<i class="fas fa-hashtag"></i> ${channel.name}`;
    }
    renderMessages();
}

function renderMessages() {
    const container = document.getElementById('messagesContainer');
    if (!container) return;
    
    if (!currentChannelId) {
        container.innerHTML = '<div class="welcome-message"><h2>Pilih channel</h2><p>Pilih channel untuk mulai chatting</p></div>';
        return;
    }
    
    const channelMessages = messages.filter(m => m.channelId === currentChannelId);
    
    if (channelMessages.length === 0) {
        container.innerHTML = '<div class="welcome-message"><i class="fas fa-comment-dots" style="font-size: 48px; margin-bottom: 20px;"></i><h2>Belum ada pesan</h2><p>Kirim pesan pertama!</p></div>';
        return;
    }
    
    container.innerHTML = '';
    channelMessages.forEach(msg => {
        const div = document.createElement('div');
        div.className = 'message';
        const date = new Date(msg.timestamp);
        const timeStr = date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        
        // Cek user role
        const canDelete = canDeleteMessage(msg, currentUser.id, currentServerId);

        let fileHtml = '';
        if (msg.fileUrl) {
            // GUNAKAN NAMA ASLI FILE dari database
            let fileName = msg.originalname;
            
            // Fallback jika originalname tidak ada (data lama)
            if (!fileName || fileName === 'file' || fileName === 'Download') {
                // Ambil dari URL sebagai fallback
                const urlParts = msg.fileUrl.split('/');
                fileName = urlParts[urlParts.length - 1] || 'file';
                // Hapus timestamp dan random prefix jika ada
                const match = fileName.match(/^\d+-\w+-(.+)$/);
                if (match) {
                    fileName = match[1];
                }
            }
            
            const fileExt = fileName.split('.').pop().toLowerCase();
            const isImage = msg.fileType === 'image' || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(fileExt);
            const isVideo = msg.fileType === 'video' || ['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(fileExt);
            const fileSize = msg.fileSize ? (msg.fileSize / 1024 / 1024).toFixed(2) + ' MB' : '';
            
            if (isImage) {
                fileHtml = `<div class="message-file"><img src="${msg.fileUrl}" alt="${escapeHtml(fileName)}" onclick="window.open('${msg.fileUrl}')"></div>`;
            } else if (isVideo) {
                fileHtml = `<div class="message-file"><video controls src="${msg.fileUrl}"></video></div>`;
            } else {
                const fileIcon = getFileIcon(fileName);
                fileHtml = `
                    <div class="message-file">
                        <a href="${msg.fileUrl}" target="_blank" class="file-attachment">
                            <i class="fas ${fileIcon}"></i>
                            <div class="file-info">
                                <span class="file-name">${escapeHtml(fileName)}</span>
                                ${fileSize ? `<small class="file-size">${fileSize}</small>` : ''}
                                <small class="file-extension">${fileExt.toUpperCase()}</small>
                            </div>
                        </a>
                    </div>
                `;
            }
        }
        
        div.innerHTML = `
            <div class="message-header">
                <span class="message-author">${escapeHtml(msg.username)}</span>
                <span class="message-time">${timeStr}</span>
                ${msg.editedAt ? '<span class="edited-indicator">(edited)</span>' : ''}
            </div>
            ${fileHtml}
            ${msg.content ? `<div class="message-text">${escapeHtml(msg.content)}</div>` : ''}
            ${canDelete ? `
                <div class="message-actions">
                    ${msg.userId === currentUser.id && msg.content ? `<button class="edit-msg" data-id="${msg.id}"><i class="fas fa-edit"></i> Edit</button>` : ''}
                    <button class="delete-msg" data-id="${msg.id}"><i class="fas fa-trash"></i> Hapus</button>
                </div>
            ` : ''}
                
        `;
        
        container.appendChild(div);
    });
    
    document.querySelectorAll('.edit-msg').forEach(btn => {
        btn.addEventListener('click', () => {
            const msg = messages.find(m => m.id === btn.dataset.id);
            if (msg && msg.userId === currentUser.id) {
                editingMessageId = msg.id;
                const editInput = document.getElementById('editMessageInput');
                if (editInput) editInput.value = msg.content;
                const editModal = document.getElementById('editMessageModal');
                if (editModal) editModal.style.display = 'flex';
            }
        });
    });
    
    document.querySelectorAll('.delete-msg').forEach(btn => {
        btn.addEventListener('click', async () => {
            const messageId = btn.dataset.id;
            const message = messages.find(m => m.id === messageId);
            if (message && canDeleteMessage(message, currentUser.id, currentServerId)) {
                if (confirm('Hapus pesan ini?')) {
                    await fetch(`${API_URL}/messages/${messageId}`, { method: 'DELETE' });
                }
            } else {
                showNotification('Anda tidak memiliki izin untuk menghapus pesan ini!', 'error');
            }
        });
    });
    
    container.scrollTop = container.scrollHeight;
}

// ls fungsi
function renderChannels() {
    const container = document.getElementById('channelList');
    if (!container) return;
    
    if (!currentServerId) {
        container.innerHTML = '<div style="padding: 12px; text-align: center; color: #949ba4;"><i class="fas fa-hashtag"></i> Pilih server</div>';
        return;
    }
    
    const serverChannels = channels.filter(c => c.serverId === currentServerId);
    const canDelete = canDeleteChannel(currentServerId, currentUser.id);
    const canCreate = canCreateChannel(currentServerId, currentUser.id);
    
    // Tampilkan/hide tombol add channel berdasarkan permission
    const addChannelBtn = document.getElementById('addChannelBtn');
    if (addChannelBtn) {
        addChannelBtn.style.display = canCreate ? 'block' : 'none';
    }
    
    if (serverChannels.length === 0) {
        container.innerHTML = '<div style="padding: 12px; text-align: center; color: #949ba4;"><i class="fas fa-hashtag"></i> Tidak ada channel</div>';
        return;
    }
    
    container.innerHTML = '';
    serverChannels.forEach(channel => {
        const div = document.createElement('div');
        div.className = `channel-item ${currentChannelId === channel.id ? 'active' : ''}`;
        div.innerHTML = `
            <div class="channel-name">
                <i class="fas fa-hashtag"></i> ${escapeHtml(channel.name)}
            </div>
            ${canDelete ? `
                <div class="channel-actions">
                    <button class="delete-channel-btn" data-id="${channel.id}" title="Hapus Channel">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            ` : ''}
        `;
        
        div.addEventListener('click', (e) => {
            if (!e.target.closest('.channel-actions')) {
                selectChannel(channel.id);
            }
        });
        
        container.appendChild(div);
    });
    
    document.querySelectorAll('.delete-channel-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (canDeleteChannel(currentServerId, currentUser.id)) {
                deleteChannel(btn.dataset.id);
            } else {
                showNotification('Hanya owner yang bisa menghapus channel!', 'error');
            }
        });
    });
}

// add channel fungsi
async function addChannel(serverId, name) {
    // Cek permission sebelum membuat channel
    if (!canCreateChannel(serverId, currentUser.id)) {
        showNotification('Anda tidak memiliki izin untuk membuat channel!', 'error');
        return;
    }
    
    await fetch(`${API_URL}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, name })
    });
    
    await loadData();
    renderChannels();
    showNotification(`Channel #${name} dibuat`, 'success');
}

// render members fungsi
function renderMembers() {
    const container = document.getElementById('membersList');
    if (!container) return;
    
    if (!currentServerId) {
        container.innerHTML = '<div style="padding: 12px; text-align: center; color: #949ba4;"><i class="fas fa-users"></i><br>Pilih server</div>';
        return;
    }
    
    const members = serverMembers.filter(m => m.serverId === currentServerId);
    const currentUserIsOwner = isOwner(currentServerId, currentUser.id);
    
    if (members.length === 0) {
        container.innerHTML = '<div style="padding: 12px; text-align: center; color: #949ba4;"><i class="fas fa-users"></i><br>Tidak ada member</div>';
        return;
    }
    
    container.innerHTML = '';
    members.forEach(member => {
        const user = users.find(u => u.id === member.userId);
        if (user) {
            const isMemberOwner = member.role === 'owner' || (servers.find(s => s.id === currentServerId)?.ownerId === member.userId);
            const isMemberModerator = member.role === 'moderator';
            
            let roleBadge = '';
            if (isMemberOwner) {
                roleBadge = '<span class="owner-badge">👑</span>';
            } else if (isMemberModerator) {
                roleBadge = '<span class="moderator-badge">🛡️</span>';
            }
            
            const div = document.createElement('div');
            div.className = 'member-item';
            div.innerHTML = `
                <div class="member-info">
                    <div class="member-avatar">${user.avatar}</div>
                    <div class="member-name">
                        ${escapeHtml(user.username)} ${roleBadge}
                    </div>
                </div>
                ${currentUserIsOwner && !isMemberOwner && member.userId !== currentUser.id ? `
                    <button class="member-role-btn" data-member-id="${member.id}" data-member-name="${escapeHtml(user.username)}">
                        <i class="fas fa-user-cog"></i>
                    </button>
                ` : ''}
            `;
            container.appendChild(div);
        }
    });
    
    document.querySelectorAll('.member-role-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedMemberId = btn.dataset.memberId;
            selectedMemberName = btn.dataset.memberName;
            document.getElementById('roleMemberName').innerHTML = `Member: ${selectedMemberName}`;
            document.getElementById('roleModal').style.display = 'flex';
        });
    });
}

function showInviteModal(server) {
    const inviteCodeInput = document.getElementById('inviteCode');
    if (inviteCodeInput) inviteCodeInput.value = server.inviteCode;
    const inviteModal = document.getElementById('inviteModal');
    if (inviteModal) inviteModal.style.display = 'flex';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function closeModals() {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        modal.style.display = 'none';
    });
}

// Setup Emoji Picker
function setupEmojiPicker() {
    const emojis = ['😀', '😂', '🥰', '😎', '🤔', '😢', '😡', '👍', '🙏', '💀', '❤️', '🎉', '🔥', '✨', '⭐', '💯', '👋', '🙌', '🤝', '💪', '🧠', '👀', '💡', '🔑', '📚', '🎮', '⚽', '🏀', '🎵', '🎨'];
    
    const container = document.getElementById('stickerGrid');
    if (!container) return;
    container.innerHTML = '';
    
    emojis.forEach(emoji => {
        const div = document.createElement('div');
        div.className = 'sticker';
        div.textContent = emoji;
        div.dataset.sticker = emoji;
        div.addEventListener('click', async () => {
            const messageInput = document.getElementById('messageInput');
            if (messageInput) {
                messageInput.value += emoji;
            }
            closeModals();
            if (messageInput) messageInput.focus();
        });
        container.appendChild(div);
    });
}

// Setup File Upload
function setupFileUpload() {
    const fileInput = document.getElementById('fileInput');
    if (!fileInput) return;
    
    document.getElementById('uploadImageBtn').addEventListener('click', () => {
        fileInput.accept = 'image/jpeg,image/png,image/webp,image/gif';
        fileInput.click();
    });
    
    document.getElementById('uploadVideoBtn').addEventListener('click', () => {
        fileInput.accept = 'video/mp4,video/webm';
        fileInput.click();
    });
    
    document.getElementById('uploadFileBtn').addEventListener('click', () => {
        fileInput.accept = '*/*';
        fileInput.click();
    });
    
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            await uploadFileAndPreview(file);
        }
        fileInput.value = '';
    });
}

// Mobile Menu Functions
function initMobileMenu() {
    const leftSidebar = document.getElementById('leftSidebar');
    const rightSidebar = document.getElementById('rightSidebar');
    const toggleLeftBtn = document.getElementById('toggleLeftMenu');
    const toggleRightBtn = document.getElementById('toggleRightMenu');
    const closeLeftBtn = document.getElementById('closeLeftMenu');
    const closeRightBtn = document.getElementById('closeRightMenu');
    
    if (toggleLeftBtn) {
        toggleLeftBtn.addEventListener('click', () => {
            leftSidebar.classList.add('open');
        });
    }
    
    if (toggleRightBtn) {
        toggleRightBtn.addEventListener('click', () => {
            rightSidebar.classList.add('open');
        });
    }
    
    if (closeLeftBtn) {
        closeLeftBtn.addEventListener('click', () => {
            leftSidebar.classList.remove('open');
        });
    }
    
    if (closeRightBtn) {
        closeRightBtn.addEventListener('click', () => {
            rightSidebar.classList.remove('open');
        });
    }
    
    // Close menus when clicking outside (for mobile)
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
            if (leftSidebar && leftSidebar.classList.contains('open')) {
                if (!leftSidebar.contains(e.target) && !toggleLeftBtn.contains(e.target)) {
                    leftSidebar.classList.remove('open');
                }
            }
            
            if (rightSidebar && rightSidebar.classList.contains('open')) {
                if (!rightSidebar.contains(e.target) && !toggleRightBtn.contains(e.target)) {
                    rightSidebar.classList.remove('open');
                }
            }
        }
    });
}

// Socket.IO Real-time Events
function setupSocketEvents() {
    socket.on('servers-updated', async (updatedServers) => {
        servers = updatedServers;
        renderServers();
        updateServerInfo();
    });
    
    socket.on('members-updated', async (updatedMembers) => {
        serverMembers = updatedMembers;
        renderMembers();
        if (currentServerId) {
            const membersCount = serverMembers.filter(m => m.serverId === currentServerId).length;
            const serverMembersEl = document.getElementById('serverMembers');
            if (serverMembersEl) {
                serverMembersEl.textContent = `${membersCount} members`;
            }
        }
    });
    
    socket.on('channels-updated', async (updatedChannels) => {
        channels = updatedChannels;
        renderChannels();
        if (currentChannelId && !channels.find(c => c.id === currentChannelId)) {
            const serverChannels = channels.filter(c => c.serverId === currentServerId);
            if (serverChannels.length > 0) {
                selectChannel(serverChannels[0].id);
            } else {
                currentChannelId = null;
                renderMessages();
            }
        }
    });
    
    socket.on('messages-updated', async (updatedMessages) => {
        messages = updatedMessages;
        if (currentChannelId) {
            renderMessages();
        }
    });
}

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
    console.log('App initializing...');
    await loadData();
    setupEmojiPicker();
    setupSocketEvents();
    initMobileMenu();
    
    if (checkLogin()) {
        const authPage = document.getElementById('authPage');
        const mainApp = document.getElementById('mainApp');
        const currentUsernameSpan = document.getElementById('currentUsername');
        const userAvatarDiv = document.getElementById('userAvatar');
        
        if (authPage) authPage.style.display = 'none';
        if (mainApp) mainApp.style.display = 'flex';
        if (currentUsernameSpan) currentUsernameSpan.textContent = currentUser.username;
        if (userAvatarDiv) userAvatarDiv.textContent = currentUser.avatar;
        
        const userServers = getUserServers();
        if (userServers.length > 0) {
            selectServer(userServers[0].id);
        } else {
            renderServers();
        }
        
        setupFileUpload();
    }
    
    // Auth tab switching
    const authTabs = document.querySelectorAll('.auth-tab');
    authTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            authTabs.forEach(t => t.classList.remove('active'));
            const forms = document.querySelectorAll('.auth-form');
            forms.forEach(f => f.classList.remove('active'));
            tab.classList.add('active');
            const formId = `${tab.dataset.tab}Form`;
            const form = document.getElementById(formId);
            if (form) form.classList.add('active');
        });
    });
    
    // Login
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            const username = document.getElementById('loginUsername').value;
            const password = document.getElementById('loginPassword').value;
            const result = await login(username, password);
            
            if (result.success) {
                document.getElementById('authPage').style.display = 'none';
                document.getElementById('mainApp').style.display = 'flex';
                document.getElementById('currentUsername').textContent = currentUser.username;
                document.getElementById('userAvatar').textContent = currentUser.avatar;
                
                const userServers = getUserServers();
                if (userServers.length > 0) {
                    selectServer(userServers[0].id);
                } else {
                    renderServers();
                }
                
                setupFileUpload();
            } else {
                document.getElementById('loginError').textContent = result.message;
            }
        });
    }
    
    // Register
    const registerBtn = document.getElementById('registerBtn');
    if (registerBtn) {
        registerBtn.addEventListener('click', async () => {
            const username = document.getElementById('regUsername').value;
            const email = document.getElementById('regEmail').value;
            const password = document.getElementById('regPassword').value;
            const confirm = document.getElementById('regConfirmPassword').value;
            
            const result = await register(username, email, password, confirm);
            
            if (result.success) {
                alert(result.message);
                document.querySelector('.auth-tab[data-tab="login"]').click();
                document.getElementById('regUsername').value = '';
                document.getElementById('regEmail').value = '';
                document.getElementById('regPassword').value = '';
                document.getElementById('regConfirmPassword').value = '';
            } else {
                document.getElementById('registerError').textContent = result.message;
            }
        });
    }
    
    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            logout();
            document.getElementById('authPage').style.display = 'flex';
            document.getElementById('mainApp').style.display = 'none';
        });
    }
    
    // Create Server
    const createServerBtn = document.getElementById('createServerBtn');
    if (createServerBtn) {
        createServerBtn.addEventListener('click', () => {
            document.getElementById('createServerModal').style.display = 'flex';
            document.getElementById('newServerName').value = '';
        });
    }
    
    const confirmCreateServerBtn = document.getElementById('confirmCreateServerBtn');
    if (confirmCreateServerBtn) {
        confirmCreateServerBtn.addEventListener('click', async () => {
            const name = document.getElementById('newServerName').value.trim();
            if (name) {
                const newServer = await createServer(name);
                closeModals();
                if (newServer) {
                    renderServers();
                    selectServer(newServer.id);
                }
            } else {
                showNotification('Nama server tidak boleh kosong', 'error');
            }
        });
    }
    
    // Join Server
    const joinServerBtn = document.getElementById('joinServerBtn');
    if (joinServerBtn) {
        joinServerBtn.addEventListener('click', async () => {
            const code = document.getElementById('joinServerCode').value;
            const result = await joinServer(code);
            if (result.success) {
                document.getElementById('joinServerCode').value = '';
                renderServers();
                if (result.server) {
                    selectServer(result.server.id);
                }
            }
        });
    }
    
    // Add Channel
    const addChannelBtn = document.getElementById('addChannelBtn');
    if (addChannelBtn) {
        addChannelBtn.addEventListener('click', () => {
            if (!currentServerId) {
                showNotification('Pilih server terlebih dahulu', 'error');
                return;
            }
            document.getElementById('channelModal').style.display = 'flex';
            document.getElementById('channelName').value = '';
        });
    }
    
    const saveChannelBtn = document.getElementById('saveChannelBtn');
    if (saveChannelBtn) {
        saveChannelBtn.addEventListener('click', async () => {
            const name = document.getElementById('channelName').value.trim();
            if (name) {
                await addChannel(currentServerId, name);
                closeModals();
            } else {
                showNotification('Nama channel tidak boleh kosong', 'error');
            }
        });
    }
    
    // Send Message
    const sendMessageBtn = document.getElementById('sendMessageBtn');
    if (sendMessageBtn) {
        sendMessageBtn.addEventListener('click', async () => {
            const input = document.getElementById('messageInput');
            await sendMessage(input.value);
            input.value = '';
            input.focus();
        });
    }
    
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
        messageInput.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                await sendMessage(messageInput.value);
                messageInput.value = '';
                messageInput.focus();
            }
        });
    }
    
    // Sticker button
    const stickerBtn = document.getElementById('stickerBtn');
    if (stickerBtn) {
        stickerBtn.addEventListener('click', () => {
            document.getElementById('stickerModal').style.display = 'flex';
        });
    }
    
    const closeStickerBtn = document.getElementById('closeStickerBtn');
    if (closeStickerBtn) {
        closeStickerBtn.addEventListener('click', closeModals);
    }
    
    // Edit Message
    const saveEditBtn = document.getElementById('saveEditBtn');
    if (saveEditBtn) {
        saveEditBtn.addEventListener('click', async () => {
            const newContent = document.getElementById('editMessageInput').value.trim();
            if (newContent && editingMessageId) {
                await fetch(`${API_URL}/messages/${editingMessageId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: newContent })
                });
                closeModals();
                editingMessageId = null;
            }
        });
    }
    
    // Copy Invite
    const copyInviteBtn = document.getElementById('copyInviteBtn');
    if (copyInviteBtn) {
        copyInviteBtn.addEventListener('click', () => {
            const inviteCodeInput = document.getElementById('inviteCode');
            if (inviteCodeInput) {
                inviteCodeInput.select();
                document.execCommand('copy');
                showNotification('Kode invite disalin!', 'success');
            }
        });
    }
    
    // Role management
    const makeModeratorBtn = document.getElementById('makeModeratorBtn');
    if (makeModeratorBtn) {
        makeModeratorBtn.addEventListener('click', async () => {
            if (selectedMemberId) {
                await updateMemberRole(selectedMemberId, 'moderator');
                closeModals();
            }
        });
    }
    
    const makeMemberBtn = document.getElementById('makeMemberBtn');
    if (makeMemberBtn) {
        makeMemberBtn.addEventListener('click', async () => {
            if (selectedMemberId) {
                await updateMemberRole(selectedMemberId, 'member');
                closeModals();
            }
        });
    }
    
    const closeRoleBtn = document.getElementById('closeRoleBtn');
    if (closeRoleBtn) {
        closeRoleBtn.addEventListener('click', closeModals);
    }
    
    // Close Modals
    const cancelButtons = document.querySelectorAll('.cancel-btn, #closeInviteBtn, #closeStickerBtn');
    cancelButtons.forEach(btn => {
        btn.addEventListener('click', closeModals);
    });
    
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) closeModals();
    });
});

// Mobile Menu Functions
function initMobileMenu() {
    const leftSidebar = document.querySelector('.left-sidebar');
    const middleSidebar = document.querySelector('.middle-sidebar');
    const openLeftBtn = document.getElementById('openLeftMenuBtn');
    const openMiddleBtn = document.getElementById('openMiddleMenuBtn');
    const openMembersBtn = document.getElementById('openMembersBtn');
    const closeLeftBtn = document.getElementById('closeLeftSidebar');
    const closeMiddleBtn = document.getElementById('closeMiddleSidebar');
    
    // Buka left sidebar (Servers)
    if (openLeftBtn) {
        openLeftBtn.addEventListener('click', () => {
            leftSidebar.classList.add('open');
        });
    }
    
    // Buka middle sidebar (Channels)
    if (openMiddleBtn) {
        openMiddleBtn.addEventListener('click', () => {
            middleSidebar.classList.add('open');
        });
    }
    
    // Buka members (gunakan middle sidebar untuk menampilkan members)
    if (openMembersBtn) {
        openMembersBtn.addEventListener('click', () => {
            // On mobile, members are in middle sidebar
            middleSidebar.classList.add('open');
            // Scroll to members section
            const membersSection = document.querySelector('.members-section');
            if (membersSection) {
                membersSection.scrollIntoView();
            }
        });
    }
    
    // Tutup left sidebar
    if (closeLeftBtn) {
        closeLeftBtn.addEventListener('click', () => {
            leftSidebar.classList.remove('open');
        });
    }
    
    // Tutup middle sidebar
    if (closeMiddleBtn) {
        closeMiddleBtn.addEventListener('click', () => {
            middleSidebar.classList.remove('open');
        });
    }
    
    // Tutup menu saat klik di luar
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
            if (leftSidebar && leftSidebar.classList.contains('open')) {
                if (!leftSidebar.contains(e.target) && !openLeftBtn.contains(e.target)) {
                    leftSidebar.classList.remove('open');
                }
            }
            if (middleSidebar && middleSidebar.classList.contains('open')) {
                if (!middleSidebar.contains(e.target) && !openMiddleBtn.contains(e.target) && !openMembersBtn.contains(e.target)) {
                    middleSidebar.classList.remove('open');
                }
            }
        }
    });
}

// Fungsi Keluar dari Server
async function leaveServer(serverId) {
    const server = servers.find(s => s.id === serverId);
    if (!server) {
        showNotification('Server tidak ditemukan!', 'error');
        return false;
    }
    
    // Cek apakah user adalah owner (owner tidak bisa keluar, harus hapus server)
    if (isOwner(serverId, currentUser.id)) {
        showNotification('Owner tidak bisa keluar dari server. Jika ingin menghapus server, gunakan tombol hapus server.', 'error');
        return false;
    }
    
    // Cek apakah user benar-benar member server ini
    const isMember = serverMembers.some(m => m.serverId === serverId && m.userId === currentUser.id);
    if (!isMember) {
        showNotification('Anda bukan member server ini!', 'error');
        return false;
    }
    
    if (confirm(`Apakah Anda yakin ingin keluar dari server "${server.name}"?`)) {
        // Cari record member
        const memberRecord = serverMembers.find(m => m.serverId === serverId && m.userId === currentUser.id);
        
        if (memberRecord) {
            await fetch(`${API_URL}/serverMembers/${memberRecord.id}`, { method: 'DELETE' });
            await loadData();
            
            // Jika server yang ditinggalkan adalah server yang sedang aktif
            if (currentServerId === serverId) {
                const userServers = getUserServers();
                if (userServers.length > 0) {
                    // Pilih server pertama yang tersedia
                    selectServer(userServers[0].id);
                } else {
                    // Tidak ada server tersisa
                    currentServerId = null;
                    currentChannelId = null;
                    renderServers();
                    renderChannels();
                    renderMessages();
                    updateServerInfo();
                    
                    // Sembunyikan member sidebar
                    const memberSidebar = document.getElementById('memberSidebar');
                    if (memberSidebar) memberSidebar.classList.add('hidden');
                    
                    // Update mobile header
                    const mobileServerName = document.getElementById('mobileServerName');
                    if (mobileServerName) mobileServerName.textContent = 'Discord';
                }
            }
            
            showNotification(`Anda telah keluar dari server "${server.name}"`, 'success');
            return true;
        }
    }
    return false;
}