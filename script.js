const socket = io();
let currentChatId = "";
let allMessages = [];
let unreadCounts = {};
let cachedContacts = [];

async function loadSystemSettings() {
    try {
        const response = await fetch('/api/settings');
        const settings = await response.json();
        if (settings.botName) { document.querySelectorAll('.bot-name-label').forEach(el => el.innerText = settings.botName); }
    } catch (err) { console.error("Failed to load settings"); }
}

function toggleLeftSidebar() {
    const sidebar = document.getElementById('left-sidebar');
    sidebar.classList.toggle('w-64');
    sidebar.classList.toggle('w-20');
    sidebar.querySelectorAll('span').forEach(label => label.classList.toggle('hidden'));
}

function toggleRightPanel() { document.getElementById('right-panel').classList.toggle('hidden'); }

function switchToInbox() {
    document.getElementById('inbox-view').classList.remove('hidden');
    document.getElementById('iframe-view').classList.add('hidden');
    document.getElementById('current-view-title').innerText = "Inbox";
    document.querySelectorAll('nav div').forEach(el => el.classList.remove('active-link'));
    document.getElementById('nav-inbox').classList.add('active-link');
}

function showIframe(url, title, navId) {
    document.getElementById('inbox-view').classList.add('hidden');
    document.getElementById('iframe-view').classList.remove('hidden');
    document.getElementById('settings-iframe').src = url;
    document.getElementById('current-view-title').innerText = title;
    document.querySelectorAll('nav div').forEach(el => el.classList.remove('active-link'));
    if(navId) document.getElementById(navId).classList.add('active-link');
}

function loadBotSettings() { showIframe('/bot-config.html', "Bot Config", 'nav-bot'); }
function loadBroadcastSettings() { showIframe('/broadcast.html', "Bulk Messaging", 'nav-broadcast'); }
function loadGeneralSettings() { showIframe('/general-settings.html', "Settings", null); }

function showImagePreview(url) {
    const img = document.getElementById('preview-img');
    img.src = url;
    document.getElementById('image-preview').classList.remove('hidden');
}

function closeImagePreview() { document.getElementById('image-preview').classList.add('hidden'); }

async function loadContacts() {
    const response = await fetch('/api/contacts');
    cachedContacts = await response.json();
    renderContacts(cachedContacts);
    updateGlobalBadge();
}

function renderContacts(contacts) {
    const list = document.getElementById('contact-list');
    list.innerHTML = contacts.map(c => {
        const unread = unreadCounts[c.chat_id] || 0;
        return `
            <div onclick='selectContact(${JSON.stringify(c)})' class="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ${currentChatId === c.chat_id ? 'bg-accent-blue/10 border border-accent-blue/20' : 'hover:bg-white/5 border border-transparent'}">
                <div class="relative">
                    <div class="w-10 h-10 rounded-full bg-dark-gray flex items-center justify-center font-bold text-xs border border-border-gray text-white">${(c.nickname || c.chat_id)[0]}</div>
                    <div class="absolute -bottom-1 -right-1 w-4 h-4 bg-pure-black rounded-full flex items-center justify-center"><i class="fab fa-${c.platform} text-[8px] text-blue-500"></i></div>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-center"><span class="text-sm font-bold truncate ${unread > 0 ? 'text-white' : 'text-gray-300'}">${c.nickname || c.chat_id}</span>${unread > 0 ? `<span class="bg-accent-blue text-[10px] px-1.5 py-0.5 rounded-full font-bold animate-pulse">${unread}</span>` : ''}</div>
                    <div class="text-[10px] text-gray-500 truncate uppercase mt-0.5">${c.platform} • Active</div>
                </div>
            </div>
        `;
    }).join('');
}

function selectContact(contact) {
    currentChatId = contact.chat_id;
    unreadCounts[currentChatId] = 0;
    document.getElementById('chat-header').classList.remove('hidden');
    document.getElementById('active-contact-name').innerText = contact.nickname || contact.chat_id;
    document.getElementById('active-contact-avatar').innerText = (contact.nickname || contact.chat_id)[0];
    document.getElementById('info-name').innerText = contact.nickname || contact.chat_id;
    document.getElementById('info-avatar').innerText = (contact.nickname || contact.chat_id)[0];
    document.getElementById('info-platform').innerText = `Platform: ${contact.platform}`;
    document.getElementById('contact-note').value = contact.note || "";
    renderContacts(cachedContacts);
    loadHistory();
    updateGlobalBadge();
    socket.emit('mark_as_read', { chatId: currentChatId });
}

function updateGlobalBadge() {
    const total = Object.values(unreadCounts).reduce((a, b) => a + b, 0);
    const badge = document.getElementById('global-unread');
    if (total > 0) { badge.innerText = total; badge.classList.remove('hidden'); } else badge.classList.add('hidden');
}

async function loadHistory() {
    if (!currentChatId) return;
    const response = await fetch(`/api/messages/${currentChatId}`);
    allMessages = await response.json();
    renderMessages();
}

function renderMessages() {
    const container = document.getElementById('chat-messages');
    container.innerHTML = allMessages.map(m => {
        const isBot = m.sender_type === 'bot';
        const isImage = m.text && m.text.match(/\.(jpeg|jpg|gif|png)$/) != null;
        return `
            <div class="flex ${isBot ? 'justify-end' : 'justify-start'}">
                <div class="max-w-[80%] flex flex-col ${isBot ? 'items-end' : 'items-start'}">
                    <div class="px-4 py-2.5 text-sm shadow-xl ${isBot ? 'chat-bubble-user text-white' : 'chat-bubble-bot text-gray-200 border border-border-gray'}">
                        ${isImage ? `<img src="${m.text}" onclick="showImagePreview('${m.text}')" class="rounded-lg max-w-xs cursor-pointer">` : m.text}
                    </div>
                </div>
            </div>
        `;
    }).join('');
    container.scrollTop = container.scrollHeight;
}

function sendMessage() {
    const input = document.getElementById('user-input');
    const text = input.value.trim();
    if(text !== "" && currentChatId !== "") {
        socket.emit('send_reply', { chatId: currentChatId, text: text });
        input.value = "";
    }
}

async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file || !currentChatId) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('chatId', currentChatId);
    await fetch('/api/upload', { method: 'POST', body: formData });
}

async function saveNote() {
    const note = document.getElementById('contact-note').value;
    await fetch('/api/contacts/note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: currentChatId, note }) });
}

function handleKeyPress(e) { if (e.key === 'Enter') sendMessage(); }

socket.on('new_message', (data) => {
    if (currentChatId === (data.chat_id || data.chatId)) { allMessages.push(data); renderMessages(); socket.emit('mark_as_read', { chatId: currentChatId }); }
    else { unreadCounts[data.chat_id || data.chatId] = (unreadCounts[data.chat_id || data.chatId] || 0) + 1; document.getElementById('notif-sound').play().catch(() => {}); renderContacts(cachedContacts); updateGlobalBadge(); }
});

window.onload = () => { loadSystemSettings(); loadContacts(); };
