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
        // မင်းရဲ့ Table Column နာမည်တွေနဲ့ ကိုက်အောင် ကုဒ်ကို ပြင်ထားပါတယ်
        await pool.query(`CREATE TABLE IF NOT EXISTS contacts (chat_id TEXT PRIMARY KEY, first_name TEXT, profile_pic TEXT, platform TEXT, status TEXT DEFAULT 'active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, sender_name TEXT, message_text TEXT, platform TEXT, chat_id TEXT, receiver_name TEXT, is_read BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
        
        // Telegram Token ကို settings table ထဲ သိမ်းထားခြင်း
        if (process.env.TELEGRAM_BOT_TOKEN) {
            await pool.query("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", ['telegram_token', process.env.TELEGRAM_BOT_TOKEN]);
        }
        
        console.log("✅ Supabase Database Ready.");
    } catch (err) { console.error("❌ DB Init Error:", err.message); }
};
initDb();

// ၂။ Unified Message Logic (မင်းရဲ့ Supabase Column နာမည်တွေဖြစ်တဲ့ sender_name, message_text တို့ကို သုံးထားပါတယ်)
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

        // Save Message (receiver_name ကို 'Admin' လို့ သတ်မှတ်ထားပါတယ်)
        const msgRes = await pool.query(
            "INSERT INTO messages (sender_name, message_text, platform, chat_id, receiver_name) VALUES ($1, $2, $3, $4, $5) RETURNING *, TO_CHAR(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yangon', 'HH12:MI AM') as time",
            [sender, text, platform, chatId, 'Admin']
        );

        // UI ကို ချက်ချင်းပို့မယ်
        io.emit('new_message', msgRes.rows[0]);
    } catch (err) { console.error("❌ Database Save Error:", err.message); }
}

// --- WEBHOOKS ---

app.post('/webhook/telegram', async (req, res) => {
    const update = req.body;
    if (!update.message || update.message.from.is_bot) return res.sendStatus(200);

    const chatId = update.message.chat.id.toString();
    const sender = update.message.from.first_name || "Telegram User";
    const text = update.message.text || "Sent an attachment";
    
    await handleIncomingMessage({ sender, text, platform: 'telegram', chatId, profilePic: '' });
    res.sendStatus(200);
});

app.post('/webhook/viber', async (req, res) => {
    const update = req.body;
    if (update.event === 'message') {
        const chatId = update.sender.id;
        const sender = update.sender.name;
        const text = update.message.text;
        await handleIncomingMessage({ sender, text, platform: 'viber', chatId, profilePic: update.sender.avatar });
    }
    res.sendStatus(200);
});

app.get('/webhook/messenger', (req, res) => {
    if (req.query['hub.verify_token'] === process.env.FB_VERIFY_TOKEN) res.status(200).send(req.query['hub.challenge']);
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
                await handleIncomingMessage({ sender: "FB User", text, platform: 'messenger', chatId, profilePic: '' });
            }
        });
        res.status(200).send('EVENT_RECEIVED');
    } else { res.sendStatus(404); }
});

// --- API Routes ---
app.get('/api/messages', async (req, res) => {
    try {
        const result = await pool.query("SELECT *, TO_CHAR(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yangon', 'HH12:MI AM') as time FROM messages ORDER BY id ASC");
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Socket.io: Dashboard ကနေ စာပြန်ပို့တဲ့အပိုင်း ---
io.on('connection', (socket) => {
    socket.on('send_reply', async (data) => {
        const { chatId, text, platform } = data;
        try {
            // ၁။ Platform အလိုက် API လှမ်းခေါ်ခြင်း
            if (platform === 'telegram') {
                await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: chatId, text: text });
            }

            // ၂။ Database ထဲ သိမ်းခြင်း (platform ကို 'admin' လို့ သိမ်းပါမယ်)
            const replyRes = await pool.query(
                "INSERT INTO messages (sender_name, message_text, platform, chat_id, receiver_name) VALUES ($1, $2, $3, $4, $5) RETURNING *, TO_CHAR(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yangon', 'HH12:MI AM') as time", 
                ['Admin', text, 'admin', chatId, 'User']
            );
            
            io.emit('new_message', replyRes.rows[0]);
        } catch (e) { console.error("❌ Reply Error:", e.message); }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
