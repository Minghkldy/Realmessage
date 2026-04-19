// --- SUPABASE CONFIGURATION ---
// index.html မှာ ကြေညာထားပြီးသားဖြစ်လို့ ဒီမှာ window.supabase ကို ပြန်သုံးပါမယ်
const supabase = window.supabase; 

// --- AUTH LOGIC (Bypassed) ---
async function handleLogin() { return; }
async function handleSignUp() { return; }

async function handleLogout() {
    localStorage.clear(); 
    sessionStorage.clear();
    cachedContacts = [];
    allMessages = [];
    window.location.reload(); 
}

function showAppUI(userData) {
    const authGate = document.getElementById('auth-gate');
    const mainApp = document.getElementById('main-app');
    
    if (authGate) authGate.style.display = 'none';
    if (mainApp) {
        mainApp.classList.remove('opacity-0', 'pointer-events-none');
        mainApp.style.opacity = '1';
        mainApp.style.pointerEvents = 'auto';
    }
    
    const nameEl = document.getElementById('top-admin-name');
    if (nameEl) {
        nameEl.innerText = userData?.user_metadata?.nickname || userData?.nickname || "Admin";
    }
}

// --- MESSAGING & UI LOGIC ---
const socket = io();
let currentChatId = "";
let allMessages = [];
let unreadCounts = {};
let cachedContacts = []; 

async function loadSystemSettings() {
    try {
        const res = await fetch('/api/admin/profile');
        const data = await res.json();
        const nameEl = document.getElementById('top-admin-name');
        if (data.nickname && nameEl) nameEl.innerText = data.nickname;
        const avatarEl = document.getElementById('top-admin-avatar');
        if (avatarEl && data.avatar) {
            avatarEl.src = (data.avatar.startsWith('data:image') || data.avatar.startsWith('http')) 
                ? data.avatar 
                : `/uploads/${data.avatar}`;
        }
    } catch (e) { console.error("Error loading settings:", e); }
}

function toggleLeftSidebar() { 
    const sidebar = document.getElementById('left-sidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('sidebar-collapsed'); 
}

function toggleRightPanel() { 
    const panel = document.getElementById('right-panel');
    if (panel) {
        panel.classList.toggle('hidden');
        panel.classList.add('animate-in', 'slide-in-from-right', 'duration-300');
    }
}

function toggleDropdown() {
    const sidebar = document.getElementById('left-sidebar');
    const dropdown = document.getElementById('messenger-dropdown');
    const arrow = document.getElementById('arrow-icon');
    if (!dropdown) return;
    if (sidebar && sidebar.classList.contains('sidebar-collapsed')) {
        sidebar.classList.remove('sidebar-collapsed');
    }
    dropdown.classList.toggle('hidden');
    if (arrow) arrow.classList.toggle('rotate-90');
}

// --- NAVIGATION FIXED PORTION ---
function switchToInbox() {
    document.getElementById('main-dashboard-content')?.classList.remove('hidden');
    document.getElementById('bot-settings-area')?.classList.add('hidden');
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active-nav', 'bg-white/5'));
    document.getElementById('inbox-nav')?.classList.add('active-nav', 'bg-white/5');
    filterContacts('all');
}

function loadBotSettings() {
    document.getElementById('main-dashboard-content')?.classList.add('hidden');
    document.getElementById('bot-settings-area')?.classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active-nav', 'bg-white/5'));
    document.getElementById('bot-config-nav')?.classList.add('active-nav', 'bg-white/5');
    const frame = document.getElementById('settings-frame');
    if (frame) frame.src = "bot-config.html";
}

function loadBroadcastSettings() {
    document.getElementById('main-dashboard-content')?.classList.add('hidden');
    document.getElementById('bot-settings-area')?.classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active-nav', 'bg-white/5'));
    document.getElementById('broadcast-nav')?.classList.add('active-nav', 'bg-white/5');
    const frame = document.getElementById('settings-frame');
    if (frame) frame.src = "broadcast.html";
}

function loadGeneralSettings() {
    document.getElementById('main-dashboard-content')?.classList.add('hidden');
    document.getElementById('bot-settings-area')?.classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active-nav', 'bg-white/5'));
    document.getElementById('sidebar-settings')?.classList.add('active-nav', 'bg-white/5');
    const frame = document.getElementById('settings-frame');
    if (frame) frame.src = "general-settings.html";
}
// --- END OF NAVIGATION FIXED PORTION ---

function showImagePreview(url) {
    const modal = document.getElementById('imagePreviewModal');
    const img = document.getElementById('previewImg');
    if (modal && img) {
        img.src = url;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

function closeImagePreview() {
    const modal = document.getElementById('imagePreviewModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

async function loadContacts() {
    try {
        const { data, error } = await supabase
            .from('contacts')
            .select('*'); 

        if (error) throw error;
        cachedContacts = data || [];
        renderContacts(cachedContacts);
    } catch (err) { console.error("Load Contacts Error:", err); }
}

function filterContacts(platform) {
    const title = document.getElementById('inbox-title');
    const filtered = platform === 'all' 
        ? cachedContacts 
        : cachedContacts.filter(c => c.platform?.toLowerCase() === platform.toLowerCase());
    if (title) title.innerText = platform === 'all' ? "Inbox" : platform.toUpperCase();
    renderContacts(filtered);
}

function renderContacts(contacts) {
    const container = document.getElementById('contacts-container');
    if (!container) return;
    container.innerHTML = '';
    contacts.forEach(c => {
        const count = unreadCounts[c.chat_id] || 0;
        const isActive = currentChatId === c.chat_id;
        const item = document.createElement('div');
        item.className = `group p-4 rounded-2xl flex items-center gap-4 cursor-pointer transition-all duration-300 ${isActive ? 'active-contact' : 'hover:bg-white/5'}`;
        item.onclick = () => selectContact(c);
        const avatar = c.profile_pic 
            ? `<img src="${c.profile_pic}" class="w-12 h-12 rounded-2xl object-cover border-2 ${isActive ? 'border-white/20' : 'border-white/5'}">` 
            : `<div class="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-sm font-black border-2 border-white/5 uppercase text-accent-blue">${(c.nickname || c.first_name || "?").charAt(0)}</div>`;
        item.innerHTML = `
            <div class="relative">${avatar} ${count > 0 ? `<div class="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-black"></div>` : ''}</div>
            <div class="flex-1 min-w-0">
                <p class="text-sm font-bold truncate ${isActive ? 'text-white' : 'text-gray-200'}">${c.nickname || c.first_name}</p>
                <p class="text-[10px] uppercase font-black tracking-widest ${isActive ? 'text-white/60' : 'text-gray-500'}">${c.platform || ''}</p>
            </div>
            ${count > 0 ? `<span class="bg-white text-accent-blue text-[10px] px-2 py-0.5 rounded-full font-black">${count}</span>` : ''}
        `;
        container.appendChild(item);
    });
    updateGlobalBadge();
}

function selectContact(contact) {
    currentChatId = contact.chat_id;
    unreadCounts[currentChatId] = 0; 
    document.getElementById('chat-header-name').innerText = contact.nickname || contact.first_name;
    
    const editNicknameEl = document.getElementById('edit-nickname');
    if (editNicknameEl) editNicknameEl.value = contact.nickname || contact.first_name;
    
    const contactNoteEl = document.getElementById('contact-note');
    if (contactNoteEl) contactNoteEl.value = contact.notes || "";
    
    const sidePlatformEl = document.getElementById('side-platform');
    if (sidePlatformEl) sidePlatformEl.innerText = `Platform: ${contact.platform}`;
    
    socket.emit('mark_as_read', { chatId: currentChatId });
    updateGlobalBadge();
    renderContacts(cachedContacts); 
    renderMessages();
}

async function updateNickname() {
    const newNickname = document.getElementById('edit-nickname')?.value.trim();
    if (!newNickname || !currentChatId) return;
    try {
        const { error } = await supabase
            .from('contacts')
            .update({ nickname: newNickname })
            .eq('chat_id', currentChatId);

        if (!error) {
            const contact = cachedContacts.find(c => c.chat_id === currentChatId);
            if (contact) contact.nickname = newNickname;
            renderContacts(cachedContacts); 
            document.getElementById('chat-header-name').innerText = newNickname;
        }
    } catch (err) { console.error(err); }
}

function updateGlobalBadge() {
    const total = Object.values(unreadCounts).reduce((a, b) => a + b, 0);
    const badge = document.getElementById('global-msg-count');
    if (badge) {
        badge.innerText = total;
        total > 0 ? badge.classList.remove('hidden') : badge.classList.add('hidden');
    }
}

async function loadHistory() {
    try {
        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .order('created_at', { ascending: true });

        if (error) throw error;
        allMessages = data || [];
        if(currentChatId) renderMessages();
    } catch (err) { console.error("Load History Error:", err); }
}

function renderMessages() {
    const win = document.getElementById('chat-window');
    if (!win) return;
    win.innerHTML = "";
    allMessages.filter(m => m.chat_id === currentChatId).forEach(msg => appendMessage(msg, msg.sender_type === 'bot'));
    win.scrollTo({ top: win.scrollHeight, behavior: 'smooth' });
}

function appendMessage(data, isBot) {
    const win = document.getElementById('chat-window');
    if (!win) return;
    let contentHtml = data.text || "";
    let mediaUrl = data.file_url || data.fileUrl;
    const mediaType = data.file_type || data.fileType || "";
    const statusColor = data.is_read ? 'text-accent-blue' : 'text-gray-600';
    
    if (mediaUrl) {
        if (!mediaUrl.startsWith('data:') && !mediaUrl.startsWith('http')) mediaUrl = `/uploads/${mediaUrl}`;
        if (mediaType.includes('image') || (typeof mediaUrl === 'string' && mediaUrl.match(/\.(jpeg|jpg|gif|png|webp)$/i))) {
            contentHtml = `<img src="${mediaUrl}" class="max-w-xs rounded-2xl mt-2 cursor-pointer border border-white/10" onclick="showImagePreview('${mediaUrl}')">`;
        }
    }

    const msgHtml = isBot ? `
        <div class="self-end max-w-[80%]">
            <div class="bg-accent-blue p-4 rounded-3xl rounded-tr-none text-sm text-white">${contentHtml}</div>
            <div class="flex items-center justify-end gap-2 mt-2 px-1">
                <span class="text-[9px] text-gray-500">${data.time || ''}</span>
                <i class="fas fa-check-double text-[9px] ${statusColor}"></i>
            </div>
        </div>
    ` : `
        <div class="flex items-start gap-3 max-w-[80%]">
            <div class="bg-white/5 border border-white/10 p-4 rounded-3xl rounded-tl-none text-sm text-gray-200">${contentHtml}</div>
        </div>
    `;
    win.insertAdjacentHTML('beforeend', msgHtml);
    win.scrollTo({ top: win.scrollHeight, behavior: 'smooth' });
}

async function sendMessage() {
    const input = document.getElementById('user-input');
    const text = input?.value.trim();
    if(text && currentChatId) {
        const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        const msgData = {
            chat_id: currentChatId,
            text: text,
            sender_type: 'bot',
            time: timeNow,
            is_read: false
        };
        
        socket.emit('send_reply', { chatId: currentChatId, text: text });
        allMessages.push(msgData);
        appendMessage(msgData, true);
        if (input) input.value = ""; 
    }
}

// --- INITIALIZATION (Bypassing Auth Gate) ---
window.addEventListener('DOMContentLoaded', async () => { 
    showAppUI({ nickname: "Admin" });
    loadSystemSettings(); 
    await loadContacts(); 
    await loadHistory(); 
});

socket.on('new_message', (data) => {
    const senderId = data.chat_id || data.chatId;
    if (currentChatId === senderId) {
        if (data.sender_type !== 'bot') {
            allMessages.push(data);
            appendMessage(data, false);
        }
        socket.emit('mark_as_read', { chatId: currentChatId });
    } else {
        allMessages.push(data);
        unreadCounts[senderId] = (unreadCounts[senderId] || 0) + 1;
        renderContacts(cachedContacts);
    }
});

async function handleForgotPassword() { return; }

// --- GLOBAL SCOPE ASSIGNMENTS ---
window.switchToInbox = switchToInbox;
window.loadBotSettings = loadBotSettings;
window.loadBroadcastSettings = loadBroadcastSettings;
window.loadGeneralSettings = loadGeneralSettings;
window.handleLogin = handleLogin;
window.handleSignUp = handleSignUp;
window.handleLogout = handleLogout;
window.sendMessage = sendMessage;
window.handleForgotPassword = handleForgotPassword;
window.updateNickname = updateNickname;
window.toggleLeftSidebar = toggleLeftSidebar;
window.toggleRightPanel = toggleRightPanel;
window.toggleDropdown = toggleDropdown;
window.closeImagePreview = closeImagePreview;
