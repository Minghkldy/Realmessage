// script.js - iOS Glassmorphism Professional Logic (Fixed Messaging, Image Upload & Session Persistence)

// --- SUPABASE CONFIGURATION ---
const supabaseUrl = 'https://vquzfxzahxesrfjctoef.supabase.co';
const supabaseKey = 'sb_publishable_Pj8DiYgASNuPsRPh5opbjw_P5W1OtIt';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

// --- AUTH LOGIC (FIXED FOR SESSION PERSISTENCE) ---

// LOGIN FUNCTION
async function handleLogin() {
    const email = document.getElementById('login-email')?.value;
    const password = document.getElementById('login-password')?.value;

    if (!email || !password) {
        alert("Email နှင့် Password ဖြည့်ပါ။");
        return;
    }

    const { data, error } = await _supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .eq('password', password)
        .single();

    if (error || !data) {
        alert("Email သို့မဟုတ် Password မှားယွင်းနေပါသည်။");
    } else {
        // Login အောင်မြင်ပါက User Data ကို LocalStorage တွင်သိမ်းမည်
        localStorage.setItem('userSession', JSON.stringify(data));
        showAppUI(data);
        alert("Login အောင်မြင်ပါသည်။ မင်္ဂလာပါ " + (data.nickname || ""));
    }
}

// APP UI ပြသရန် Logic (Login ဝင်ပြီးသားဖြစ်ပါက ခေါ်သုံးရန်)
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
    if (nameEl) nameEl.innerText = userData.nickname || "Admin";
}

// LOGOUT FUNCTION (Optional - လိုအပ်ပါက သုံးရန်)
function handleLogout() {
    localStorage.removeItem('userSession');
    location.reload();
}

// SIGN UP FUNCTION 
async function handleSignUp() {
    const nickname = document.getElementById('reg-nickname')?.value;
    const email = document.getElementById('reg-email')?.value;
    const password = document.getElementById('reg-password')?.value;
    const birthday = document.getElementById('reg-birthday')?.value;

    if (!email || !password) {
        alert("Email နှင့် Password ဖြည့်ရန်လိုအပ်ပါသည်။");
        return;
    }

    if (!email.endsWith('@gmail.com')) {
        alert("Gmail အကောင့်ကိုသာ အသုံးပြုပေးပါ။");
        return;
    }

    const { data, error } = await _supabase
        .from('users')
        .insert([{ nickname, email, password, birthday }]);

    if (error) {
        alert("Error: " + error.message);
    } else {
        alert("အကောင့်ဖွင့်ခြင်း အောင်မြင်ပါသည်။ ယခု Login ဝင်နိုင်ပါပြီ။");
        if (typeof toggleAuth === "function") toggleAuth();
    }
}

// ---------------------------------------------------------

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
        if (data.nickname && nameEl) nameEl.innerText = data.nickname;
        
        const avatarEl = document.getElementById('top-admin-avatar');
        if (avatarEl && data.avatar) {
            avatarEl.src = (data.avatar.startsWith('data:image') || data.avatar.startsWith('http')) 
                ? data.avatar 
                : `/uploads/${data.avatar}`;
        }
    } catch (e) { console.error("Error loading settings:", e); }
}

// Sidebar Logic
function toggleLeftSidebar() { 
    const sidebar = document.getElementById('left-sidebar');
    if (!sidebar) return;

    sidebar.classList.toggle('sidebar-collapsed'); 
    
    if(sidebar.classList.contains('sidebar-collapsed')) {
        const dropdown = document.getElementById('messenger-dropdown');
        const arrow = document.getElementById('arrow-icon');
        if (dropdown) dropdown.classList.add('hidden');
        if (arrow) arrow.classList.remove('rotate-90');
    }
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

// Navigation logic
function switchToInbox() {
    document.getElementById('main-dashboard-content')?.classList.remove('hidden');
    document.getElementById('bot-settings-area')?.classList.add('hidden');
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active-nav'));
    const inboxNav = document.getElementById('inbox-nav');
    if (inboxNav) inboxNav.classList.add('active-nav');
    filterContacts('all');
}

function loadBotSettings() {
    document.getElementById('main-dashboard-content')?.classList.add('hidden');
    document.getElementById('bot-settings-area')?.classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active-nav'));
    document.getElementById('bot-config-nav')?.classList.add('active-nav');
    document.getElementById('settings-frame').src = "bot-config.html";
}

function loadBroadcastSettings() {
    document.getElementById('main-dashboard-content')?.classList.add('hidden');
    document.getElementById('bot-settings-area')?.classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active-nav'));
    document.getElementById('broadcast-nav')?.classList.add('active-nav');
    document.getElementById('settings-frame').src = "broadcast.html";
}

function loadGeneralSettings() {
    document.getElementById('main-dashboard-content')?.classList.add('hidden');
    document.getElementById('bot-settings-area')?.classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active-nav'));
    document.getElementById('sidebar-settings')?.classList.add('active-nav');
    document.getElementById('settings-frame').src = "general-settings.html";
}

// Image Preview Logic
function showImagePreview(url) {
    const modal = document.getElementById('imagePreviewModal');
    const img = document.getElementById('previewImg');
    if (modal && img) {
        img.src = url;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => { img.classList.remove('scale-95'); }, 10);
        document.body.style.overflow = 'hidden'; 
    }
}

function closeImagePreview() {
    const modal = document.getElementById('imagePreviewModal');
    const img = document.getElementById('previewImg');
    if (modal) {
        if (img) img.classList.add('scale-95');
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            document.body.style.overflow = 'auto'; 
        }, 150);
    }
}

// Contacts Logic
async function loadContacts() {
    try {
        const res = await fetch('/api/contacts');
        cachedContacts = await res.json();
        renderContacts(cachedContacts);
    } catch (err) { console.error(err); }
}

function filterContacts(platform) {
    const title = document.getElementById('inbox-title');
    const filtered = platform === 'all' 
        ? cachedContacts 
        : cachedContacts.filter(c => c.platform.toLowerCase() === platform.toLowerCase());
    
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
                <p class="text-[10px] uppercase font-black tracking-widest ${isActive ? 'text-white/60' : 'text-gray-500'}">${c.platform}</p>
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
    document.getElementById('edit-nickname').value = contact.nickname || contact.first_name;
    document.getElementById('contact-note').value = contact.notes || "";
    document.getElementById('side-platform').innerText = `Platform: ${contact.platform}`;
    
    const hImg = document.getElementById('header-avatar-img');
    const hTxt = document.getElementById('header-avatar-text');
    const sImg = document.getElementById('side-avatar-img');
    const sTxt = document.getElementById('side-avatar-text');

    if(contact.profile_pic) {
        [hImg, sImg].forEach(img => { if(img) { img.src = contact.profile_pic; img.classList.remove('hidden'); } });
        [hTxt, sTxt].forEach(txt => { if(txt) txt.classList.add('hidden'); });
    } else {
        const initial = (contact.nickname || contact.first_name || "?").charAt(0);
        [hTxt, sTxt].forEach(txt => { if(txt) { txt.innerText = initial; txt.classList.remove('hidden'); } });
        [hImg, sImg].forEach(img => { if(img) img.classList.add('hidden'); });
    }

    socket.emit('mark_as_read', { chatId: currentChatId });
    updateGlobalBadge();
    renderContacts(cachedContacts); 
    renderMessages();
}

async function updateNickname() {
    const newNickname = document.getElementById('edit-nickname').value.trim();
    if (!newNickname || !currentChatId) return;

    try {
        const res = await fetch('/api/contacts/update-nickname', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId: currentChatId, nickname: newNickname })
        });

        if (res.ok) {
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
        const response = await fetch('/api/messages');
        allMessages = await response.json();
        if(currentChatId) renderMessages();
    } catch (err) { console.error(err); }
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

        if (mediaType.includes('image') || mediaUrl.match(/\.(jpeg|jpg|gif|png|webp)$/i)) {
            contentHtml = `<img src="${mediaUrl}" class="max-w-xs rounded-2xl mt-2 cursor-pointer border border-white/10 shadow-xl hover:scale-[1.02] transition" onclick="showImagePreview('${mediaUrl}')">`;
        } else if (mediaType.includes('video')) {
            contentHtml = `<video controls class="max-w-xs rounded-2xl mt-2 border border-white/10"><source src="${mediaUrl}"></video>`;
        }
        
        if(data.text && data.text !== "Sent an image") {
            contentHtml = `<p class="mb-2">${data.text}</p>` + contentHtml;
        }
    }

    const msgHtml = isBot ? `
        <div class="self-end max-w-[80%] animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div class="bg-accent-blue p-4 rounded-3xl rounded-tr-none text-sm font-medium shadow-lg shadow-accent-blue/20 text-white">${contentHtml}</div>
            <div class="flex items-center justify-end gap-2 mt-2 px-1">
                <span class="text-[9px] text-gray-500 font-bold uppercase tracking-widest">${data.time || ''}</span>
                <i class="fas fa-check-double text-[9px] ${statusColor} status-indicator"></i>
            </div>
        </div>
    ` : `
        <div class="flex items-start gap-3 max-w-[80%] animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div class="w-9 h-9 rounded-xl bg-white/10 border border-white/5 flex items-center justify-center flex-shrink-0">
                ${data.profile_pic ? `<img src="${data.profile_pic}" class="w-full h-full object-cover rounded-xl">` : `<i class="fas fa-user text-gray-600 text-xs"></i>`}
            </div>
            <div>
                <div class="bg-white/5 border border-white/10 p-4 rounded-3xl rounded-tl-none text-sm leading-relaxed text-gray-200 backdrop-blur-sm shadow-sm">${contentHtml}</div>
                <p class="text-[9px] text-gray-600 mt-2 px-1 font-bold uppercase tracking-widest">${data.time || ''}</p>
            </div>
        </div>
    `;
    win.insertAdjacentHTML('beforeend', msgHtml);
    win.scrollTo({ top: win.scrollHeight, behavior: 'smooth' });
}

// Block & Delete
window.toggleBlock = async () => {
    if (!currentChatId || !confirm("Block this customer?")) return;
    try {
        const res = await fetch('/api/contacts/block', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId: currentChatId })
        });
        if (res.ok) location.reload();
    } catch (err) { console.error(err); }
};

window.deleteContact = async () => {
    if (!currentChatId || !confirm("Delete this conversation permanently?")) return;
    try {
        const res = await fetch(`/api/contacts/${currentChatId}`, { method: 'DELETE' });
        if (res.ok) location.reload();
    } catch (err) { console.error(err); }
};

// --- MESSAGING & UPLOAD LOGIC ---

async function uploadFile(input) {
    if (!input.files || !input.files[0] || !currentChatId) return;

    const file = input.files[0];
    const formData = new FormData();
    formData.append('file', file);
    formData.append('chatId', currentChatId);

    try {
        const res = await fetch('/api/admin/upload', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();

        if (data.success) {
            const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const msgData = {
                chat_id: currentChatId,
                text: "Sent an image",
                file_url: data.fileUrl,
                file_type: file.type,
                sender_type: 'bot',
                time: timeNow,
                is_read: false
            };

            socket.emit('send_reply', { 
                chatId: currentChatId, 
                text: "Sent an image", 
                fileUrl: data.fileUrl, 
                fileType: file.type 
            });

            allMessages.push(msgData);
            appendMessage(msgData, true);
        }
    } catch (err) {
        console.error("Upload failed:", err);
        alert("Upload အဆင်မပြေပါ");
    }
    input.value = ""; 
}

function sendMessage() {
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
        input.value = ""; 
    }
}

function handleKeyPress(e) { if (e.key === 'Enter') sendMessage(); }

// Global Scope Assignments
window.switchToInbox = switchToInbox;
window.loadBotSettings = loadBotSettings;
window.loadBroadcastSettings = loadBroadcastSettings;
window.loadGeneralSettings = loadGeneralSettings;
window.toggleLeftSidebar = toggleLeftSidebar;
window.toggleDropdown = toggleDropdown;
window.toggleRightPanel = toggleRightPanel;
window.showImagePreview = showImagePreview;
window.closeImagePreview = closeImagePreview;
window.filterContacts = filterContacts;
window.selectContact = selectContact;
window.updateNickname = updateNickname;
window.sendMessage = sendMessage;
window.handleKeyPress = handleKeyPress;
window.uploadFile = uploadFile;
window.handleSignUp = handleSignUp; 
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;

// Initialization
window.addEventListener('DOMContentLoaded', () => { 
    // --- CHECK SESSION ON LOAD ---
    const savedSession = localStorage.getItem('userSession');
    if (savedSession) {
        const userData = JSON.parse(savedSession);
        showAppUI(userData);
    }
    // ----------------------------

    loadSystemSettings(); 
    loadContacts(); 
    loadHistory(); 
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
        document.getElementById('notif-sound')?.play().catch(() => {});
        renderContacts(cachedContacts);
    }
});
// --- FORGOT PASSWORD LOGIC ---

window.showForgotModal = () => {
    document.getElementById('forgot-modal')?.classList.remove('hidden');
};

window.closeForgotModal = () => {
    document.getElementById('forgot-modal')?.classList.add('hidden');
};

async function handleForgotPassword() {
    const email = document.getElementById('reset-email')?.value.trim();

    if (!email || !email.endsWith('@gmail.com')) {
        alert("မှန်ကန်သော Gmail ကို ရိုက်ထည့်ပါ။");
        return;
    }

    const { error } = await _supabase.auth.resetPasswordForEmail(email, {
    redirectTo: 'https://realmessage-live.onrender.com/reset-password.html',
    });

    if (error) {
        alert("Error: " + error.message);
    } else {
        alert("Password ချိန်းရန် Link ကို Email ထဲသို့ ပို့ပေးလိုက်ပါပြီ။");
        closeForgotModal();
    }
}
window.handleForgotPassword = handleForgotPassword;

// --- LOGOUT LOGIC ---
async function handleLogout() {
    const { error } = await _supabase.auth.signOut();

    if (error) {
        alert("Logout လုပ်ရတာ အဆင်မပြေပါဘူး: " + error.message);
    } else {
        // Session တွေကို အကုန်ရှင်းပစ်ပြီးမှ login (index.html) ကို လွှတ်မယ်
        localStorage.clear(); 
        sessionStorage.clear();
        window.location.replace('index.html'); // .href အစား .replace သုံးရင် back ပြန်ဆွဲလို့မရတော့ဘူး
    }
}

// Window object မှာ ချိတ်ပေးထားမှ HTML ကနေ ခေါ်သုံးလို့ရမှာပါ
window.handleLogout = handleLogout;
