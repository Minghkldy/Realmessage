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

// Token ကို process.env ထဲကပဲ အဓိက ယူစေချင်ပါတယ် (Security အတွက်)
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

app.use(bodyParser.json({ limit: '50mb' })); 
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname)));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Database Initialization - ဇယားတွေကို ပိုသေချာအောင် ပြင်ဆင်ထားပါတယ်
const initDb = async () => {
    try {
        // Contacts Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS contacts (
                chat_id TEXT PRIMARY KEY, 
                first_name TEXT, 
                profile_pic TEXT, 
                platform TEXT, 
                status TEXT DEFAULT 'active', 
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Messages Table (sender_name နဲ့ receiver_name ကို သေချာအောင် ထည့်ထားပါတယ်)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY, 
                sender_name TEXT, 
                message_text TEXT, 
                platform TEXT, 
                chat_id TEXT, 
                receiver_name TEXT, 
                is_read BOOLEAN DEFAULT false, 
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Settings Table
        await pool.query(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
        
        if (TELEGRAM_TOKEN) {
            await pool.query("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", ['telegram_token', TELEGRAM_TOKEN]);
        }
        
        console.log("✅ Supabase Database Ready & Tables Verified.");
    } catch (err) { 
        console.error("❌ DB Init Error:", err.message); 
    }
};
initDb();

// Unified Message Handling
async function handleIncomingMessage(payload) {
    const { sender, text, platform, chatId, profilePic } = payload;
    try {
        // ၁။ Contact ကို အရင် သိမ်းမယ်/Update လုပ်မယ်
        await pool.query(`
            INSERT INTO contacts (chat_id, first_name, profile_pic, platform) 
            VALUES ($1, $2, $3, $4) 
            ON CONFLICT (chat_id) DO UPDATE SET 
            first_name = EXCLUDED.first_name, 
            profile_pic = EXCLUDED.profile_pic, 
            platform = EXCLUDED.platform`, 
            [chatId, sender, profilePic, platform]
        );

        // ၂။ Message ကို သိမ်းမယ်
        const msgRes = await pool.query(
            "INSERT INTO messages (sender_name, message_text, platform, chat_id, receiver_name) VALUES ($1, $2, $3, $4, $5) RETURNING *, TO_CHAR(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yangon', 'HH12:MI AM') as time",
            [sender, text, platform, chatId, 'Admin']
        );

        // Socket.io ကနေ Dashboard ကို ချက်ချင်း အကြောင်းကြားမယ်
        io.emit('new_message', msgRes.rows[0]);
    } catch (err) { 
        console.error("❌ Database Save Error:", err.message); 
    }
}

// Telegram Webhook
app.post('/webhook/telegram', async (req, res) => {
    const update = req.body;
    if (update.message && update.message.text && !update.message.from.is_bot) {
        const chatId = update.message.chat.id.toString();
        const sender = update.message.from.first_name || "Telegram User";
        const text = update.message.text;
        await handleIncomingMessage({ sender, text, platform: 'telegram', chatId, profilePic: '' });
    }
    res.sendStatus(200);
});

// API Routes
app.get('/api/messages', async (req, res) => {
    try {
        const result = await pool.query("SELECT *, TO_CHAR(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yangon', 'HH12:MI AM') as time FROM messages ORDER BY id ASC");
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/contacts', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM contacts ORDER BY created_at DESC");
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Socket.io: Dashboard Reply (Admin ကနေ အသုံးပြုသူဆီ စာပြန်ခြင်း)
io.on('connection', (socket) => {
    console.log('Admin connected to socket');
    
    socket.on('send_reply', async (data) => {
        const { chatId, text, platform } = data;
        try {
            // Telegram သို့ စာပို့ခြင်း
            if (platform === 'telegram') {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                    chat_id: chatId,
                    text: text
                });
            }

            // Database ထဲမှာ Admin ရဲ့ Reply ကို သိမ်းဆည်းခြင်း
            const replyRes = await pool.query(
                "INSERT INTO messages (sender_name, message_text, platform, chat_id, receiver_name) VALUES ($1, $2, $3, $4, $5) RETURNING *, TO_CHAR(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yangon', 'HH12:MI AM') as time", 
                ['Admin', text, 'admin', chatId, 'User']
            );
            
            io.emit('new_message', replyRes.rows[0]);
        } catch (e) { 
            console.error("❌ Reply Error:", e.response ? e.response.data : e.message); 
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
