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

// Database Table - sender_type က 'bot' ဆိုရင် ကိုယ်ပို့တဲ့စာ၊ 'user' ဆိုရင် Telegram ကလာတဲ့စာ
const initDb = async () => {
    try {
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
        console.log("Database table connected.");
    } catch (err) {
        console.error("DB Init Error:", err.message);
    }
};
initDb();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// စာအားလုံးကို ပြန်ထုတ်ပေးမယ့် API
app.get('/api/messages', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM messages ORDER BY created_at ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Telegram ကစာဝင်လာရင် 'user' အဖြစ်သိမ်းမယ်
app.post('/webhook/telegram', async (req, res) => {
    const update = req.body;
    if (update.message) {
        const chatId = update.message.chat.id.toString();
        const text = update.message.text || "";
        const sender = update.message.from.first_name || "Unknown";

        try {
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
        } catch (err) { console.error("Save Error:", err.message); }
    }
    res.sendStatus(200);
});

// Dashboard ကနေစာပြန်ပို့ရင် 'bot' အဖြစ် Database ထဲသိမ်းမယ် (ဒါမှ Refresh လုပ်ရင်ပြန်ပေါ်မှာပါ)
io.on('connection', (socket) => {
    socket.on('send_reply', async (data) => {
        try {
            // ၁။ Telegram ဆီ အရင်ပို့မယ်
            await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
                chat_id: data.chatId,
                text: data.text
            });

            // ၂။ အခုပို့လိုက်တဲ့စာကို Database ထဲမှာ မဖြစ်မနေ သိမ်းမယ်
            await pool.query(
                'INSERT INTO messages (sender, text, platform, chat_id, sender_type) VALUES ($1, $2, $3, $4, $5)',
                ['Dashboard', data.text, 'Telegram', data.chatId, 'bot']
            );
            
            console.log("Reply saved to database successfully.");
        } catch (e) { 
            console.error("Reply Save Error:", e.message); 
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
