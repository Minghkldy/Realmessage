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

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Database Table တည်ဆောက်ခြင်း (sender_type တိုးထားပါတယ်)
const initDb = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                sender TEXT,
                text TEXT,
                platform TEXT,
                chat_id TEXT,
                sender_type TEXT, -- 'user' သို့မဟုတ် 'bot'
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("Database table synchronized.");
    } catch (err) {
        console.error("DB Init Error:", err.message);
    }
};
initDb();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// စာဟောင်းများအားလုံး ပြန်ထုတ်ပေးသည့် API
app.get('/api/messages', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM messages ORDER BY created_at ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// --- Telegram ကစာဝင်လာရင် သိမ်းတဲ့အပိုင်း ---
app.post('/webhook/telegram', async (req, res) => {
    const update = req.body;
    if (update.message) {
        const chatId = update.message.chat.id.toString();
        const text = update.message.text || "";
        const sender = update.message.from.first_name || "Unknown";

        try {
            // Database မှာ 'user' အဖြစ် သိမ်းမယ်
            await pool.query(
                'INSERT INTO messages (sender, text, platform, chat_id, sender_type) VALUES ($1, $2, $3, $4, $5)',
                [sender, text, 'Telegram', chatId, 'user']
            );

            io.emit('new_message', {
                sender: sender,
                text: text,
                chatId: chatId,
                sender_type: 'user'
            });
        } catch (err) { console.error("Entry Error:", err.message); }
    }
    res.sendStatus(200);
});

// --- Dashboard ကနေ စာပြန်ပို့ရင် သိမ်းတဲ့အပိုင်း ---
io.on('connection', (socket) => {
    socket.on('send_reply', async (data) => {
        try {
            // ၁။ Telegram ဆီ ပို့မယ်
            await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
                chat_id: data.chatId,
                text: data.text
            });

            // ၂။ ကိုယ်ပို့လိုက်တဲ့စာကို Database မှာ 'bot' အဖြစ် သိမ်းမယ်
            await pool.query(
                'INSERT INTO messages (sender, text, platform, chat_id, sender_type) VALUES ($1, $2, $3, $4, $5)',
                ['Dashboard', data.text, 'Telegram', data.chatId, 'bot']
            );
        } catch (e) { console.log("Reply Save Error:", e.message); }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server started on ${PORT}`));
