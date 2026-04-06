// script.js အပြည့်အစုံ

// Socket.io initialization
const socket = io();

let currentChatId = "";
let allMessages = [];
let unreadCounts = {};
let cachedContacts = []; 

// System Settings loading
async function loadSystemSettings() {
    try {
        const res = await fetch('/api/admin/profile');
        const data = await res.json();
        
        const nameEl = document.getElementById('top-admin-name');
        if (data.nickname && nameEl) {
            nameEl.innerText = data.nickname;
        }
        
        const avatarEl = document.getElementById('top-admin-avatar');
        if (avatarEl && data.avatar) {
            if (data.avatar.startsWith('data:image') || data.avatar.startsWith('http')) {
                avatarEl.src = data.avatar;
            } else {
                avatarEl.src = `/uploads/${data.avatar}`;
            }
        }
    } catch (e) { console.error("Error loading settings:", e); }
}

// Sidebar logic
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
    if (sidebar && sidebar.classList.contains('sidebar-collapsed')) toggleLeftSidebar();
    
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

// Navigation logic
function switchToInbox() {
    const mainContent = document.getElementById('main-dashboard-content');
    const botArea = document.getElementById('bot-settings-area');
    if (mainContent) mainContent.classList.remove('hidden');
    if (botArea) botArea.classList.add('hidden');
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active-nav'));
    const inboxNav = document.getElementById('inbox-nav');
    if (inboxNav) inboxNav.classList.add('active-nav');
    
    filterContacts('all');
}

function loadBotSettings() {
    document.getElementById('main-dashboard-content')?.classList.add('hidden');
    document.getElementById('bot-settings-area')?.classList.remove('hidden');
    document.getElementById('right-panel')?.classList.add('hidden');
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active-nav'));
    document.getElementById('bot-config-nav')?.classList.add('active-nav');
    
    const frame = document.getElementById('settings-frame');
    if (frame) frame.src = "bot-config.html";
}

function loadBroadcastSettings() {
    document.getElementById('main-dashboard-content')?.classList.add('hidden');
    document.getElementById('bot-settings-area')?.classList.remove('hidden');
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active-nav'));
    document.getElementById('broadcast-nav')?.classList.add('active-nav');
    
    const frame = document.getElementById('settings-frame');
    if (frame) frame.src = "broadcast.html";
}

function loadGeneralSettings() {
    document.getElementById('main-dashboard-content')?.classList.add('hidden');
    document.getElementById('bot-settings-area')?.classList.remove('hidden');
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active-nav'));
    document.getElementById('sidebar-settings')?.classList.add('active-nav');
    
    const frame = document.getElementById('settings-frame');
    if (frame) frame.src = "general-settings.html";
}

// Image Preview
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

// Contacts and Messages Logic
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
    
    const headerName = document.getElementById('chat-header-name');
    const nickInput = document.getElementById('edit-nickname');
    const noteInput = document.getElementById('contact-note');
    const platformSide = document.getElementById('side-platform');
    
    if (headerName) headerName.innerText = displayName;
    if (nickInput) nickInput.value = displayName; // Input box ထဲကို နာမည်ထည့်ပေးမယ်
    if (noteInput) noteInput.value = contact.notes || "";
    if (platformSide) platformSide.innerText = `Platform: ${contact.platform}`;
    
    const hImg = document.getElementById('header-avatar-img');
    const hTxt = document.getElementById('header-avatar-text');
    const sImg = document.getElementById('side-avatar-img');
    const sTxt = document.getElementById('side-avatar-text');
    
    if(contact.profile_pic) {
        if(hImg) { hImg.src = contact.profile_pic; hImg.classList.remove('hidden'); }
        if(hTxt) hTxt.classList.add('hidden');
        if(sImg) { sImg.src = contact.profile_pic; sImg.classList.remove('hidden'); }
        if(sTxt) sTxt.classList.add('hidden');
    } else {
        const initial = (displayName || "?").charAt(0);
        if(hTxt) { hTxt.innerText = initial; hTxt.classList.remove('hidden'); }
        if(hImg) hImg.classList.add('hidden');
        if(sTxt) { sTxt.innerText = initial; sTxt.classList.remove('hidden'); }
        if(sImg) sImg.classList.add('hidden');
    }
    
    const status = document.getElementById('chat-status');
    if (status) {
        status.innerText = `${contact.platform} ACTIVE`;
        status.className = "text-[10px] text-green-500 uppercase font-bold";
    }
    
    socket.emit('mark_as_read', { chatId: currentChatId });
    updateGlobalBadge();
    renderContacts(cachedContacts); 
    renderMessages();
}

// နာမည်ပြောင်းလဲမှုကို Database မှာပါ Save လုပ်တဲ့ function
async function updateNickname() {
    const nickInput = document.getElementById('edit-nickname');
    if (!nickInput || !currentChatId) return;

    const newNickname = nickInput.value.trim();
    if (!newNickname) return alert("ကျေးဇူးပြု၍ နာမည်ထည့်ပေးပါ!");

    try {
        const res = await fetch('/api/contacts/update-nickname', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId: currentChatId, nickname: newNickname })
        });

        if (res.ok) {
            // Memory ထဲက contact စာရင်းကို update လုပ်မယ်
            const contact = cachedContacts.find(c => c.chat_id === currentChatId);
            if (contact) contact.nickname = newNickname;
            
            renderContacts(cachedContacts); 
            const headerName = document.getElementById('chat-header-name');
            if (headerName) headerName.innerText = newNickname;
            
            alert("နာမည်ပြောင်းလဲမှု အောင်မြင်ပါသည်!");
        } else {
            alert("နာမည်ပြင်လို့မရပါ။ Server error ဖြစ်နေပါသည်။");
        }
    } catch (err) { console.error("Error updating nickname:", err); }
}

function updateGlobalBadge() {
    const total = Object.values(unreadCounts).reduce((a, b) => a + b, 0);
    const badge = document.getElementById('global-msg-count');
    const bell = document.getElementById('noti-bell');
    
    if (badge) {
        if (total > 0) {
            badge.innerText = total; badge.classList.remove('hidden');
            if (bell) {
                bell.classList.remove('hidden'); 
                bell.classList.add('ring-animation', 'text-yellow-400');
            }
        } else {
            badge.classList.add('hidden');
            if (bell) {
                bell.classList.add('hidden');
                bell.classList.remove('ring-animation', 'text-yellow-400');
            }
        }
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

// Block and Delete Functions
async function toggleBlock() {
    if (!currentChatId) return alert("ကျေးဇူးပြု၍ Contact အရင်ရွေးချယ်ပါ!");
    if (!confirm("ဒီ customer ကို block ချင်တာ သေချာပါသလား?")) return;

    try {
        const res = await fetch('/api/contacts/block', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId: currentChatId })
        });
        if (res.ok) {
            alert("Block လုပ်ပြီးပါပြီ!");
            location.reload();
        } else {
            alert("Block လုပ်ရာတွင် အဆင်မပြေဖြစ်သွားပါသည်။");
        }
    } catch (err) { console.error(err); }
}

async function deleteContact() {
    if (!currentChatId) return alert("ကျေးဇူးပြု၍ Contact အရင်ရွေးချယ်ပါ!");
    if (!confirm("ဒီ conversation ကို ဖျက်ပစ်ဖို့ သေချာပါသလား? ပြန်ယူလို့မရတော့ပါဘူးနော်။")) return;

    try {
        const res = await fetch(`/api/contacts/${currentChatId}`, { method: 'DELETE' });
        if (res.ok) {
            alert("ဖျက်ပြီးပါပြီ!");
            location.reload();
        } else {
            alert("ဖျက်ရာတွင် အဆင်မပြေဖြစ်သွားပါသည်။");
        }
    } catch (err) { console.error(err); }
}

// Event Listeners
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

function handleKeyPress(e) { if (e.key === 'Enter') sendMessage(); }

// Initialization
window.addEventListener('DOMContentLoaded', () => { 
    loadSystemSettings(); 
    loadContacts(); 
    loadHistory(); 
});
