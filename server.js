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

// Middleware
app.use(bodyParser.json({ limit: '50mb' })); 
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname)));

// --- Multer Memory Storage Setup ---
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Database Connection
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

// --- Routes ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/settings', (req, res) => res.sendFile(path.join(__dirname, 'settings.html')));

// --- API Endpoints ---
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

app.get('/api/settings', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM settings');
        const settings = {};
        result.rows.forEach(row => settings[row.key] = row.value);
        res.json(settings);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ManyChat ပုံစံမျိုး Token ပြောင်းတာနဲ့ Webhook ပါ တစ်ခါတည်း Update လုပ်ပေးမည့် API ---
app.post('/api/settings/single', async (req, res) => {
    const { key, value } = req.body;
    const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;

    try {
        // ၁။ Database မှာ အရင်သိမ်းမယ်
        await pool.query(
            'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
            [key, value]
        );

        // ၂။ အကယ်၍ သိမ်းလိုက်တာက telegram_token ဖြစ်ရင် Webhook ပါ တစ်ခါတည်း ချိတ်မယ်
        if (key === 'telegram_token' && value) {
            try {
                await axios.get(`https://api.telegram.org/bot${value}/setWebhook?url=${RENDER_URL}/webhook/telegram`);
                console.log(`✅ Webhook updated for new token: ${value}`);
            } catch (webhookErr) {
                console.error("❌ Webhook Update Error:", webhookErr.message);
                // Token မှားနေရင်တောင် settings သိမ်းတာကို success ပေးနိုင်အောင် error မပစ်ပါဘူး
            }
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/settings/bulk', upload.single('avatar'), async (req, res) => {
    const settingsData = req.body;
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
            await axios.get(`https://api.telegram.org/bot${settingsData.telegram_token}/setWebhook?url=${RENDER_URL}/webhook/telegram`);
        }

        res.json({ success: true });
    } catch (err) { 
        console.error("Bulk Save Error:", err.message);
        res.status(500).json({ error: err.message }); 
    }
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

                await axios.post(`https://api.telegram.org/bot${token}/sendPhoto`, form, {
                    headers: form.getHeaders()
                });
            }
        }

        io.emit('new_message', { sender: adminName, text: 'Sent an image', chatId, file_url: base64File, file_type: 'image', platform, sender_type: 'bot' });
        res.json({ success: true, fileUrl: base64File });
    } catch (err) {
        console.error("Upload Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- Telegram Webhook ---
app.post('/webhook/telegram', async (req, res) => {
    const update = req.body;
    if (update.message) {
        const chatId = update.message.chat.id.toString();
        const sender = `${update.message.from.first_name || ""} ${update.message.from.last_name || ""}`.trim() || "Unknown";
        let text = update.message.text || update.message.caption || "";
        let fileUrl = null;
        let fileType = null;

        const settingsRes = await pool.query("SELECT value FROM settings WHERE key IN ('telegram_token', 'enable_autoreply', 'autoreply_text')");
        const settingsMap = {};
        settingsRes.rows.forEach(r => settingsMap[r.key] = r.value);

        const currentToken = settingsMap['telegram_token'];

        if (currentToken) {
            if (update.message.photo) {
                const fileId = update.message.photo[update.message.photo.length - 1].file_id;
                const fileRes = await axios.get(`https://api.telegram.org/bot${currentToken}/getFile?file_id=${fileId}`);
                fileUrl = `https://api.telegram.org/file/bot${currentToken}/${fileRes.data.result.file_path}`;
                fileType = 'image';
                if (!text) text = "Sent an image";
            }

            const profilePic = await getTelegramProfilePic(chatId, currentToken);
            await pool.query('INSERT INTO contacts (chat_id, first_name, profile_pic, platform) VALUES ($1, $2, $3, $4) ON CONFLICT (chat_id) DO UPDATE SET first_name = $2, profile_pic = $3', [chatId, sender, profilePic, 'Telegram']);

            await pool.query(
                'INSERT INTO messages (sender, text, platform, chat_id, sender_type, file_url, file_type) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                [sender, text, 'Telegram', chatId, 'user', fileUrl, fileType]
            );

            io.emit('new_message', { sender, text, chatId, profile_pic: profilePic, platform: 'Telegram', sender_type: 'user', file_url: fileUrl, file_type: fileType });

            if (settingsMap['enable_autoreply'] === 'true' && settingsMap['autoreply_text']) {
                await axios.post(`https://api.telegram.org/bot${currentToken}/sendMessage`, { chat_id: chatId, text: settingsMap['autoreply_text'] });
            }
        }
    }
    res.sendStatus(200);
});

// --- Viber/Messenger Webhooks ---
app.post('/webhook/viber', async (req, res) => {
    const update = req.body;
    if (update.event === 'message') {
        const chatId = update.sender.id;
        const senderName = update.sender.name;
        const text = update.message.text;
        const profilePic = update.sender.avatar || `https://ui-avatars.com/api/?name=${senderName}&background=random`;
        await pool.query('INSERT INTO messages (sender, text, platform, chat_id, sender_type) VALUES ($1, $2, $3, $4, $5)', [senderName, text, 'Viber', chatId, 'user']);
        io.emit('new_message', { sender: senderName, text, chatId, profile_pic: profilePic, platform: 'Viber', sender_type: 'user' });
    }
    res.sendStatus(200);
});

app.post('/webhook/messenger', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        body.entry.forEach(async (entry) => {
            const webhookEvent = entry.messaging[0];
            const senderId = webhookEvent.sender.id;
            if (webhookEvent.message && webhookEvent.message.text) {
                const text = webhookEvent.message.text;
                await pool.query('INSERT INTO messages (sender, text, platform, chat_id, sender_type) VALUES ($1, $2, $3, $4, $5)', ['Messenger User', text, 'Messenger', senderId, 'user']);
                io.emit('new_message', { sender: 'Messenger User', text, chatId: senderId, platform: 'Messenger', sender_type: 'user' });
            }
        });
        res.status(200).send('EVENT_RECEIVED');
    } else { res.sendStatus(404); }
});

// --- Dashboard Reply Logic ---
io.on('connection', (socket) => {
    socket.on('send_reply', async (data) => {
        try {
            const contactRes = await pool.query('SELECT platform FROM contacts WHERE chat_id = $1', [data.chatId]);
            const platform = contactRes.rows[0]?.platform;

            if (!platform) return console.error("Platform not found for ChatID:", data.chatId);

            const settingsRes = await pool.query("SELECT value, key FROM settings WHERE key IN ('telegram_token', 'viber_auth_token', 'meta_page_access_token', 'admin_nickname')");
            const tokens = {};
            settingsRes.rows.forEach(row => tokens[row.key] = row.value);

            const adminName = tokens['admin_nickname'] || 'OmniBot';

            if (platform === 'Telegram' && tokens.telegram_token) {
                await axios.post(`https://api.telegram.org/bot${tokens.telegram_token}/sendMessage`, { chat_id: data.chatId, text: data.text });
            } else if (platform === 'Viber' && tokens.viber_auth_token) {
                await axios.post(`https://chatapi.viber.com/pa/send_message`, {
                    receiver: data.chatId, type: "text", text: data.text, sender: { name: adminName }
                }, { headers: { 'X-Viber-Auth-Token': tokens.viber_auth_token } });
            } else if (platform === 'Messenger' && tokens.meta_page_access_token) {
                await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${tokens.meta_page_access_token}`, {
                    recipient: { id: data.chatId }, message: { text: data.text }
                });
            }

            await pool.query('INSERT INTO messages (sender, text, platform, chat_id, sender_type) VALUES ($1, $2, $3, $4, $5)', 
                [adminName, data.text, platform, data.chatId, 'bot']);

            io.emit('new_message', { 
                sender: adminName, 
                text: data.text, 
                chatId: data.chatId, 
                platform: platform, 
                sender_type: 'bot' 
            });

        } catch (e) { console.error("Reply Error:", e.message); }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
