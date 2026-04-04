const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname)));

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

        await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';`);
        await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS notes TEXT;`);
        await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS nickname TEXT;`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                sender TEXT,
                text TEXT,
                platform TEXT,
                chat_id TEXT,
                sender_type TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_type TEXT;`);

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

// --- Bulk Settings & Auto-Webhook Connection ---
app.post('/api/settings/bulk', async (req, res) => {
    const settingsData = req.body;
    const RENDER_URL = "https://realmessage-live.onrender.com"; // မင်းရဲ့ Render URL

    try {
        // syntax error မတက်အောင် တစ်ခုချင်းစီ loop ပတ်ပြီး သေချာအောင် သိမ်းမယ်
        for (const [key, value] of Object.entries(settingsData)) {
            await pool.query(
                `INSERT INTO settings (key, value) 
                 VALUES ($1, $2) 
                 ON CONFLICT (key) 
                 DO UPDATE SET value = EXCLUDED.value`,
                [key, value]
            );
        }

        // Telegram Token ပါလာရင် Webhook ကို တစ်ခါတည်း ချိတ်ပေးမယ်
        if (settingsData.telegram_token) {
            const webhookUrl = `${RENDER_URL}/webhook/telegram`;
            await axios.get(`https://api.telegram.org/bot${settingsData.telegram_token}/setWebhook?url=${webhookUrl}`);
            console.log(`✅ Webhook updated to: ${webhookUrl}`);
        }

        res.json({ success: true });
    } catch (err) {
        console.error("Bulk Save Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- Management APIs ---
app.post('/api/contacts/nickname', async (req, res) => {
    const { chatId, nickname } = req.body;
    try {
        await pool.query('UPDATE contacts SET nickname = $1 WHERE chat_id = $2', [nickname, chatId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/contacts/status', async (req, res) => {
    const { chatId, status } = req.body;
    try {
        await pool.query('UPDATE contacts SET status = $1 WHERE chat_id = $2', [status, chatId]);
        res.json({ success: true, status: status });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/contacts/block', async (req, res) => {
    const { chatId } = req.body;
    try {
        await pool.query("UPDATE contacts SET status = 'blocked' WHERE chat_id = $1", [chatId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/contacts/:chatId', async (req, res) => {
    const { chatId } = req.params;
    try {
        await pool.query('DELETE FROM messages WHERE chat_id = $1', [chatId]);
        await pool.query('DELETE FROM contacts WHERE chat_id = $1', [chatId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Webhook with Telegram ---
app.post('/webhook/telegram', async (req, res) => {
    const update = req.body;
    if (update.message) {
        const chatId = update.message.chat.id.toString();
        
        // Block စစ်မယ်
        const checkStatus = await pool.query('SELECT status FROM contacts WHERE chat_id = $1', [chatId]);
        if (checkStatus.rows.length > 0 && checkStatus.rows[0].status === 'blocked') return res.sendStatus(200);

        const text = update.message.text || "";
        const sender = `${update.message.from.first_name || ""} ${update.message.from.last_name || ""}`.trim() || "Unknown";
        const username = update.message.from.username || "";

        try {
            // DB ထဲက Token ယူသုံးမယ်
            const settingsRes = await pool.query("SELECT value FROM settings WHERE key = 'telegram_token'");
            const currentToken = settingsRes.rows[0]?.value;

            if (currentToken) {
                const profilePic = await getTelegramProfilePic(chatId, currentToken);
                await pool.query(`
                    INSERT INTO contacts (chat_id, first_name, username, profile_pic, platform)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (chat_id) DO UPDATE SET first_name = EXCLUDED.first_name, profile_pic = EXCLUDED.profile_pic
                `, [chatId, sender, username, profilePic, 'Telegram']);

                await pool.query(
                    'INSERT INTO messages (sender, text, platform, chat_id, sender_type) VALUES ($1, $2, $3, $4, $5)',
                    [sender, text, 'Telegram', chatId, 'user']
                );

                const contactInfo = await pool.query('SELECT nickname FROM contacts WHERE chat_id = $1', [chatId]);
                const displayName = contactInfo.rows[0]?.nickname || sender;

                io.emit('new_message', { sender: displayName, text, chatId, profile_pic: profilePic, sender_type: 'user' });
            }
        } catch (err) { console.error("Webhook Error:", err.message); }
    }
    res.sendStatus(200);
});

// --- Dashboard Reply Logic ---
io.on('connection', (socket) => {
    socket.on('send_reply', async (data) => {
        try {
            const settingsRes = await pool.query("SELECT value FROM settings WHERE key = 'telegram_token'");
            const botToken = settingsRes.rows[0]?.value;

            if (botToken) {
                await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, { chat_id: data.chatId, text: data.text });
                await pool.query(
                    'INSERT INTO messages (sender, text, platform, chat_id, sender_type) VALUES ($1, $2, $3, $4, $5)',
                    ['OmniBot', data.text, 'Telegram', data.chatId, 'bot']
                );
            }
        } catch (e) { console.error("Reply Error:", e.response?.data || e.message); }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
