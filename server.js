const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(bodyParser.json());
// Static files (CSS, JS) တွေရှိရင် သိနိုင်အောင် ထည့်ထားပေးပါတယ်
app.use(express.static(path.join(__dirname)));

// --- ပြင်လိုက်တဲ့ အပိုင်း ---
// parameter မှာ (req, res) နှစ်ခုလုံး ပါရပါမယ်
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Telegram Webhook
app.post('/webhook/telegram', async (req, res) => {
    try {
        const update = req.body;
        if (update.message) {
            const chatId = update.message.chat.id;
            const text = update.message.text || "";
            const sender = update.message.from.first_name || "Unknown";

            // Dashboard ဆီ စာလှမ်းပို့မယ်
            io.emit('new_message', {
                platform: 'Telegram',
                sender: sender,
                text: text,
                chatId: chatId
            });

            // Auto Reply Logic
            if (text.toLowerCase() === '/start' || text.toLowerCase() === 'hi') {
                await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
                    chat_id: chatId,
                    text: "မင်္ဂလာပါ! Realmessage Bot မှ ကြိုဆိုပါတယ်။"
                });
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error("Webhook Error:", error.message);
        res.sendStatus(500); // Error ဖြစ်ရင် 500 ပြန်မယ်
    }
});

// Website ကနေ ပြန်ပို့တဲ့စာကို Telegram ဆီ ပို့ပေးမယ်
io.on('connection', (socket) => {
    console.log('A user connected to dashboard'); // connection စစ်ဆေးရန်

    socket.on('send_reply', async (data) => {
        try {
            if (data.chatId && data.text) {
                await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
                    chat_id: data.chatId,
                    text: data.text
                });
            }
        } catch (e) { 
            console.log("Error sending reply:", e.message); 
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
