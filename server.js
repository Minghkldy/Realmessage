const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");
const { Pool } = require('pg'); // PostgreSQL အတွက်
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

// Database Table တည်ဆောက်ခြင်း
const initDb = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                sender TEXT,
                text TEXT,
                platform TEXT,
                chat_id TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("Database connected and table ready.");
    } catch (err) {
        console.error("DB Init Error:", err.message);
    }
};
initDb();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// စာဟောင်းများကို Database ကနေ ပြန်ထုတ်ပေးတဲ့ API
app.get('/api/messages', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM messages ORDER BY created_at ASC LIMIT 100');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Telegram Webhook
app.post('/webhook/telegram', async (req, res) => {
    const update = req.body;
    if (update.message) {
        const chatId = update.message.chat.id.toString();
        const text = update.message.text || "";
        const sender = update.message.from.first_name || "Unknown";

        try {
            // ၁။ Database ထဲမှာ စာကို အမြဲတမ်းသိမ်းမယ်
            await pool.query(
                'INSERT INTO messages (sender, text, platform, chat_id) VALUES ($1, $2, $3, $4)',
                [sender, text, 'Telegram', chatId]
            );

            // ၂။ Dashboard ဆီ Real-time ပို့မယ်
            io.emit('new_message', {
                platform: 'Telegram',
                sender: sender,
                text: text,
                chatId: chatId
            });

            // Auto Reply
            if (text.toLowerCase() === '/start' || text.toLowerCase() === 'hi') {
                await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
                    chat_id: chatId,
                    text: "မင်္ဂလာပါ! Realmessage Bot မှ ကြိုဆိုပါတယ်။"
                });
            }
        } catch (err) {
            console.error("Error processing message:", err.message);
        }
    }
    res.sendStatus(200);
});

io.on('connection', (socket) => {
    socket.on('send_reply', async (data) => {
        try {
            await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
                chat_id: data.chatId,
                text: data.text
            });
            
            // ကိုယ်ပြန်လိုက်တဲ့စာကိုလည်း Database ထဲ သိမ်းချင်ရင် ဒီမှာ query ထပ်ထည့်နိုင်ပါတယ်
        } catch (e) { console.log("Error sending:", e.message); }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
