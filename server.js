const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");
const { Pool } = require('pg');
const multer = require('multer');
const fs = require('fs');
const FormData = require('form-data');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- Static Folders & Middleware ---
app.use(bodyParser.json({ limit: '50mb' })); 
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname)));

// Upload folder setup
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use('/uploads', express.static(uploadDir));

// Multer Setup (Memory storage for easy handling)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ၁။ Database Tables & Settings Initialization
const initDb = async () => {
    try {
        // Create Contacts Table
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

        // Create Messages Table
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
                is_read BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create Settings Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        `);

        // Default Settings Initialization
        const defaultSettings = [
            ['admin_nickname', 'OmniBot'],
            ['enable_autoreply', 'false'],
            ['autoreply_text', 'မင်္ဂလာပါ၊ ခဏစောင့်ပေးပါခင်ဗျာ...'],
            ['site_name', 'OmniBot Dashboard']
        ];

        for (const [key, val] of defaultSettings) {
            await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, val]);
        }
        
        console.log("✅ Database & Settings ready.");
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
    } catch (e) { /* Silent fail */ }
    return `https://ui-avatars.com/api/?name=User&background=random`;
}

// ၃။ Unified Message Handler
async function handleIncomingMessage(payload) {
    const { sender, text, platform, chatId, profilePic, fileUrl, fileType } = payload;
    try {
        // Mark previous bot messages as read when user replies
        await pool.query("UPDATE messages SET is_read = true WHERE chat_id = $1 AND sender_type = 'bot'", [chatId]);
        io.emit('messages_read', { chatId, role: 'bot' });

        // Save/Update Contact
        await pool.query(`
            INSERT INTO contacts (chat_id, first_name, profile_pic, platform) 
            VALUES ($1, $2, $3, $4) 
            ON CONFLICT (chat_id) DO UPDATE SET first_name = EXCLUDED.first_name, profile_pic = EXCLUDED.profile_pic, platform = EXCLUDED.platform`, 
            [chatId, sender, profilePic, platform]
        );

        // Save Incoming Message
        const msgRes = await pool.query(
            "INSERT INTO messages (sender, text, platform, chat_id, sender_type, file_url, file_type, is_read) VALUES ($1, $2, $3, $4, $5, $6, $7, false) RETURNING *, TO_CHAR(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yangon', 'HH12:MI AM') as time",
            [sender, text, platform, chatId, 'user', fileUrl, fileType]
        );

        io.emit('new_message', msgRes.rows[0]);

        // --- Auto Reply Logic ---
        const settingsRes = await pool.query("SELECT value, key FROM settings WHERE key IN ('telegram_token', 'enable_autoreply', 'autoreply_text', 'admin_nickname')");
        const settingsMap = {};
        settingsRes.rows.forEach(r => settingsMap[r.key] = r.value);

        if (settingsMap['enable_autoreply'] === 'true' && settingsMap['autoreply_text']) {
            const replyText = settingsMap['autoreply_text'];
            const adminName = settingsMap['admin_nickname'] || 'OmniBot';

            if (platform === 'Telegram' && settingsMap['telegram_token']) {
                await axios.post(`https://api.telegram.org/bot${settingsMap['telegram_token']}/sendMessage`, { chat_id: chatId, text: replyText });
            }

            const autoMsg = await pool.query("INSERT INTO messages (sender, text, platform, chat_id, sender_type, is_read) VALUES ($1, $2, $3, $4, $5, false) RETURNING *, TO_CHAR(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yangon', 'HH12:MI AM') as time", 
                [adminName, replyText, platform, chatId, 'bot']);
            
            io.emit('new_message', autoMsg.rows[0]);
        }
    } catch (err) { console.error("Unified Logic Error:", err.message); }
}

// --- Routes ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

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
        const result = await pool.query("SELECT *, TO_CHAR(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yangon', 'HH12:MI AM') as time FROM messages ORDER BY id ASC");
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/contacts', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM contacts ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/messages/read', async (req, res) => {
    const { chatId } = req.body;
    try {
        await pool.query("UPDATE messages SET is_read = true WHERE chat_id = $1 AND sender_type = 'user'", [chatId]);
        io.emit('messages_read', { chatId, role: 'user' });
        res.json({ success: true });
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

        for (const key of Object.keys(settingsData)) {
            const val = settingsData[key];
            if (val !== undefined) {
                await pool.query(
                    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
                    [key, val.toString()]
                );
            }
        }

        io.emit('settings_updated', settingsData);

        if (settingsData.telegram_token) {
            await axios.get(`https://api.telegram.org/bot${settingsData.telegram_token}/setWebhook?url=${RENDER_URL}/webhook/telegram`);
        }

        res.json({ success: true, settings: settingsData });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// --- Telegram Webhook ---
app.post('/webhook/telegram', async (req, res) => {
    const update = req.body;
    // အရေးကြီးသည်- Bot ကိုယ်တိုင် ပြန်ပို့တဲ့စာဆိုရင် ဘာမှမလုပ်ဘဲ ကျော်မယ် (Loop မဖြစ်အောင်)
    if (!update.message || update.message.from.is_bot) return res.sendStatus(200);

    const chatId = update.message.chat.id.toString();
    const sender = `${update.message.from.first_name || ""} ${update.message.from.last_name || ""}`.trim() || "Unknown";
    let text = update.message.text || update.message.caption || "";
    let fileUrl = null, fileType = null;

    try {
        // Block check
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

            const msgRes = await pool.query("INSERT INTO messages (sender, text, platform, chat_id, sender_type, is_read) VALUES ($1, $2, $3, $4, $5, false) RETURNING *, TO_CHAR(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yangon', 'HH12:MI AM') as time", 
                [adminName, data.text, platform, data.chatId, 'bot']);

            io.emit('new_message', msgRes.rows[0]);
        } catch (e) { console.error("Reply Error"); }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
