// --- SUPABASE CONFIGURATION ---
const supabase = window.supabase; 

// --- VARIABLES ---
let currentChatId = "";
let allMessages = [];
let unreadCounts = {};
let cachedContacts = []; 
const socket = (typeof io !== 'undefined') ? io() : { on: () => {}, emit: () => {} };

// --- UI & NAVIGATION ---
function showAppUI(userData) {
    const mainApp = document.getElementById('main-app');
    if (mainApp) {
        mainApp.classList.remove('opacity-0', 'pointer-events-none');
        mainApp.style.opacity = '1';
    }
    const nameEl = document.getElementById('top-admin-name');
    if (nameEl) nameEl.innerText = userData?.nickname || "Admin";
}

function switchToInbox() {
    document.getElementById('main-dashboard-content')?.classList.remove('hidden');
    document.getElementById('bot-settings-area')?.classList.add('hidden');
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active-nav', 'bg-white/5'));
    document.getElementById('inbox-nav')?.classList.add('active-nav', 'bg-white/5');
}

function loadBotSettings() {
    document.getElementById('main-dashboard-content')?.classList.add('hidden');
    document.getElementById('bot-settings-area')?.classList.remove('hidden');
    const frame = document.getElementById('settings-frame');
    if (frame) frame.src = "bot-config.html";
}

function loadBroadcastSettings() {
    document.getElementById('main-dashboard-content')?.classList.add('hidden');
    document.getElementById('bot-settings-area')?.classList.remove('hidden');
    const frame = document.getElementById('settings-frame');
    if (frame) frame.src = "broadcast.html";
}

// --- SIDEBAR & PANELS ---
function toggleLeftSidebar() { 
    document.getElementById('left-sidebar')?.classList.toggle('-translate-x-full');
}

function toggleRightPanel() { 
    document.getElementById('right-panel')?.classList.toggle('hidden');
}

function toggleDropdown() {
    const dropdown = document.getElementById('messenger-dropdown');
    const arrow = document.getElementById('arrow-icon');
    dropdown?.classList.toggle('hidden');
    arrow?.classList.toggle('rotate-90');
}

// --- DATA LOADING ---
async function loadContacts() {
    try {
        const { data, error } = await supabase
            .from('messages')
            .select('sender_name, platform, created_at, message_text')
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Unique Contacts Logic
        const unique = {};
        data.forEach(m => {
            if (!unique[m.sender_name]) {
                unique[m.sender_name] = {
                    chat_id: m.sender_name,
                    nickname: m.sender_name,
                    platform: m.platform || 'System',
                    last_msg: m.message_text
                };
            }
        });
        cachedContacts = Object.values(unique);
        renderContacts(cachedContacts);
    } catch (err) { console.error("Load Contacts Error:", err); }
}

function renderContacts(contacts) {
    const container = document.getElementById('contacts-container');
    if (!container) return;
    container.innerHTML = '';

    contacts.forEach(c => {
        const isActive = currentChatId === c.chat_id;
        const item = document.createElement('div');
        item.className = `group p-4 rounded-2xl flex items-center gap-4 cursor-pointer transition-all ${isActive ? 'bg-white/10 border-l-4 border-accent-blue' : 'hover:bg-white/5'}`;
        item.onclick = () => selectContact(c);

        item.innerHTML = `
            <div class="w-12 h-12 rounded-2xl bg-accent-blue/20 flex items-center justify-center font-bold text-accent-blue uppercase">
                ${c.nickname.charAt(0)}
            </div>
            <div class="flex-1 min-w-0">
                <p class="text-sm font-bold truncate ${isActive ? 'text-white' : 'text-gray-200'}">${c.nickname}</p>
                <p class="text-[10px] uppercase font-black tracking-widest text-gray-500">${c.platform}</p>
            </div>
        `;
        container.appendChild(item);
    });
}

async function selectContact(contact) {
    currentChatId = contact.chat_id;
    document.getElementById('chat-header-name').innerText = contact.nickname;
    document.getElementById('chat-status').innerText = 'Active Now';
    document.getElementById('header-avatar-text').innerText = contact.nickname.charAt(0).toUpperCase();
    
    // Right Panel Update
    document.getElementById('side-avatar-text').innerText = contact.nickname.charAt(0).toUpperCase();
    document.getElementById('side-name').innerText = contact.nickname;
    document.getElementById('side-platform').innerText = `Platform: ${contact.platform}`;

    renderContacts(cachedContacts);
    await loadHistory();
}

async function loadHistory() {
    if (!currentChatId) return;
    try {
        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .or(`sender_name.eq.${currentChatId},receiver_name.eq.${currentChatId}`)
            .order('created_at', { ascending: true });

        if (error) throw error;
        allMessages = data || [];
        renderMessages();
    } catch (err) { console.error("Load History Error:", err); }
}

function renderMessages() {
    const win = document.getElementById('chat-window');
    if (!win) return;
    win.innerHTML = "";

    allMessages.forEach(msg => {
        const isMe = msg.platform === 'admin' || msg.sender_name === 'Admin';
        const msgHtml = `
            <div class="flex ${isMe ? 'justify-end' : 'justify-start'} w-full animate-in fade-in slide-in-from-bottom-2">
                <div class="max-w-[75%] p-4 rounded-3xl text-sm ${
                    isMe ? 'bg-accent-blue text-white rounded-tr-none' : 'bg-ios-gray text-gray-100 rounded-tl-none border border-border-gray'
                }">
                    <p>${msg.message_text || msg.text}</p>
                    <span class="text-[9px] opacity-50 mt-1 block">
                        ${new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </span>
                </div>
            </div>
        `;
        win.insertAdjacentHTML('beforeend', msgHtml);
    });
    win.scrollTop = win.scrollHeight;
}

async function sendMessage() {
    const input = document.getElementById('user-input');
    const text = input?.value.trim();
    
    if (text && currentChatId) {
        const { error } = await supabase
            .from('messages')
            .insert([{
                sender_name: 'Admin',
                receiver_name: currentChatId,
                message_text: text,
                platform: 'admin',
                created_at: new Date()
            }]);

        if (!error) {
            input.value = "";
            await loadHistory();
        } else {
            console.error("Send Error:", error);
        }
    }
}

function handleKeyPress(e) {
    if (e.key === 'Enter') sendMessage();
}

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', async () => { 
    showAppUI({ nickname: "Admin" });
    await loadContacts();
    
    // Realtime Listener
    supabase
        .channel('public:messages')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
            if (payload.new.sender_name === currentChatId || payload.new.receiver_name === currentChatId) {
                loadHistory();
            }
            loadContacts();
        })
        .subscribe();
});

// Global Assignments for HTML
window.switchToInbox = switchToInbox;
window.loadBotSettings = loadBotSettings;
window.loadBroadcastSettings = loadBroadcastSettings;
window.sendMessage = sendMessage;
window.toggleLeftSidebar = toggleLeftSidebar;
window.toggleRightPanel = toggleRightPanel;
window.toggleDropdown = toggleDropdown;
window.handleKeyPress = handleKeyPress;
