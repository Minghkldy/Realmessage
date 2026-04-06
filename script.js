const socket = io();
let currentChatId = "";
let allMessages = [];
let unreadCounts = {};
let cachedContacts = [];

async function loadSystemSettings() {
    try {
        const response = await fetch('/api/settings');
        const settings = await response.json();
        if (settings.botName) {
            document.querySelectorAll('.bot-name-label').forEach(el => el.innerText = settings.botName);
        }
    } catch (err) { console.error("Settings load error", err); }
}

function toggleLeftSidebar() {
    const sidebar = document.getElementById('left-sidebar');
    sidebar.classList.toggle('w-64');
    sidebar.classList.toggle('w-20');
    const labels = sidebar.querySelectorAll('span');
    labels.forEach(label => label.classList.toggle('hidden'));
}

function toggleRightPanel() {
    document.getElementById('right-panel').classList.toggle('hidden');
}

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

async function loadContacts() {
    const response = await fetch('/api/contacts');
    cachedContacts = await response.json();
    renderContacts(cachedContacts);
}

function renderContacts(contacts) {
    const list = document.getElementById('contact-list');
    list.innerHTML = contacts.map(c => `
        <div onclick='selectContact(${JSON.stringify(c)})' class="flex items-center gap-3 p-3 rounded-xl cursor-pointer hover:bg-white/5 ${currentChatId === c.chat_id ? 'bg-accent-blue/10 border border-accent-blue/20' : ''}">
            <div class="w-10 h-10 rounded-full bg-dark-gray flex items-center justify-center font-bold text-xs border border-border-gray">${(c.nickname || c.chat_id)[0]}</div>
            <div class="flex-1 min-w-0">
                <div class="flex justify-between items-center">
                    <span class="text-sm font-bold truncate">${c.nickname || c.chat_id}</span>
                </div>
                <div class="text-[10px] text-gray-500 uppercase">${c.platform}</div>
            </div>
        </div>
    `).join('');
}

function selectContact(contact) {
    currentChatId = contact.chat_id;
    document.getElementById('chat-header').classList.remove('hidden');
    document.getElementById('active-contact-name').innerText = contact.nickname || contact.chat_id;
    document.getElementById('contact-note').value = contact.note || "";
    loadHistory();
    socket.emit('mark_as_read', { chatId: currentChatId });
}

async function loadHistory() {
    const response = await fetch(`/api/messages/${currentChatId}`);
    allMessages = await response.json();
    renderMessages();
}

function renderMessages() {
    const container = document.getElementById('chat-messages');
    container.innerHTML = allMessages.map(m => {
        const isBot = m.sender_type === 'bot';
        return `
            <div class="flex ${isBot ? 'justify-end' : 'justify-start'}">
                <div class="max-w-[80%] ${isBot ? 'chat-bubble-user' : 'chat-bubble-bot'} px-4 py-2.5 text-sm shadow-xl">
                    ${m.text}
                </div>
            </div>
        `;
    }).join('');
    container.scrollTop = container.scrollHeight;
}

async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file || !currentChatId) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('chatId', currentChatId);
    await fetch('/api/upload', { method: 'POST', body: formData });
}

socket.on('new_message', (data) => {
    if (currentChatId === (data.chat_id || data.chatId)) {
        allMessages.push(data);
        renderMessages();
    } else {
        document.getElementById('notif-sound').play().catch(() => {});
        loadContacts();
    }
});

function sendMessage() {
    const input = document.getElementById('user-input');
    if(input.value.trim() !== "" && currentChatId !== "") {
        socket.emit('send_reply', { chatId: currentChatId, text: input.value.trim() });
        input.value = ""; 
    }
}

async function saveNote() {
    const note = document.getElementById('contact-note').value;
    await fetch('/api/contacts/note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: currentChatId, note }) });
}

function handleKeyPress(e) { if (e.key === 'Enter') sendMessage(); }

window.onload = () => { 
    loadSystemSettings(); 
    loadContacts(); 
};
