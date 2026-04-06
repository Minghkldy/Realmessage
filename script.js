const socket = io();
let currentChatId = "";
let allMessages = [];
let unreadCounts = {};
let cachedContacts = []; 

async function loadSystemSettings() {
    try {
        const res = await fetch('/api/admin/profile');
        const data = await res.json();
        
        if (data.nickname) {
            const elName = document.getElementById('top-admin-name');
            if (elName) elName.innerText = data.nickname;
        }
        
        const el = document.getElementById('top-admin-avatar');
        if (el && data.avatar) {
            if (data.avatar.startsWith('data:image') || data.avatar.startsWith('http')) {
                el.src = data.avatar;
            } else {
                el.src = `/uploads/${data.avatar}`;
            }
        }
    } catch (e) { console.error("Error loading settings:", e); }
}

function toggleLeftSidebar() { 
    const sidebar = document.getElementById('left-sidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('sidebar-collapsed'); 
    if(sidebar.classList.contains('sidebar-collapsed')) {
        const dropdown = document.getElementById('messenger-dropdown');
        if (dropdown) {
            dropdown.classList.remove('show');
            setTimeout(() => dropdown.classList.add('hidden'), 300);
        }
        const arrow = document.getElementById('arrow-icon');
        if (arrow) arrow.classList.remove('rotate-arrow');
    }
}

function toggleRightPanel() { 
    const panel = document.getElementById('right-panel');
    if (panel) panel.classList.toggle('hidden'); 
}

function toggleDropdown() {
    const sidebar = document.getElementById('left-sidebar');
    if(sidebar && sidebar.classList.contains('sidebar-collapsed')) toggleLeftSidebar();
    
    const dropdown = document.getElementById('messenger-dropdown');
    const arrow = document.getElementById('arrow-icon');
    if (!dropdown) return;

    if (dropdown.classList.contains('hidden')) {
        dropdown.classList.remove('hidden');
        dropdown.classList.add('flex');
        setTimeout(() => dropdown.classList.add('show'), 10);
    } else {
        dropdown.classList.remove('show');
        setTimeout(() => {
            dropdown.classList.remove('flex');
            dropdown.classList.add('hidden');
        }, 300);
    }
    if (arrow) arrow.classList.toggle('rotate-arrow');
}

function switchToInbox() {
    document.getElementById('main-dashboard-content').classList.remove('hidden');
    document.getElementById('bot-settings-area').classList.add('hidden');
    document.getElementById('inbox-nav').classList.add('active-nav');
    document.getElementById('bot-config-nav').classList.remove('active-nav');
    document.getElementById('broadcast-nav').classList.remove('active-nav');
    document.getElementById('sidebar-settings').classList.remove('active-nav');
    filterContacts('all');
}

function loadBotSettings() {
    document.getElementById('main-dashboard-content').classList.add('hidden');
    document.getElementById('bot-settings-area').classList.remove('hidden');
    document.getElementById('right-panel').classList.add('hidden');
    document.getElementById('inbox-nav').classList.remove('active-nav');
    document.getElementById('sidebar-settings').classList.remove('active-nav');
    document.getElementById('broadcast-nav').classList.remove('active-nav');
    document.getElementById('bot-config-nav').classList.add('active-nav');
    document.getElementById('settings-frame').src = "bot-config.html";
}

function loadBroadcastSettings() {
    document.getElementById('main-dashboard-content').classList.add('hidden');
    document.getElementById('bot-settings-area').classList.remove('hidden');
    document.getElementById('right-panel').classList.add('hidden');
    document.getElementById('inbox-nav').classList.remove('active-nav');
    document.getElementById('sidebar-settings').classList.remove('active-nav');
    document.getElementById('bot-config-nav').classList.remove('active-nav');
    document.getElementById('broadcast-nav').classList.add('active-nav');
    document.getElementById('settings-frame').src = "broadcast.html";
}

function loadGeneralSettings() {
    document.getElementById('main-dashboard-content').classList.add('hidden');
    document.getElementById('bot-settings-area').classList.remove('hidden');
    document.getElementById('right-panel').classList.add('hidden');
    document.getElementById('inbox-nav').classList.remove('active-nav');
    document.getElementById('bot-config-nav').classList.remove('active-nav');
    document.getElementById('broadcast-nav').classList.remove('active-nav');
    document.getElementById('sidebar-settings').classList.add('active-nav');
    document.getElementById('settings-frame').src = "general-settings.html";
}

function showImagePreview(url) {
    const modal = document.getElementById('imagePreviewModal');
    const img = document.getElementById('previewImg');
    if (modal && img) {
        img.src = url;
        modal.style.display = 'flex';
    }
}

function closeImagePreview() {
    const modal = document.getElementById('imagePreviewModal');
    if (modal) modal.style.display = 'none';
}

async function loadContacts() {
    try {
        const res = await fetch('/api/contacts');
        cachedContacts = await res.json();
        renderContacts(cachedContacts);
    } catch (err) { console.error(err); }
}

function filterContacts(platform) {
    let filtered;
    const title = document.getElementById('inbox-title');
    if (platform === 'all') {
        filtered = cachedContacts;
        if (title) title.innerText = "Inbox";
    } else {
        filtered = cachedContacts.filter(c => c.platform.toLowerCase() === platform.toLowerCase());
        if (title) title.innerText = platform.toUpperCase();
    }
    renderContacts(filtered);
}

function renderContacts(contacts) {
    const container = document.getElementById('contacts-container');
    if (!container) return;
    container.innerHTML = '';
    contacts.forEach(c => {
        const count = unreadCounts[c.chat_id] || 0;
        const item = document.createElement('div');
        item.className = `p-3 rounded-xl flex items-center gap-3 cursor-pointer transition hover:bg-dark-gray ${currentChatId === c.chat_id ? 'active-contact' : ''}`;
        item.onclick = () => selectContact(c);
        const avatar = c.profile_pic ? `<img src="${c.profile_pic}" class="w-10 h-10 rounded-full object-cover border border-border-gray">` : `<div class="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-xs font-bold border border-border-gray uppercase">${(c.nickname || c.first_name || "?").charAt(0)}</div>`;
        item.innerHTML = `
            ${avatar}
            <div class="flex-1 min-w-0">
                <p class="text-sm font-bold truncate ${count > 0 ? 'text-white' : 'text-gray-400'}">${c.nickname || c.first_name}</p>
                <p class="text-[10px] text-gray-500 uppercase tracking-tighter">${c.platform}</p>
            </div>
            ${count > 0 ? `<span class="bg-accent-blue text-[10px] w-5 h-5 flex items-center justify-center rounded-full text-white noti-badge font-bold">${count}</span>` : ''}
        `;
        container.appendChild(item);
    });
    updateGlobalBadge();
}

function selectContact(contact) {
    currentChatId = contact.chat_id;
    unreadCounts[currentChatId] = 0; 
    const displayName = contact.nickname || contact.first_name;
    
    document.getElementById('chat-header-name').innerText = displayName;
    document.getElementById('edit-nickname').value = displayName;
    document.getElementById('contact-note').value = contact.notes || "";
    document.getElementById('side-platform').innerText = `Platform: ${contact.platform}`;
    
    const hImg = document.getElementById('header-avatar-img');
    const hTxt = document.getElementById('header-avatar-text');
    const sImg = document.getElementById('side-avatar-img');
    const sTxt = document.getElementById('side-avatar-text');
    
    if(contact.profile_pic) {
        hImg.src = contact.profile_pic; hImg.classList.remove('hidden'); hTxt.classList.add('hidden');
        sImg.src = contact.profile_pic; sImg.classList.remove('hidden'); sTxt.classList.add('hidden');
    } else {
        const initial = (displayName || "?").charAt(0);
        hTxt.innerText = initial; hTxt.classList.remove('hidden'); hImg.classList.add('hidden');
        sTxt.innerText = initial; sTxt.classList.remove('hidden'); sImg.classList.add('hidden');
    }
    
    document.getElementById('chat-status').innerText = `${contact.platform} ACTIVE`;
    document.getElementById('chat-status').className = "text-[10px] text-green-500 uppercase font-bold";
    
    socket.emit('mark_as_read', { chatId: currentChatId });
    updateGlobalBadge();
    renderContacts(cachedContacts); 
    renderMessages();
}

function updateGlobalBadge() {
    const total = Object.values(unreadCounts).reduce((a, b) => a + b, 0);
    const badge = document.getElementById('global-msg-count');
    const bell = document.getElementById('noti-bell');
    if (!badge || !bell) return;

    if (total > 0) {
        badge.innerText = total; badge.classList.remove('hidden');
        bell.classList.remove('hidden'); bell.classList.add('ring-animation', 'text-yellow-400');
    } else {
        badge.classList.add('hidden'); bell.classList.add('hidden');
        bell.classList.remove('ring-animation', 'text-yellow-400');
    }
}

async function loadHistory() {
    try {
        const response = await fetch('/api/messages');
        allMessages = await response.json();
        if(currentChatId) renderMessages();
    } catch (err) { console.error(err); }
}

function renderMessages() {
    const win = document.getElementById('chat-window');
    if (!win) return;
    win.innerHTML = "";
    const filtered = allMessages.filter(m => m.chat_id === currentChatId);
    filtered.forEach(msg => appendMessage(msg, msg.sender_type === 'bot'));
    win.scrollTo({ top: win.scrollHeight, behavior: 'auto' });
}

function appendMessage(data, isBot) {
    const win = document.getElementById('chat-window');
    if (!win) return;
    let contentHtml = data.text || "";
    let mediaUrl = data.file_url || data.fileUrl;
    const mediaType = data.file_type || data.fileType || "";
    const msgTime = data.time || ""; 
    const readStatus = data.is_read ? 'SEEN' : 'SENT';
    const statusColor = data.is_read ? 'text-accent-blue' : 'text-gray-500';

    if (mediaUrl) {
        if (!mediaUrl.startsWith('data:') && !mediaUrl.startsWith('http')) {
            mediaUrl = `/uploads/${mediaUrl}`;
        }

        if (mediaType.includes('image') || mediaUrl.match(/\.(jpeg|jpg|gif|png|webp)$/i)) {
            contentHtml = `<img src="${mediaUrl}" class="max-w-xs rounded-lg mt-2 cursor-pointer border border-border-gray shadow-md hover:opacity-80 transition" onclick="showImagePreview('${mediaUrl}')" onerror="this.src='https://placehold.co/200x200?text=Image+Not+Found'">`;
        } else if (mediaType.includes('video')) {
            contentHtml = `<video controls class="max-w-xs rounded-lg mt-2 border border-border-gray shadow-md"><source src="${mediaUrl}"></video>`;
        } else if (mediaType.includes('audio')) {
            contentHtml = `<audio controls class="mt-2 w-full max-w-[240px]"><source src="${mediaUrl}"></audio>`;
        }
        if(data.text && !data.text.includes("Sent an image")) contentHtml = `<p class="mb-2">${data.text}</p>` + contentHtml;
    }

    const msgHtml = isBot ? `
        <div class="self-end max-w-[75%]">
            <div class="bg-accent-blue p-4 rounded-2xl rounded-tr-none text-sm font-medium shadow-lg">${contentHtml}</div>
            <div class="flex items-center justify-end gap-2 mt-1">
                <span class="text-[9px] text-gray-500 uppercase">${msgTime}</span>
                <span class="text-[9px] font-bold uppercase status-indicator ${statusColor}" id="status-${data.id}">${readStatus}</span>
            </div>
        </div>
    ` : `
        <div class="flex items-start gap-3 max-w-[75%]">
            <div class="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 border border-border-gray bg-gray-900 flex items-center justify-center text-[10px]">
                ${data.profile_pic ? `<img src="${data.profile_pic}" class="w-full h-full object-cover">` : `<i class="fas fa-user text-gray-500"></i>`}
            </div>
            <div>
                <div class="bg-dark-gray border border-border-gray p-4 rounded-2xl rounded-tl-none text-sm leading-relaxed">
                    <p class="text-[10px] text-sky-400 mb-1 font-bold">${data.sender || 'User'}</p>${contentHtml}
                </div>
                <p class="text-[9px] text-gray-600 mt-1 uppercase">${msgTime}</p>
            </div>
        </div>
    `;
    win.insertAdjacentHTML('beforeend', msgHtml);
    win.scrollTo({ top: win.scrollHeight, behavior: 'smooth' });
}

async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file || !currentChatId) return alert("Select a chat first!");
    const formData = new FormData();
    formData.append('file', file);
    formData.append('chatId', currentChatId);
    try {
        const response = await fetch('/api/upload', { method: 'POST', body: formData });
        if (response.ok) event.target.value = ""; else alert("Upload failed!");
    } catch (err) { alert("Error connecting to server."); }
}

socket.on('new_message', (data) => {
    const senderId = data.chat_id || data.chatId;
    allMessages.push(data);
    if (currentChatId === senderId) {
        appendMessage(data, data.sender_type === 'bot');
        socket.emit('mark_as_read', { chatId: currentChatId });
    } else {
        unreadCounts[senderId] = (unreadCounts[senderId] || 0) + 1;
        const sound = document.getElementById('notif-sound');
        if (sound) sound.play().catch(() => {});
        renderContacts(cachedContacts);
    }
});

socket.on('messages_read', (data) => {
    if (data.chatId === currentChatId) {
        document.querySelectorAll('.status-indicator').forEach(el => {
            el.innerText = 'SEEN';
            el.classList.add('text-accent-blue');
            el.classList.remove('text-gray-500');
        });
        allMessages.forEach(m => {
            if(m.chat_id === data.chatId) m.is_read = true;
        });
    }
});

function sendMessage() {
    const input = document.getElementById('user-input');
    if (!input) return;
    const text = input.value.trim();
    if(text !== "" && currentChatId !== "") {
        socket.emit('send_reply', { chatId: currentChatId, text: text });
        input.value = ""; 
        unreadCounts[currentChatId] = 0;
    } else if (!currentChatId) alert("Please select a contact first.");
}

async function updateNickname() {
    if (!currentChatId) return;
    const input = document.getElementById('edit-nickname');
    if (!input) return;
    const newName = input.value;
    await fetch('/api/contacts/nickname', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: currentChatId, nickname: newName }) });
    loadContacts();
}

async function saveNote() {
    if (!currentChatId) return;
    const noteArea = document.getElementById('contact-note');
    if (!noteArea) return;
    const noteValue = noteArea.value;
    await fetch('/api/contacts/note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: currentChatId, note: noteValue }) });
}

async function toggleBlock() {
    if (!currentChatId || !confirm("Block this customer?")) return;
    await fetch('/api/contacts/block', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: currentChatId }) });
    location.reload();
}

async function deleteContact() {
    if (!currentChatId || !confirm("Delete this conversation?")) return;
    await fetch(`/api/contacts/${currentChatId}`, { method: 'DELETE' });
    location.reload();
}

function handleKeyPress(e) { if (e.key === 'Enter') sendMessage(); }

// အောက်ပါ Window Onload အပိုင်းသည် HTML element များအားလုံး အဆင်သင့်ဖြစ်မှ အလုပ်လုပ်စေမည်ဖြစ်သည်
window.addEventListener('DOMContentLoaded', () => { 
    loadSystemSettings(); 
    loadContacts(); 
    loadHistory(); 
});
