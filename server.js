const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

// index.html ကို လှမ်းပြဖို့
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Telegram Webhook
app.post('/webhook/telegram', async (req, res) => {
    const update = req.body;
    if (update.message && update.message.text) {
        const chatId = update.message.chat.id;
        const text = update.message.text.toLowerCase();

        // Auto Reply Logic
        if (text === '/start' || text.includes('hi')) {
            await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
                chat_id: chatId,
                text: "မင်္ဂလာပါ! Realmessage Bot မှ ကြိုဆိုပါတယ်။"
            });
        }
    }
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
