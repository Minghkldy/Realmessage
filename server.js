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

app.get('/', (res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Telegram Webhook
app.post('/webhook/telegram', async (req, res) => {
    const update = req.body;
    if (update.message) {
        const chatId = update.message.chat.id;
        const text = update.message.text;
        const sender = update.message.from.first_name;

        // Dashboard ဆီ စာလှမ်းပို့မယ်
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
    }
    res.sendStatus(200);
});

// Website ကနေ ပြန်ပို့တဲ့စာကို Telegram ဆီ ပို့ပေးမယ်
io.on('connection', (socket) => {
    socket.on('send_reply', async (data) => {
        try {
            await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
                chat_id: data.chatId,
                text: data.text
            });
        } catch (e) { console.log("Error sending:", e.message); }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
