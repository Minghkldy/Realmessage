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

// Database Table - Column တွေကို အသစ်ပြန်စစ်ပြီး လိုအပ်တာ ထပ်ထည့်ပေးမယ့် function
const initDb = async () => {
    try {
        // ၁။ Table မရှိရင် အရင်ဆောက်မယ်
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
        
        // ၂။ sender_type ဆိုတဲ့ column မရှိရင် အတင်းထည့်ခိုင်းမယ် (Refresh ပြဿနာ ဖြေရှင်းရန်)
        await pool.query(`
            ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_type TEXT;
        `);

        console.log("Database table and columns are ready.");
    } catch (err) {
        console.error("DB Init Error:", err.message);
    }
};
initDb();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// စာအားလုံးကို ပြန်ထုတ်ပေးမယ့် API (index.html က ဒါကို ခေါ်သုံးတာပါ)
app.get('/api/messages', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM messages ORDER BY created_at ASC');
        res.json(result.rows);
    } catch (err) {
        console.error("Fetch API Error:", err.message);
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
        const sender = update.message.from.first_name || "Unknown User";

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
        } catch (err) { 
            console.error("Telegram Webhook Save Error:", err.message); 
        }
    }
    res.sendStatus(200);
});

// Dashboard ကနေစာပြန်ပို့ရင် 'bot' အဖြစ် Database ထဲသိမ်းမယ်
io.on('connection', (socket) => {
    console.log("New dashboard connection established");

    socket.on('send_reply', async (data) => {
        try {
            // ၁။ Telegram API ဆီ အရင်ပို့မယ်
            await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
                chat_id: data.chatId,
                text: data.text
            });

            // ၂။ သိမ်းတဲ့နေရာမှာ sender_type ကို 'bot' လို့ သေချာထည့်မယ်
            await pool.query(
                'INSERT INTO messages (sender, text, platform, chat_id, sender_type) VALUES ($1, $2, $3, $4, $5)',
                ['Dashboard', data.text, 'Telegram', data.chatId, 'bot']
            );
            
            console.log(`Reply to ${data.chatId} saved successfully.`);
        } catch (e) { 
            console.error("Dashboard Reply Save Error:", e.message); 
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
