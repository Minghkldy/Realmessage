// --- SUPABASE CONFIGURATION ---
// index.html က window.supabaseClient ကို တိုက်ရိုက်သုံးပါမယ်
var supabase = window.supabaseClient;

// --- VARIABLES ---
let currentChatId = "";
let allMessages = [];
let cachedContacts = []; 

// --- UI & NAVIGATION ---
function showAppUI() {
    const mainApp = document.getElementById('main-app');
    if (mainApp) {
        mainApp.style.opacity = '1';
        mainApp.classList.remove('pointer-events-none');
    }
}

// --- DATA LOADING ---
async function loadContacts() {
    // ပိုသေချာအောင် client ကို ပြန်စစ်ဆေးခြင်း
    if (!supabase) supabase = window.supabaseClient;
    if (!supabase) return;
    
    try {
        const { data, error } = await supabase
            .from('messages')
            .select('sender_name, platform, created_at, message_text')
            .order('created_at', { ascending: false });

        if (error) throw error;

        const unique = {};
        data.forEach(m => {
            // sender_name မရှိခဲ့ရင် 'Unknown' လို့ ပြပေးမယ်
            const name = m.sender_name || 'Unknown User';
            if (name !== 'Admin' && !unique[name]) {
                unique[name] = {
                    chat_id: name,
                    nickname: name,
                    platform: m.platform || 'Messenger',
                    last_msg: m.message_text
                };
            }
        });
        cachedContacts = Object.values(unique);
        renderContacts(cachedContacts);
    } catch (err) { 
        console.error("Load Contacts Error:", err); 
    }
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
                ${c.nickname ? c.nickname.charAt(0) : '?'}
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
    const headerName = document.getElementById('chat-header-name');
    const headerAvatar = document.getElementById('header-avatar-text');
    
    if(headerName) headerName.innerText = contact.nickname;
    if(headerAvatar) headerAvatar.innerText = contact.nickname.charAt(0).toUpperCase();
    
    document.getElementById('chat-status').innerText = 'Active Now';
    
    const sideName = document.getElementById('side-name');
    if (sideName) sideName.innerText = contact.nickname;

    renderContacts(cachedContacts);
    await loadHistory();
}

async function loadHistory() {
    if (!currentChatId || !supabase) return;
    try {
        const { data, error } = await supabase
            .from('messages')
            .select('*')
            // filter query ကို ပိုရှင်းအောင် ရေးထားပါတယ်
            .or(`sender_name.eq."${currentChatId}",receiver_name.eq."${currentChatId}"`)
            .order('created_at', { ascending: true });

        if (error) throw error;
        allMessages = data || [];
        renderMessages();
    } catch (err) { 
        console.error("Load History Error:", err); 
    }
}

function renderMessages() {
    const win = document.getElementById('chat-window');
    if (!win) return;
    win.innerHTML = "";

    allMessages.forEach(msg => {
        const isMe = msg.sender_name === 'Admin';
        const msgHtml = `
            <div class="flex ${isMe ? 'justify-end' : 'justify-start'} w-full mb-4">
                <div class="max-w-[75%] p-4 rounded-3xl text-sm ${
                    isMe ? 'bg-accent-blue text-white rounded-tr-none' : 'bg-ios-gray text-gray-100 rounded-tl-none border border-border-gray'
                }">
                    <p style="white-space: pre-wrap; word-break: break-word;">${msg.message_text || ''}</p>
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

// --- SEND MESSAGE ---
async function sendMessage() {
    const input = document.getElementById('user-input');
    const text = input?.value.trim();
    
    if (text && currentChatId && supabase) {
        // UI မှာ ချက်ချင်းပေါ်လာအောင် အတုပြုလုပ်ခြင်း
        const tempMsg = {
            sender_name: 'Admin',
            receiver_name: currentChatId,
            message_text: text,
            created_at: new Date().toISOString()
        };
        
        allMessages.push(tempMsg);
        renderMessages();
        input.value = ""; 

        // Database ထဲလှမ်းထည့်မယ်
        const { error } = await supabase
            .from('messages')
            .insert([{
                sender_name: 'Admin',
                receiver_name: currentChatId,
                message_text: text,
                platform: 'admin'
            }]);

        if (error) {
            console.error("Send Error:", error);
            // Error ဖြစ်ရင် log ထဲပြန်စစ်ဖို့ loadHistory ခေါ်မယ်
            await loadHistory(); 
        }
    }
}

// --- REAL-TIME SUBSCRIPTION ---
function initRealtime() {
    if (!supabase) supabase = window.supabaseClient;
    if (!supabase) return;
    
    supabase.removeAllChannels();

    supabase
        .channel('messages-realtime')
        .on('postgres_changes', 
            { event: 'INSERT', schema: 'public', table: 'messages' }, 
            (payload) => {
                console.log('New message received:', payload.new);
                
                // ၁။ Contact list ကို update လုပ်မယ်
                loadContacts();

                // ၂။ အကယ်၍ လက်ရှိ chat window ထဲကလူဖြစ်ရင်
                const isFromPartner = payload.new.sender_name === currentChatId;
                const isToPartner = payload.new.receiver_name === currentChatId;

                if (currentChatId && (isFromPartner || (payload.new.sender_name === 'Admin' && isToPartner))) {
                    // ကိုယ်တိုင်ပို့ထားတဲ့စာ (Optimistic UI) နဲ့ Duplicate မဖြစ်အောင် စစ်မယ်
                    const exists = allMessages.some(m => m.id === payload.new.id);
                    if (!exists) {
                        allMessages.push(payload.new);
                        renderMessages();
                    }
                }
            }
        )
        .subscribe();
}

// --- INITIALIZATION ---
window.addEventListener('load', async () => { 
    showAppUI();
    // Supabase client အဆင်သင့်ဖြစ်အောင် ခဏစောင့်မယ်
    setTimeout(async () => {
        await loadContacts();
        initRealtime();
    }, 500);
    
    document.getElementById('user-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendMessage();
        }
    });
});

window.sendMessage = sendMessage;
