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

// --- Middleware ---
app.use(bodyParser.json({ limit: '50mb' })); 
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname)));

// Database Pool Setup (Supabase Connection String)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ၁။ Database Tables Initialization
const initDb = async () => {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS contacts (chat_id TEXT PRIMARY KEY, first_name TEXT, profile_pic TEXT, platform TEXT, status TEXT DEFAULT 'active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, sender TEXT, text TEXT, platform TEXT, chat_id TEXT, sender_type TEXT, is_read BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
        console.log("✅ Supabase Database Ready.");
    } catch (err) { console.error("❌ DB Init Error:", err.message); }
};
initDb();

// ၂။ Unified Message Logic (Supabase ထဲ သိမ်းမည့်အပိုင်း)
async function handleIncomingMessage(payload) {
    const { sender, text, platform, chatId, profilePic } = payload;
    try {
        // Save/Update Contact
        await pool.query(`
            INSERT INTO contacts (chat_id, first_name, profile_pic, platform) 
            VALUES ($1, $2, $3, $4) 
            ON CONFLICT (chat_id) DO UPDATE SET first_name = EXCLUDED.first_name, profile_pic = EXCLUDED.profile_pic, platform = EXCLUDED.platform`, 
            [chatId, sender, profilePic, platform]
        );

        // Save Message
        const msgRes = await pool.query(
            "INSERT INTO messages (sender, text, platform, chat_id, sender_type) VALUES ($1, $2, $3, $4, $5) RETURNING *, TO_CHAR(created_at, 'HH12:MI AM') as time",
            [sender, text, platform, chatId, 'user']
        );

        io.emit('new_message', msgRes.rows[0]);
    } catch (err) { console.error("Database Save Error:", err.message); }
}

// --- WEBHOOKS ---

// (က) Telegram Webhook
app.post('/webhook/telegram', async (req, res) => {
    const update = req.body;
    if (!update.message || update.message.from.is_bot) return res.sendStatus(200);

    const chatId = update.message.chat.id.toString();
    const sender = update.message.from.first_name || "Telegram User";
    const text = update.message.text || "Sent an attachment";
    
    await handleIncomingMessage({ sender, text, platform: 'Telegram', chatId, profilePic: '' });
    res.sendStatus(200);
});

// (ခ) Viber Webhook
app.post('/webhook/viber', async (req, res) => {
    const update = req.body;
    if (update.event === 'message') {
        const chatId = update.sender.id;
        const sender = update.sender.name;
        const text = update.message.text;
        
        await handleIncomingMessage({ sender, text, platform: 'Viber', chatId, profilePic: update.sender.avatar });
    }
    res.sendStatus(200);
});

// (ဂ) Messenger Webhook
app.get('/webhook/messenger', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode && token === process.env.FB_VERIFY_TOKEN) res.status(200).send(challenge);
    else res.sendStatus(403);
});

app.post('/webhook/messenger', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        body.entry.forEach(async (entry) => {
            const webhook_event = entry.messaging[0];
            if (webhook_event.message && !webhook_event.message.is_echo) {
                const chatId = webhook_event.sender.id;
                const text = webhook_event.message.text;
                await handleIncomingMessage({ sender: "FB User", text, platform: 'Messenger', chatId, profilePic: '' });
            }
        });
        res.status(200).send('EVENT_RECEIVED');
    } else { res.sendStatus(404); }
});

// --- API Routes ---
app.get('/api/messages', async (req, res) => {
    const result = await pool.query("SELECT *, TO_CHAR(created_at, 'HH12:MI AM') as time FROM messages ORDER BY id ASC");
    res.json(result.rows);
});

app.get('/api/contacts', async (req, res) => {
    const result = await pool.query('SELECT * FROM contacts ORDER BY created_at DESC');
    res.json(result.rows);
});

// --- Socket.io: စာပြန်ပို့တဲ့အပိုင်း ---
io.on('connection', (socket) => {
    socket.on('send_reply', async (data) => {
        const { chatId, text, platform } = data;
        try {
            // Platform အလိုက် API လှမ်းခေါ်ခြင်း (Telegram သာ နမူနာပြထားသည်)
            if (platform === 'Telegram') {
                const tokenRes = await pool.query("SELECT value FROM settings WHERE key = 'telegram_token'");
                await axios.post(`https://api.telegram.org/bot${tokenRes.rows[0].value}/sendMessage`, { chat_id: chatId, text: text });
            }
            // Database ထဲ သိမ်းခြင်း
            await pool.query("INSERT INTO messages (sender, text, platform, chat_id, sender_type) VALUES ($1, $2, $3, $4, $5)", 
                ['Admin', text, platform, chatId, 'bot']);
            
            io.emit('new_message', { sender: 'Admin', text, chat_id: chatId, sender_type: 'bot' });
        } catch (e) { console.error("Reply Error"); }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
