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

// ၁။ Database Tables - (Step 1: status နဲ့ notes column များ ထည့်သွင်းထားသည်)
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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // လက်ရှိ table ထဲကို column အသစ်များ manual ထည့်ခြင်း (Error မတက်အောင်)
        await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';`);
        await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS notes TEXT;`);

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
        
        // sender_type column မရှိသေးလျှင် ထည့်ရန်
        await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_type TEXT;`);
        
        console.log("✅ Database structure is updated with Management features.");
    } catch (err) {
        console.error("❌ DB Init Error:", err.message);
    }
};
initDb();

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// ၂။ Telegram Profile Pic ယူသည့် Function
async function getTelegramProfilePic(userId) {
    try {
        const res = await axios.get(`https://api.telegram.org/bot${TG_TOKEN}/getUserProfilePhotos?user_id=${userId}`);
        if (res.data.result.total_count > 0) {
            const fileId = res.data.result.photos[0][0].file_id;
            const fileRes = await axios.get(`https://api.telegram.org/bot${TG_TOKEN}/getFile?file_id=${fileId}`);
            return `https://api.telegram.org/file/bot${TG_TOKEN}/${fileRes.data.result.file_path}`;
        }
        return `https://ui-avatars.com/api/?name=User&background=random`;
    } catch (e) { 
        return `https://ui-avatars.com/api/?name=User&background=random`; 
    }
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API လမ်းကြောင်းများ
app.get('/api/messages', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM messages ORDER BY created_at ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/contacts', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM contacts ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Step 2: Management APIs (Block, Note, Delete) ---

// User ကို Block/Unblock လုပ်ရန်
app.post('/api/contacts/status', async (req, res) => {
    const { chatId, status } = req.body;
    try {
        await pool.query('UPDATE contacts SET status = $1 WHERE chat_id = $2', [status, chatId]);
        res.json({ success: true, status: status });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// User အတွက် Note သိမ်းရန်
app.post('/api/contacts/note', async (req, res) => {
    const { chatId, note } = req.body;
    try {
        await pool.query('UPDATE contacts SET notes = $1 WHERE chat_id = $2', [note, chatId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Chat တစ်ခုလုံးကို ဖျက်ပစ်ရန်
app.delete('/api/contacts/:chatId', async (req, res) => {
    const { chatId } = req.params;
    try {
        await pool.query('DELETE FROM messages WHERE chat_id = $1', [chatId]);
        await pool.query('DELETE FROM contacts WHERE chat_id = $1', [chatId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ၃။ Webhook with Block Logic ---
app.post('/webhook/telegram', async (req, res) => {
    const update = req.body;
    if (update.message) {
        const chatId = update.message.chat.id.toString();
        
        // စာမသိမ်းခင် Block ထားခြင်း ရှိ/မရှိ စစ်ဆေးခြင်း
        const checkStatus = await pool.query('SELECT status FROM contacts WHERE chat_id = $1', [chatId]);
        if (checkStatus.rows.length > 0 && checkStatus.rows[0].status === 'blocked') {
            console.log(`Message from blocked user ${chatId} ignored.`);
            return res.sendStatus(200);
        }

        const text = update.message.text || "";
        const firstName = update.message.from.first_name || "";
        const lastName = update.message.from.last_name || "";
        const sender = `${firstName} ${lastName}`.trim() || "Unknown User";
        const username = update.message.from.username || "";

        try {
            const profilePic = await getTelegramProfilePic(chatId);
            
            await pool.query(`
                INSERT INTO contacts (chat_id, first_name, username, profile_pic, platform)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (chat_id) DO UPDATE SET 
                    first_name = EXCLUDED.first_name, 
                    profile_pic = EXCLUDED.profile_pic,
                    username = EXCLUDED.username
            `, [chatId, sender, username, profilePic, 'Telegram']);

            await pool.query(
                'INSERT INTO messages (sender, text, platform, chat_id, sender_type) VALUES ($1, $2, $3, $4, $5)',
                [sender, text, 'Telegram', chatId, 'user']
            );

            io.emit('new_message', {
                sender: sender,
                text: text,
                chatId: chatId,
                profile_pic: profilePic,
                sender_type: 'user'
            });
        } catch (err) { console.error("Webhook Save Error:", err.message); }
    }
    res.sendStatus(200);
});

// ၄။ Dashboard Reply Logic
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
        } catch (e) { console.error("Dashboard Reply Error:", e.message); }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
