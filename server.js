const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");
const { Pool } = require('pg');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- Static Folders & Middleware ---
app.use(bodyParser.json({ limit: '50mb' })); 
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname)));

if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ၁။ Database Tables Initialization
const initDb = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS contacts (
                chat_id TEXT PRIMARY KEY,
                first_name TEXT,
                username TEXT,
                profile_pic TEXT,
                platform TEXT,
                status TEXT DEFAULT 'active',
                notes TEXT,
                nickname TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                sender TEXT,
                text TEXT,
                platform TEXT,
                chat_id TEXT,
                sender_type TEXT,
                file_url TEXT,
                file_type TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        `);
        
        console.log("✅ Database structure is ready.");
    } catch (err) {
        console.error("❌ DB Init Error:", err.message);
    }
};
initDb();

// ၂။ Helper: Get Telegram Profile Pic
async function getTelegramProfilePic(userId, token) {
    try {
        const res = await axios.get(`https://api.telegram.org/bot${token}/getUserProfilePhotos?user_id=${userId}`);
        if (res.data.result.total_count > 0) {
            const fileId = res.data.result.photos[0][0].file_id;
            const fileRes = await axios.get(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
            return `https://api.telegram.org/file/bot${token}/${fileRes.data.result.file_path}`;
        }
    } catch (e) { console.error("Avatar Fetch Error"); }
    return `https://ui-avatars.com/api/?name=User&background=random`;
}

// ၃။ Unified Message Handler (Inbox အားလုံးအတွက် Auto-Reply Logic)
async function handleIncomingMessage(payload) {
    const { sender, text, platform, chatId, profilePic, fileUrl, fileType } = payload;
    try {
        // Contact Update
        await pool.query(`
            INSERT INTO contacts (chat_id, first_name, profile_pic, platform) 
            VALUES ($1, $2, $3, $4) 
            ON CONFLICT (chat_id) DO UPDATE SET first_name = EXCLUDED.first_name, profile_pic = EXCLUDED.profile_pic, platform = EXCLUDED.platform`, 
            [chatId, sender, profilePic, platform]
        );

        // User Message သိမ်းခြင်း
        await pool.query(
            'INSERT INTO messages (sender, text, platform, chat_id, sender_type, file_url, file_type) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [sender, text, platform, chatId, 'user', fileUrl, fileType]
        );

        io.emit('new_message', { sender, text, chatId, profile_pic: profilePic, platform, sender_type: 'user', file_url: fileUrl, file_type: fileType });

        // Auto-Reply Logic (ဗဟိုချက်)
        const settingsRes = await pool.query("SELECT value, key FROM settings WHERE key IN ('telegram_token', 'enable_autoreply', 'autoreply_text', 'admin_nickname')");
        const settingsMap = {};
        settingsRes.rows.forEach(r => settingsMap[r.key] = r.value);

        if (settingsMap['enable_autoreply'] === 'true' && settingsMap['autoreply_text']) {
            const replyText = settingsMap['autoreply_text'];
            const adminName = settingsMap['admin_nickname'] || 'OmniBot';

            // Platform အလိုက် စာပြန်ပို့ခြင်း
            if (platform === 'Telegram' && settingsMap['telegram_token']) {
                await axios.post(`https://api.telegram.org/bot${settingsMap['telegram_token']}/sendMessage`, { chat_id: chatId, text: replyText });
            }

            // Bot ရဲ့ Auto-reply စာသားကို DB သိမ်းပြီး Dashboard ကို ပို့ခြင်း
            await pool.query('INSERT INTO messages (sender, text, platform, chat_id, sender_type) VALUES ($1, $2, $3, $4, $5)', 
                [adminName, replyText, platform, chatId, 'bot']);
            
            io.emit('new_message', { sender: adminName, text: replyText, chatId, platform, sender_type: 'bot' });
        }
    } catch (err) { console.error("Unified Logic Error:", err.message); }
}

// --- Routes ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/settings', (req, res) => res.sendFile(path.join(__dirname, 'general-settings.html')));

app.get('/api/admin/profile', async (req, res) => {
    try {
        const result = await pool.query("SELECT key, value FROM settings WHERE key IN ('admin_nickname', 'admin_avatar')");
        const profile = {};
        result.rows.forEach(row => profile[row.key] = row.value);
        res.json({
            nickname: profile.admin_nickname || 'OmniBot',
            avatar: profile.admin_avatar || 'https://ui-avatars.com/api/?name=Admin'
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/messages', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM messages ORDER BY created_at ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/contacts', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM contacts ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/contacts/:chatId', async (req, res) => {
    const { chatId } = req.params;
    try {
        await pool.query('DELETE FROM messages WHERE chat_id = $1', [chatId]);
        await pool.query('DELETE FROM contacts WHERE chat_id = $1', [chatId]);
        res.json({ success: true, message: "Conversation deleted" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/contacts/status', async (req, res) => {
    const { chatId, status } = req.body;
    try {
        await pool.query('UPDATE contacts SET status = $1 WHERE chat_id = $2', [status, chatId]);
        res.json({ success: true, status });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/settings', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM settings');
        const settings = {};
        result.rows.forEach(row => settings[row.key] = row.value);
        res.json(settings);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/settings/bulk', upload.single('avatar'), async (req, res) => {
    const settingsData = { ...req.body };
    const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`; 

    try {
        if (req.file) {
            const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
            settingsData.admin_avatar = base64Image;
        }

        for (const [key, value] of Object.entries(settingsData)) {
            if (value !== undefined) {
                await pool.query(
                    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
                    [key, value.toString()]
                );
            }
        }

        if (settingsData.telegram_token) {
            try {
                await axios.get(`https://api.telegram.org/bot${settingsData.telegram_token}/setWebhook?url=${RENDER_URL}/webhook/telegram`);
            } catch (e) { console.error("Webhook Update Error"); }
        }

        res.json({ success: true, admin_avatar: settingsData.admin_avatar || null, admin_nickname: settingsData.admin_nickname || null });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
    const { chatId } = req.body;
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const base64File = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    try {
        const contactRes = await pool.query('SELECT platform FROM contacts WHERE chat_id = $1', [chatId]);
        const platform = contactRes.rows[0]?.platform || 'Unknown';
        const settingsRes = await pool.query("SELECT value FROM settings WHERE key = 'admin_nickname'");
        const adminName = settingsRes.rows[0]?.value || 'OmniBot';

        await pool.query(
            'INSERT INTO messages (sender, text, platform, chat_id, sender_type, file_url, file_type) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [adminName, `Sent an image`, platform, chatId, 'bot', base64File, 'image']
        );

        if (platform === 'Telegram') {
            const tokenRes = await pool.query("SELECT value FROM settings WHERE key = 'telegram_token'");
            const token = tokenRes.rows[0]?.value;
            if (token) {
                const FormData = require('form-data');
                const form = new FormData();
                form.append('chat_id', chatId);
                form.append('photo', req.file.buffer, { filename: req.file.originalname });
                await axios.post(`https://api.telegram.org/bot${token}/sendPhoto`, form, { headers: form.getHeaders() });
            }
        }
        io.emit('new_message', { sender: adminName, text: 'Sent an image', chatId, file_url: base64File, file_type: 'image', platform, sender_type: 'bot' });
        res.json({ success: true, fileUrl: base64File });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Telegram Webhook (Unified Logic ချိတ်ဆက်မှု) ---
app.post('/webhook/telegram', async (req, res) => {
    const update = req.body;
    if (!update.message) return res.sendStatus(200);

    const chatId = update.message.chat.id.toString();
    const sender = `${update.message.from.first_name || ""} ${update.message.from.last_name || ""}`.trim() || "Unknown";
    let text = update.message.text || update.message.caption || "";
    let fileUrl = null, fileType = null;

    try {
        const contactCheck = await pool.query('SELECT status FROM contacts WHERE chat_id = $1', [chatId]);
        if (contactCheck.rows[0]?.status === 'blocked') return res.sendStatus(200);

        const tokenRes = await pool.query("SELECT value FROM settings WHERE key = 'telegram_token'");
        const currentToken = tokenRes.rows[0]?.value;

        if (currentToken) {
            if (update.message.photo) {
                const fileId = update.message.photo[update.message.photo.length - 1].file_id;
                const fileRes = await axios.get(`https://api.telegram.org/bot${currentToken}/getFile?file_id=${fileId}`);
                fileUrl = `https://api.telegram.org/file/bot${currentToken}/${fileRes.data.result.file_path}`;
                fileType = 'image';
                if (!text) text = "Sent an image";
            }
            const profilePic = await getTelegramProfilePic(chatId, currentToken);

            // ဗဟို Logic ကို လှမ်းခေါ်ခြင်း
            await handleIncomingMessage({ sender, text, platform: 'Telegram', chatId, profilePic, fileUrl, fileType });
        }
    } catch (err) { console.error("Webhook Error"); }
    res.sendStatus(200);
});

// --- Socket.io Logic ---
io.on('connection', (socket) => {
    socket.on('send_reply', async (data) => {
        try {
            const contactRes = await pool.query('SELECT platform FROM contacts WHERE chat_id = $1', [data.chatId]);
            const platform = contactRes.rows[0]?.platform;
            if (!platform) return;

            const settingsRes = await pool.query("SELECT value, key FROM settings WHERE key IN ('telegram_token', 'admin_nickname')");
            const tokens = {};
            settingsRes.rows.forEach(row => tokens[row.key] = row.value);
            const adminName = tokens['admin_nickname'] || 'OmniBot';

            if (platform === 'Telegram' && tokens.telegram_token) {
                await axios.post(`https://api.telegram.org/bot${tokens.telegram_token}/sendMessage`, { chat_id: data.chatId, text: data.text });
            }

            await pool.query('INSERT INTO messages (sender, text, platform, chat_id, sender_type) VALUES ($1, $2, $3, $4, $5)', 
                [adminName, data.text, platform, data.chatId, 'bot']);

            io.emit('new_message', { sender: adminName, text: data.text, chatId: data.chatId, platform: platform, sender_type: 'bot' });
        } catch (e) { console.error("Reply Error"); }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
