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

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// ၁။ Telegram User ရဲ့ Profile ပုံကို လှမ်းယူတဲ့ Function
async function getTelegramProfilePic(userId) {
    try {
        const res = await axios.get(`https://api.telegram.org/bot${TG_TOKEN}/getUserProfilePhotos?user_id=${userId}`);
        if (res.data.result.total_count > 0) {
            const fileId = res.data.result.photos[0][0].file_id;
            const fileRes = await axios.get(`https://api.telegram.org/bot${TG_TOKEN}/getFile?file_id=${fileId}`);
            return `https://api.telegram.org/file/bot${TG_TOKEN}/${fileRes.data.result.file_path}`;
        }
        return `https://ui-avatars.com/api/?name=User&background=random`; // ပုံမရှိရင် အလိုအလျောက် avatar ထုတ်ပေးမယ်
    } catch (e) { 
        return `https://ui-avatars.com/api/?name=User&background=random`; 
    }
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ၂။ API: စာဟောင်းတွေကို ပြန်ခေါ်တဲ့အပိုင်း
app.get('/api/messages', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM messages ORDER BY created_at ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ၃။ API: Contact စာရင်း (ManyChat လို ဘယ်ဘက်မှာပြဖို့)
app.get('/api/contacts', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM contacts ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ၄။ Telegram ကနေ စာဝင်လာတဲ့အခါ
app.post('/webhook/telegram', async (req, res) => {
    const update = req.body;
    if (update.message) {
        const chatId = update.message.chat.id.toString();
        const text = update.message.text || "";
        const sender = update.message.from.first_name || "Unknown";
        const username = update.message.from.username || "";

        try {
            // (က) User အချက်အလက်ကို Contacts Table မှာ အရင်သိမ်းမယ်
            const profilePic = await getTelegramProfilePic(chatId);
            await pool.query(`
                INSERT INTO contacts (chat_id, first_name, username, profile_pic, platform)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (chat_id) DO UPDATE SET 
                    first_name = EXCLUDED.first_name, 
                    profile_pic = EXCLUDED.profile_pic,
                    username = EXCLUDED.username
            `, [chatId, sender, username, profilePic, 'Telegram']);

            // (ခ) စာကို Messages Table မှာ သိမ်းမယ်
            await pool.query(
                'INSERT INTO messages (sender, text, platform, chat_id, sender_type) VALUES ($1, $2, $3, $4, $5)',
                [sender, text, 'Telegram', chatId, 'user']
            );

            // (ဂ) Dashboard ဆီ Real-time လှမ်းပို့မယ်
            io.emit('new_message', {
                sender: sender,
                text: text,
                chatId: chatId,
                profile_pic: profilePic,
                sender_type: 'user'
            });
        } catch (err) { console.error("Update Error:", err.message); }
    }
    res.sendStatus(200);
});

// ၅။ Dashboard ကနေ စာပြန်ပို့တဲ့အခါ
io.on('connection', (socket) => {
    socket.on('send_reply', async (data) => {
        try {
            await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
                chat_id: data.chatId,
                text: data.text
            });

            await pool.query(
                'INSERT INTO messages (sender, text, platform, chat_id, sender_type) VALUES ($1, $2, $3, $4, $5)',
                ['OmniBot', data.text, 'Telegram', data.chatId, 'bot']
            );
            console.log("Reply saved to DB");
        } catch (e) { console.error("Reply Error:", e.message); }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
