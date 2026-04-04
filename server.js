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

// --- Individual Setting Save (တိုးထည့်ပေးထားသည့်အပိုင်း) ---
app.post('/api/settings/single', async (req, res) => {
    const { key, value } = req.body;
    const RENDER_URL = "https://realmessage-live.onrender.com"; 

    try {
        const check = await pool.query('SELECT key FROM settings WHERE key = $1', [key]);
        if (check.rows.length > 0) {
            await pool.query('UPDATE settings SET value = $2 WHERE key = $1', [key, value]);
        } else {
            await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2)', [key, value]);
        }

        // Webhook Auto Updates
        if (key === 'telegram_token' && value) {
            await axios.get(`https://api.telegram.org/bot${value}/setWebhook?url=${RENDER_URL}/webhook/telegram`);
        }
        if (key === 'viber_auth_token' && value) {
            await axios.post(`https://chatapi.viber.com/pa/set_webhook`, {
                url: `${RENDER_URL}/webhook/viber`,
                event_types: ["delivered", "seen", "failed", "subscribed", "unsubscribed", "message"]
            }, { headers: { 'X-Viber-Auth-Token': value } });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Bulk Settings Update ---
app.post('/api/settings/bulk', async (req, res) => {
    const settingsData = req.body;
    const RENDER_URL = "https://realmessage-live.onrender.com"; 

    try {
        for (const [key, value] of Object.entries(settingsData)) {
            const check = await pool.query('SELECT key FROM settings WHERE key = $1', [key]);
            if (check.rows.length > 0) {
                await pool.query('UPDATE settings SET value = $2 WHERE key = $1', [key, value]);
            } else {
                await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2)', [key, value]);
            }
        }

        if (settingsData.telegram_token) {
            await axios.get(`https://api.telegram.org/bot${settingsData.telegram_token}/setWebhook?url=${RENDER_URL}/webhook/telegram`);
        }

        if (settingsData.viber_auth_token) {
            await axios.post(`https://chatapi.viber.com/pa/set_webhook`, {
                url: `${RENDER_URL}/webhook/viber`,
                event_types: ["delivered", "seen", "failed", "subscribed", "unsubscribed", "message"]
            }, { headers: { 'X-Viber-Auth-Token': settingsData.viber_auth_token } });
        }

        res.json({ success: true });
    } catch (err) {
        console.error("Bulk Save Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- Messenger Webhook Verification ---
app.get('/webhook/messenger', async (req, res) => {
    try {
        const settingsRes = await pool.query("SELECT value FROM settings WHERE key = 'meta_verify_token'");
        const VERIFY_TOKEN = settingsRes.rows[0]?.value;

        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    } catch (e) { res.sendStatus(500); }
});

// --- Messenger Receiver ---
app.post('/webhook/messenger', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        body.entry.forEach(async (entry) => {
            const webhookEvent = entry.messaging[0];
            const senderId = webhookEvent.sender.id;

            if (webhookEvent.message && webhookEvent.message.text) {
                const text = webhookEvent.message.text;
                const settingsRes = await pool.query("SELECT value FROM settings WHERE key = 'meta_page_access_token'");
                const PAGE_ACCESS_TOKEN = settingsRes.rows[0]?.value;

                let senderName = "Messenger User";
                let profilePic = `https://ui-avatars.com/api/?name=Messenger&background=random`;

                if (PAGE_ACCESS_TOKEN) {
                    try {
                        const userRes = await axios.get(`https://graph.facebook.com/${senderId}?fields=first_name,last_name,profile_pic&access_token=${PAGE_ACCESS_TOKEN}`);
                        senderName = `${userRes.data.first_name} ${userRes.data.last_name}`;
                        profilePic = userRes.data.profile_pic || profilePic;
                    } catch (e) { console.error("Messenger Profile Error"); }
                }

                const contactCheck = await pool.query('SELECT chat_id FROM contacts WHERE chat_id = $1', [senderId]);
                if (contactCheck.rows.length > 0) {
                    await pool.query('UPDATE contacts SET first_name = $2, profile_pic = $3 WHERE chat_id = $1', [senderId, senderName, profilePic]);
                } else {
                    await pool.query('INSERT INTO contacts (chat_id, first_name, profile_pic, platform) VALUES ($1, $2, $3, $4)', [senderId, senderName, profilePic, 'Messenger']);
                }

                await pool.query('INSERT INTO messages (sender, text, platform, chat_id, sender_type) VALUES ($1, $2, $3, $4, $5)', [senderName, text, 'Messenger', senderId, 'user']);
                io.emit('new_message', { sender: senderName, text, chatId: senderId, profile_pic: profilePic, platform: 'Messenger', sender_type: 'user' });
            }
        });
        res.status(200).send('EVENT_RECEIVED');
    } else { res.sendStatus(404); }
});

// --- Viber Webhook ---
app.post('/webhook/viber', async (req, res) => {
    const update = req.body;
    if (update.event === 'message') {
        const chatId = update.sender.id;
        const senderName = update.sender.name;
        const profilePic = update.sender.avatar || `https://ui-avatars.com/api/?name=${senderName}&background=random`;
        const text = update.message.text;

        const check = await pool.query('SELECT chat_id FROM contacts WHERE chat_id = $1', [chatId]);
        if (check.rows.length > 0) {
            await pool.query('UPDATE contacts SET first_name = $2, profile_pic = $3 WHERE chat_id = $1', [chatId, senderName, profilePic]);
        } else {
            await pool.query('INSERT INTO contacts (chat_id, first_name, profile_pic, platform) VALUES ($1, $2, $3, $4)', [chatId, senderName, profilePic, 'Viber']);
        }

        await pool.query('INSERT INTO messages (sender, text, platform, chat_id, sender_type) VALUES ($1, $2, $3, $4, $5)', [senderName, text, 'Viber', chatId, 'user']);
        io.emit('new_message', { sender: senderName, text, chatId, profile_pic: profilePic, platform: 'Viber', sender_type: 'user' });
    }
    res.sendStatus(200);
});

// --- Telegram Webhook ---
app.post('/webhook/telegram', async (req, res) => {
    const update = req.body;
    if (update.message) {
        const chatId = update.message.chat.id.toString();
        const text = update.message.text || "";
        const sender = `${update.message.from.first_name || ""} ${update.message.from.last_name || ""}`.trim() || "Unknown";
        
        const settingsRes = await pool.query("SELECT value FROM settings WHERE key = 'telegram_token'");
        const currentToken = settingsRes.rows[0]?.value;

        if (currentToken) {
            const profilePic = await getTelegramProfilePic(chatId, currentToken);
            const check = await pool.query('SELECT chat_id FROM contacts WHERE chat_id = $1', [chatId]);
            if (check.rows.length > 0) {
                await pool.query('UPDATE contacts SET first_name = $2, profile_pic = $3 WHERE chat_id = $1', [chatId, sender, profilePic]);
            } else {
                await pool.query('INSERT INTO contacts (chat_id, first_name, profile_pic, platform) VALUES ($1, $2, $3, $4)', [chatId, sender, profilePic, 'Telegram']);
            }
            await pool.query('INSERT INTO messages (sender, text, platform, chat_id, sender_type) VALUES ($1, $2, $3, $4, $5)', [sender, text, 'Telegram', chatId, 'user']);
            io.emit('new_message', { sender, text, chatId, profile_pic: profilePic, platform: 'Telegram', sender_type: 'user' });
        }
    }
    res.sendStatus(200);
});

// --- Dashboard Reply Logic ---
io.on('connection', (socket) => {
    socket.on('send_reply', async (data) => {
        try {
            const settingsRes = await pool.query("SELECT value, key FROM settings WHERE key IN ('telegram_token', 'viber_auth_token', 'meta_page_access_token')");
            const tokens = {};
            settingsRes.rows.forEach(row => tokens[row.key] = row.value);

            if (data.platform === 'Telegram' && tokens.telegram_token) {
                await axios.post(`https://api.telegram.org/bot${tokens.telegram_token}/sendMessage`, { chat_id: data.chatId, text: data.text });
            } else if (data.platform === 'Viber' && tokens.viber_auth_token) {
                await axios.post(`https://chatapi.viber.com/pa/send_message`, {
                    receiver: data.chatId, type: "text", text: data.text, sender: { name: "OmniBot" }
                }, { headers: { 'X-Viber-Auth-Token': tokens.viber_auth_token } });
            } else if (data.platform === 'Messenger' && tokens.meta_page_access_token) {
                await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${tokens.meta_page_access_token}`, {
                    recipient: { id: data.chatId }, message: { text: data.text }
                });
            }
            await pool.query('INSERT INTO messages (sender, text, platform, chat_id, sender_type) VALUES ($1, $2, $3, $4, $5)', ['OmniBot', data.text, data.platform, data.chatId, 'bot']);
        } catch (e) { console.error("Reply Error:", e.message); }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
