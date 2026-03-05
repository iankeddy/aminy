// ============================================================
// AMINY — app.js
// All original functions preserved + full chat system added
// ============================================================

// 1. Initialize Supabase
const supabaseUrl = 'https://cjpylodggpqqkuvojogb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqcHlsb2RnZ3BxcWt1dm9qb2diIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwODQ3ODgsImV4cCI6MjA4MjY2MDc4OH0.DpfpuCMQr8A3QV11KRVLE2JakuRWAmoGi1Ol_QUFWRE';

const client = supabase.createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

// --- SHARED UTILITIES ---
function toggleLoader(show) {
    const loader = document.getElementById('loader-overlay');
    if (loader) loader.style.display = show ? 'flex' : 'none';
}

function showModal(title, message, type = 'success') {
    const modal = document.getElementById('custom-modal');
    if (!modal) return alert(message);
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-message').innerText = message;
    modal.style.display = 'flex';
}

// --- AUTHENTICATION ---
async function signUp(email, password, role, fullName) {
    toggleLoader(true);
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) {
        toggleLoader(false);
        return showModal("Signup Failed", error.message, "error");
    }
    if (data.user) {
        const { error: profileError } = await client.from('profiles').insert([{
            id: data.user.id, email, role, full_name: fullName, is_vetted: false
        }]);
        toggleLoader(false);
        profileError ? showModal("Error", "Profile save failed.") : showModal("Success!", "Confirm email, then login.");
    }
}

async function login(email, password) {
    toggleLoader(true);
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
        toggleLoader(false);
        showModal("Login Error", error.message, "error");
    } else {
        const { data: profile } = await client.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
        window.location.href = profile?.role === 'admin' ? './admin.html' : './dashboard.html';
    }
}

// --- VETTING & LOCATION ---
async function detectMyLocation() {
    const locInput = document.getElementById('location-name');
    if (!locInput) return;
    locInput.value = "Detecting...";
    navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`);
            const data = await res.json();
            locInput.value = data.address.suburb || data.address.city || "Location Found";
        } catch (e) { locInput.value = "Location Detected"; }
    }, () => { alert("Geolocation failed."); locInput.value = ""; });
}

async function handleVettingUpload() {
    const selfie = document.getElementById('upload-selfie')?.files[0];
    const idCard = document.getElementById('upload-id')?.files[0];
    const conduct = document.getElementById('upload-conduct')?.files[0];
    const locName = document.getElementById('location-name')?.value;

    if (!selfie || !idCard || !conduct) return alert("Please select all three documents.");

    toggleLoader(true);
    try {
        const { data: { user } } = await client.auth.getUser();
        const files = [
            { file: selfie, name: 'selfie', col: 'selfie_url' },
            { file: idCard, name: 'id', col: 'id_url' },
            { file: conduct, name: 'conduct', col: 'cert_good_conduct_url' }
        ];

        let updateData = { location_name: locName, is_vetted: false };

        for (const item of files) {
            const fileExt = item.file.name.split('.').pop();
            const filePath = `${user.id}/${item.name}.${fileExt}`;
            const { error: upErr } = await client.storage.from('verification-docs').upload(filePath, item.file, { upsert: true });
            if (upErr) throw upErr;
            const { data: urlData } = client.storage.from('verification-docs').getPublicUrl(filePath);
            updateData[item.col] = urlData.publicUrl;
        }

        const { error: upErr } = await client.from('profiles').update(updateData).eq('id', user.id);
        if (upErr) throw upErr;
        showModal("Success", "Documents uploaded for review.");
    } catch (err) { showModal("Upload Error", err.message, "error"); }
    finally { toggleLoader(false); }
}

// --- ADMIN DASHBOARD FUNCTIONS ---
async function loadDashboardStats() {
    try {
        const { count } = await client.from('profiles').select('*', { count: 'exact', head: true })
            .eq('role', 'helper').eq('is_vetted', false);

        const { data: bookings } = await client.from('bookings').select('total_price').eq('status', 'accepted');
        const total = bookings?.reduce((sum, b) => sum + (Number(b.total_price) || 0), 0) || 0;

        if (document.getElementById('stat-pending')) document.getElementById('stat-pending').innerText = count || 0;
        if (document.getElementById('stat-money')) document.getElementById('stat-money').innerText = `KES ${total.toLocaleString()}`;
    } catch (err) { console.error("Stats Error:", err); }
}

async function loadPendingHelpers() {
    const { data: helpers, error } = await client.from('profiles').select('*').eq('role', 'helper').eq('is_vetted', false);
    if (error) return;

    const container = document.getElementById('queue-container');
    if (!container) return;
    container.innerHTML = helpers?.length ? '' : '<h3>🎉 All caught up!</h3>';

    helpers?.forEach(helper => {
        container.innerHTML += `
    <div class="vetting-card" id="card-${helper.id}">
        <div class="doc-viewer">
            <a href="${helper.selfie_url}" target="_blank"><img src="${helper.selfie_url}" class="doc-thumb" title="Selfie"></a>
            <a href="${helper.id_url}" target="_blank"><img src="${helper.id_url}" class="doc-thumb" title="ID Card"></a>
            <a href="${helper.cert_good_conduct_url}" target="_blank"><img src="${helper.cert_good_conduct_url}" class="doc-thumb" title="Conduct Cert"></a>
        </div>
        <div class="vetting-actions">
            <h2>${helper.full_name || 'Anonymous'}</h2>
            <p>${helper.email}<br>Location: ${helper.location_name || 'Unknown'}</p>
            <input type="text" id="feedback-${helper.id}" class="feedback-input" placeholder="Rejection reason...">
            <div class="action-btns">
                <button onclick="updateVettingStatus('${helper.id}', true)" class="btn-approve">Approve</button>
                <button onclick="updateVettingStatus('${helper.id}', false)" class="btn-reject">Reject</button>
            </div>
        </div>
    </div>`;
    });
}

async function updateVettingStatus(id, isApproved) {
    const feedback = document.getElementById(`feedback-${id}`)?.value;
    if (!isApproved && !feedback) return alert("Please provide a reason for rejection.");
    const { error } = await client.from('profiles').update({ is_vetted: isApproved, rejection_feedback: isApproved ? null : feedback }).eq('id', id);
    if (error) alert(error.message);
    else {
        document.getElementById(`card-${id}`)?.remove();
        loadDashboardStats();
    }
}

function renderJob(job) {
  return `
    <div class="job-card">
      <div class="job-title">${job.title}</div>
      <p>${job.description || ""}</p>
      <div class="job-footer">
        <div class="job-price">${job.budget || "Budget not set"}</div>
      </div>
    </div>
  `;
}

// --- NAVIGATION ---
function goToPage(page) {
  if (window.location.pathname.includes(page)) return;
  window.location.href = page;
}

function toggleAppMenu() {
  const menu = document.getElementById("app-menu");
  if (!menu) return;
  menu.classList.toggle("hidden");
}

async function handleProfileClick() {
  try {
    const { data: { user } } = await client.auth.getUser();
    window.location.href = user ? "dashboard.html" : "auth.html";
  } catch (err) {
    window.location.href = "auth.html";
  }
}

async function ensureHelperIsApproved() {
  const { data: { user } } = await client.auth.getUser();
  if (!user) { alert("Please log in first."); return false; }

  const { data: profile, error } = await client.from("profiles").select("role, is_vetted").eq("id", user.id).single();
  if (error || !profile) { alert("Unable to verify your account status."); return false; }

  if (profile.role === "helper" && profile.is_vetted !== true) {
    alert("Your account is under review. You cannot apply for jobs yet.");
    return false;
  }
  return true;
}

// --- HOME SEARCH ---
let searchTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  const searchInput = document.getElementById("homeSearch");
  if (!searchInput) return;

  const locationFilter = document.getElementById("location-filter");
  if (locationFilter) {
    locationFilter.addEventListener("change", () => {
      const query = searchInput?.value.trim() || "";
      searchOpenJobs(query);
    });
  }

  searchInput.addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    const query = e.target.value.trim();
    if (query.length < 2) { document.getElementById("search-results").innerHTML = ""; return; }
    searchTimer = setTimeout(() => searchOpenJobs(query), 400);
  });
});

async function openJobFromSearch(jobId) {
  const allowed = await ensureHelperIsApproved();
  if (!allowed) return;
  localStorage.setItem("selectedJobId", jobId);
  window.location.href = "market.html";
}

async function searchOpenJobs(query) {
  const container = document.getElementById("search-results");
  const location = document.getElementById("location-filter")?.value || "";
  if (!container) return;

  container.innerHTML = "<p class='muted'>Searching jobs...</p>";

  let request = client.from("jobs").select("id, title, description, budget, location").eq("status", "open");
  if (query) request = request.or(`title.ilike.%${query}%,description.ilike.%${query}%`);
  if (location) request = request.ilike("location", `%${location}%`);

  const { data, error } = await request.order("created_at", { ascending: false }).limit(10);
  if (error) { container.innerHTML = "<p class='error'>Search failed</p>"; return; }
  if (!data || data.length === 0) { container.innerHTML = "<p class='muted'>No jobs found</p>"; return; }
  renderJobResults(data);
}

function renderJobResults(jobs) {
  const container = document.getElementById("search-results");
  container.innerHTML = jobs.map(job => `
    <div class="search-card" onclick="openJobFromSearch('${job.id}')">
      <h4>${job.title}</h4>
      <p>${job.description?.slice(0, 80) || ""}</p>
      <div class="job-meta">
        <span>${job.location || "Location not set"}</span>
        <span class="budget">${job.budget || "Budget not set"}</span>
      </div>
    </div>
  `).join("");
}

// --- TRENDING JOBS ---
async function loadTrendingJobs() {
  const container = document.getElementById("trending-jobs-container");
  if (!container || !client) return;
  container.innerHTML = "<p class='muted'>Loading trending jobs...</p>";
  try {
    const { data, error } = await client.from("jobs").select("id, title, description, budget, created_at")
      .eq("status", "open").order("created_at", { ascending: false }).limit(5);
    if (error || !data) throw error;
    container.innerHTML = data.length
      ? data.map(job => `
        <div class="trending-job-card" onclick="openJobFromSearch('${job.id}')">
          <h4>${job.title}</h4>
          <p>${job.description?.slice(0, 60) || ""}</p>
          <span class="budget">${job.budget || "Budget not set"}</span>
        </div>`).join("")
      : "<p class='muted'>No jobs available</p>";
  } catch { container.innerHTML = "<p class='muted'>Jobs unavailable</p>"; }
}

function renderTrendingJobs(jobs) {
  const container = document.getElementById("trending-jobs-container");
  container.innerHTML = jobs.map(job => `
    <div class="trending-job-card" onclick="openJobFromSearch('${job.id}')">
      <h4>${job.title || "Untitled Job"}</h4>
      <p>${job.description ? job.description.slice(0, 60) + "..." : ""}</p>
      <span class="budget">${job.budget || "Budget not set"}</span>
    </div>`).join("");
}

// --- MARKETPLACE JOBS ---
let allMarketplaceJobs = [];

async function loadMarketplaceJobs() {
  const container = document.getElementById("jobs-container");
  if (!container || !client) return;
  container.innerHTML = "<p class='muted'>Loading available jobs...</p>";
  try {
    const { data, error } = await client.from("jobs")
      .select("id, title, description, budget, category, created_at")
      .eq("status", "open").order("created_at", { ascending: false });
    if (error || !data) throw error;
    allMarketplaceJobs = data;
    renderMarketplaceJobs(allMarketplaceJobs);
  } catch { container.innerHTML = "<p class='muted'>Jobs unavailable</p>"; }
}

function filterJobs(category) {
  let filtered = [...allMarketplaceJobs];
  if (category !== "all") filtered = filtered.filter(job => job.category === category);
  renderMarketplaceJobs(filtered);
}

function renderMarketplaceJobs(jobs) {
  const container = document.getElementById("jobs-container");
  if (!container) return;
  if (!jobs.length) { container.innerHTML = "<p class='muted'>No jobs found</p>"; return; }
  container.innerHTML = jobs.map(job => `
    <div class="job-card" onclick="openJobFromSearch('${job.id}')">
      <div class="job-title">${job.title || "Untitled Job"}</div>
      <p>${job.description ? job.description.slice(0, 80) + "..." : ""}</p>
      <div class="job-footer">
        <span class="budget">${job.budget || "Budget not set"}</span>
      </div>
    </div>`).join("");
}

async function handlePostJob() {
  const title = document.getElementById('job-title')?.value.trim();
  const description = document.getElementById('job-desc')?.value.trim();
  const budget = document.getElementById('job-budget')?.value.trim();
  const category = document.getElementById('job-category')?.value;

  if (!title || !description || !budget || !category) {
    alert("Please fill in all fields including category.");
    return;
  }
  toggleLoader(true);
  try {
    const { data: { user } } = await client.auth.getUser();
    const { error } = await client.from("jobs").insert([{ title, description, budget, category, client_id: user.id, status: "open" }]);
    if (error) throw error;
    alert("Job posted successfully!");
    document.getElementById('job-title').value = "";
    document.getElementById('job-desc').value = "";
    document.getElementById('job-budget').value = "";
    document.getElementById('job-category').value = "";
    loadMarketplaceJobs?.();
  } catch (err) { alert(err.message); }
  finally { toggleLoader(false); }
}

// --- NAV HIGHLIGHT ---
document.addEventListener("DOMContentLoaded", () => {
  const currentPage = window.location.pathname.split("/").pop();
  document.querySelectorAll(".nav-item").forEach(btn => btn.classList.remove("active"));
  if (currentPage.includes("dashboard")) document.querySelector(".nav-item:nth-child(1)")?.classList.add("active");
  else if (currentPage.includes("market")) document.querySelector(".nav-item:nth-child(2)")?.classList.add("active");
  else if (currentPage.includes("auth")) document.querySelector(".nav-item:nth-child(4)")?.classList.add("active");
});

document.addEventListener("DOMContentLoaded", async () => {
  const { data: { user } } = await client.auth.getUser();
  const logoutLink = document.querySelector(".menu-content a:last-child");
  if (!user && logoutLink) logoutLink.style.display = "none";
});


// ============================================================
// CHAT SYSTEM — Full implementation using messages table
// ============================================================

// Chat state
let chatCurrentUser = null;
let chatCurrentProfile = null;
let chatActiveThread = null;   // { recipientId, recipientName, recipientAvatar, jobId }
let chatRealtimeChannel = null;
let chatUnreadCount = 0;

// ── BOOT CHAT ──
// Called once per page from the auto-open / nav handler
async function initChat() {
  try {
    const { data: { user } } = await client.auth.getUser();
    if (!user) return;
    chatCurrentUser = user;
    const { data: profile } = await client.from('profiles').select('full_name, role, is_vetted').eq('id', user.id).maybeSingle();
    chatCurrentProfile = profile;
    await loadUnreadCount();
    updateUnreadBadge();
  } catch (e) { console.error('Chat init error:', e); }
}

// ── OPEN CHAT PAGE ──
function openChatPage() {
  const page = document.getElementById('chat-page');
  if (!page) return;
  page.classList.remove('hidden');
  showInbox();
  loadChatList();
}

function exitChat() {
  document.getElementById('chat-page')?.classList.add('hidden');
  chatActiveThread = null;
  // Unsubscribe from realtime when chat closes
  if (chatRealtimeChannel) {
    client.removeChannel(chatRealtimeChannel);
    chatRealtimeChannel = null;
  }
}

// ── OPEN CHAT FROM NAV ──
async function openChatFromNav() {
  const { data: { user } } = await client.auth.getUser();
  if (!user) { window.location.href = "auth.html"; return; }

  const { data: profile } = await client.from("profiles").select("role, is_vetted").eq("id", user.id).single();
  if (profile?.role === "helper" && profile?.is_vetted !== true) {
    alert("Chat will be available after your account is approved.");
    return;
  }

  const chatPage = document.getElementById("chat-page");
  if (chatPage) {
    openChatPage();
  } else {
    localStorage.setItem("openChat", "true");
    window.location.href = "dashboard.html";
  }
}

// ── LOAD INBOX (contact list) ──
async function loadChatList() {
  const contactList = document.getElementById('contact-list');
  if (!contactList || !chatCurrentUser) return;

  contactList.innerHTML = '<div style="padding:20px;text-align:center;color:#999;font-size:13px">Loading conversations…</div>';

  try {
    // Get all messages involving current user (sent or received)
    const { data: msgs, error } = await client
      .from('messages')
      .select('*')
      .or(`sender_id.eq.${chatCurrentUser.id},recipient_id.eq.${chatCurrentUser.id}`)
      .order('created_at', { ascending: false });

    if (error) throw error;
    if (!msgs || msgs.length === 0) {
      contactList.innerHTML = `
        <div style="padding:40px 20px;text-align:center">
          <div style="font-size:32px;margin-bottom:10px">💬</div>
          <div style="font-weight:700;color:#333;margin-bottom:6px">No messages yet</div>
          <div style="font-size:13px;color:#999">Start a conversation by hiring a helper or applying for a job</div>
        </div>`;
      return;
    }

    // Deduplicate to one thread per unique conversation partner
    const threadsMap = new Map();
    msgs.forEach(m => {
      const otherId = m.sender_id === chatCurrentUser.id ? m.recipient_id : m.sender_id;
      if (!threadsMap.has(otherId)) threadsMap.set(otherId, m);
    });

    // Fetch profiles of all conversation partners
    const otherIds = [...threadsMap.keys()];
    const { data: profiles } = await client.from('profiles').select('id, full_name, email, role, selfie_url').in('id', otherIds);
    const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));

    // Count unread per thread
    const unreadMap = {};
    msgs.filter(m => m.recipient_id === chatCurrentUser.id && !m.is_read).forEach(m => {
      unreadMap[m.sender_id] = (unreadMap[m.sender_id] || 0) + 1;
    });
    chatUnreadCount = Object.values(unreadMap).reduce((a, b) => a + b, 0);
    updateUnreadBadge();

    // Render contact list
    contactList.innerHTML = [...threadsMap.entries()].map(([otherId, lastMsg]) => {
      const profile = profileMap[otherId] || {};
      const name = profile.full_name || profile.email || 'Unknown';
      const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
      const unread = unreadMap[otherId] || 0;
      const isMe = lastMsg.sender_id === chatCurrentUser.id;
      const preview = (isMe ? 'You: ' : '') + (lastMsg.content || '').slice(0, 45) + (lastMsg.content?.length > 45 ? '…' : '');
      const timeStr = formatChatTime(lastMsg.created_at);
      const avatarColor = stringToColor(name);

      return `
        <div class="contact-item" onclick="openThread('${otherId}', '${name.replace(/'/g, "\\'")}', '${lastMsg.job_id || ''}')">
          <div style="position:relative;flex-shrink:0">
            <div style="width:46px;height:46px;border-radius:50%;background:${avatarColor};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;color:white">${initials}</div>
            ${unread > 0 ? `<div style="position:absolute;top:-3px;right:-3px;background:#f07623;color:white;font-size:10px;font-weight:800;min-width:18px;height:18px;border-radius:9px;display:flex;align-items:center;justify-content:center;border:2px solid white;padding:0 4px">${unread}</div>` : ''}
          </div>
          <div style="flex:1;min-width:0;margin-left:12px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">
              <span style="font-weight:${unread > 0 ? 800 : 600};font-size:14px;color:#111">${name}</span>
              <span style="font-size:11px;color:#999;flex-shrink:0">${timeStr}</span>
            </div>
            <div style="font-size:13px;color:${unread > 0 ? '#111' : '#888'};font-weight:${unread > 0 ? 600 : 400};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${preview}</div>
          </div>
        </div>`;
    }).join('');

  } catch (e) {
    console.error('loadChatList error:', e);
    contactList.innerHTML = `<div style="padding:20px;text-align:center;color:#ef4444;font-size:13px">Error loading conversations</div>`;
  }
}

// ── OPEN THREAD ──
async function openThread(recipientId, recipientName, jobId = '') {
  chatActiveThread = { recipientId, recipientName, jobId: jobId || null };

  // Update header
  document.getElementById('chat-with-name').innerText = recipientName;

  // Show hire button only if current user is a client
  const hireActions = document.getElementById('hire-actions');
  if (hireActions) {
    hireActions.style.display = chatCurrentProfile?.role === 'client' ? 'flex' : 'none';
  }

  // Switch views
  document.getElementById('inbox-view').style.display = 'none';
  document.getElementById('chat-thread-view').classList.remove('hidden');

  // Mark messages as read
  await client.from('messages')
    .update({ is_read: true })
    .eq('sender_id', recipientId)
    .eq('recipient_id', chatCurrentUser.id);

  await loadMessages();
  subscribeToMessages();
}

// ── LOAD MESSAGES ──
async function loadMessages() {
  const container = document.getElementById('chat-messages');
  if (!container || !chatActiveThread || !chatCurrentUser) return;

  container.innerHTML = '<div style="padding:20px;text-align:center;color:#999;font-size:13px">Loading…</div>';

  try {
    const { data: msgs, error } = await client
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${chatCurrentUser.id},recipient_id.eq.${chatActiveThread.recipientId}),and(sender_id.eq.${chatActiveThread.recipientId},recipient_id.eq.${chatCurrentUser.id})`)
      .order('created_at', { ascending: true });

    if (error) throw error;

    if (!msgs || msgs.length === 0) {
      container.innerHTML = `
        <div style="padding:40px 20px;text-align:center">
          <div style="font-size:28px;margin-bottom:8px">👋</div>
          <div style="font-size:13px;color:#999">Say hello to ${chatActiveThread.recipientName}!</div>
        </div>`;
      return;
    }

    renderMessages(msgs);
    scrollToBottom();
  } catch (e) {
    container.innerHTML = `<div style="padding:20px;text-align:center;color:#ef4444;font-size:13px">Error loading messages</div>`;
  }
}

// ── RENDER MESSAGES ──
function renderMessages(msgs) {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  let html = '';
  let lastDate = '';

  msgs.forEach(msg => {
    const isMe = msg.sender_id === chatCurrentUser.id;
    const msgDate = new Date(msg.created_at).toLocaleDateString('en-KE', { weekday: 'short', month: 'short', day: 'numeric' });

    // Date separator
    if (msgDate !== lastDate) {
      html += `<div style="text-align:center;margin:12px 0;font-size:11px;color:#aaa;font-weight:600;letter-spacing:0.5px">${msgDate}</div>`;
      lastDate = msgDate;
    }

    const timeStr = new Date(msg.created_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });

    html += `
      <div style="display:flex;flex-direction:column;align-items:${isMe ? 'flex-end' : 'flex-start'};margin-bottom:6px">
        <div class="msg ${isMe ? 'me' : 'them'}" style="max-width:78%;word-break:break-word">
          ${escapeHtml(msg.content)}
        </div>
        <div style="font-size:10px;color:#bbb;margin-top:2px;padding:0 4px;display:flex;align-items:center;gap:4px">
          ${timeStr}
          ${isMe ? `<i class="fas fa-check${msg.is_read ? '-double' : ''}" style="font-size:10px;color:${msg.is_read ? '#3db83a' : '#bbb'}"></i>` : ''}
        </div>
      </div>`;
  });

  container.innerHTML = html;
}

// ── SEND MESSAGE ──
async function sendMessage() {
  const input = document.getElementById('msg-input');
  const content = input?.value.trim();
  if (!content || !chatActiveThread || !chatCurrentUser) return;

  input.value = '';
  input.focus();

  // Optimistic UI — add to DOM immediately
  const container = document.getElementById('chat-messages');
  const tempDiv = document.createElement('div');
  tempDiv.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;margin-bottom:6px';
  tempDiv.innerHTML = `
    <div class="msg me" style="max-width:78%;word-break:break-word;opacity:0.7">${escapeHtml(content)}</div>
    <div style="font-size:10px;color:#bbb;margin-top:2px;padding:0 4px">Sending…</div>`;
  container?.appendChild(tempDiv);
  scrollToBottom();

  try {
    const { error } = await client.from('messages').insert([{
      sender_id: chatCurrentUser.id,
      recipient_id: chatActiveThread.recipientId,
      job_id: chatActiveThread.jobId || null,
      content: content,
      is_read: false
    }]);

    if (error) throw error;
    tempDiv.remove();
    // Realtime will add the message via subscription
  } catch (e) {
    tempDiv.querySelector('.msg').style.background = '#ef4444';
    tempDiv.querySelector('div:last-child').textContent = 'Failed to send';
  }
}

// Enter key to send
document.addEventListener('DOMContentLoaded', () => {
  const msgInput = document.getElementById('msg-input');
  if (msgInput) {
    msgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }
});

// ── REALTIME SUBSCRIPTION ──
function subscribeToMessages() {
  // Unsubscribe from any existing channel first
  if (chatRealtimeChannel) {
    client.removeChannel(chatRealtimeChannel);
  }

  chatRealtimeChannel = client
    .channel('messages-realtime-' + chatCurrentUser.id)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `recipient_id=eq.${chatCurrentUser.id}`
    }, async (payload) => {
      const msg = payload.new;

      // If the message is from the active thread, render it and mark as read
      if (msg.sender_id === chatActiveThread?.recipientId) {
        appendMessage(msg, false);
        scrollToBottom();
        await client.from('messages').update({ is_read: true }).eq('id', msg.id);
      } else {
        // Message from someone else — update unread badge
        chatUnreadCount++;
        updateUnreadBadge();
        // Refresh contact list if inbox is visible
        if (document.getElementById('inbox-view')?.style.display !== 'none') {
          loadChatList();
        }
      }
    })
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'messages',
      filter: `sender_id=eq.${chatCurrentUser.id}`
    }, (payload) => {
      // Update read receipts on our own messages
      const msg = payload.new;
      if (msg.is_read) {
        // Reload messages to refresh ticks
        if (chatActiveThread?.recipientId === msg.recipient_id) loadMessages();
      }
    })
    .subscribe();

  // Also subscribe to messages we send (for multi-device sync)
  const sendChannel = client
    .channel('messages-sent-' + chatCurrentUser.id)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `sender_id=eq.${chatCurrentUser.id}`
    }, (payload) => {
      const msg = payload.new;
      if (msg.recipient_id === chatActiveThread?.recipientId) {
        appendMessage(msg, true);
        scrollToBottom();
      }
    })
    .subscribe();
}

function appendMessage(msg, isMe) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const timeStr = new Date(msg.created_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
  const div = document.createElement('div');
  div.style.cssText = `display:flex;flex-direction:column;align-items:${isMe ? 'flex-end' : 'flex-start'};margin-bottom:6px`;
  div.innerHTML = `
    <div class="msg ${isMe ? 'me' : 'them'}" style="max-width:78%;word-break:break-word">${escapeHtml(msg.content)}</div>
    <div style="font-size:10px;color:#bbb;margin-top:2px;padding:0 4px;display:flex;align-items:center;gap:4px">
      ${timeStr}
      ${isMe ? '<i class="fas fa-check" style="font-size:10px;color:#bbb"></i>' : ''}
    </div>`;
  container.appendChild(div);
}

// ── OPEN THREAD WITH SPECIFIC USER (from marketplace / hire flow) ──
async function startChatWith(recipientId, recipientName, jobId = null) {
  if (!chatCurrentUser) await initChat();
  if (!chatCurrentUser) { window.location.href = 'auth.html'; return; }

  chatActiveThread = { recipientId, recipientName, jobId };

  const chatPage = document.getElementById('chat-page');
  if (chatPage) {
    chatPage.classList.remove('hidden');
    document.getElementById('chat-with-name').innerText = recipientName;
    const hireActions = document.getElementById('hire-actions');
    if (hireActions) hireActions.style.display = chatCurrentProfile?.role === 'client' ? 'flex' : 'none';
    document.getElementById('inbox-view').style.display = 'none';
    document.getElementById('chat-thread-view')?.classList.remove('hidden');
    await loadMessages();
    subscribeToMessages();
  } else {
    localStorage.setItem('openChat', 'true');
    localStorage.setItem('chatRecipientId', recipientId);
    localStorage.setItem('chatRecipientName', recipientName);
    if (jobId) localStorage.setItem('chatJobId', jobId);
    window.location.href = 'dashboard.html';
  }
}

// ── CONFIRM HIRE (client confirms hiring a helper) ──
async function confirmHire() {
  if (!chatActiveThread || !chatCurrentUser) return;

  const confirmMsg = `Hi! I'd like to officially hire you for this job. Please confirm your availability.`;

  try {
    await client.from('messages').insert([{
      sender_id: chatCurrentUser.id,
      recipient_id: chatActiveThread.recipientId,
      job_id: chatActiveThread.jobId || null,
      content: confirmMsg,
      is_read: false
    }]);

    // Also update booking status if job_id exists
    if (chatActiveThread.jobId) {
      await client.from('bookings')
        .update({ status: 'accepted' })
        .eq('job_id', chatActiveThread.jobId)
        .eq('helper_id', chatActiveThread.recipientId);
    }

    alert(`Hire request sent to ${chatActiveThread.recipientName}!`);
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// ── SHOW/HIDE INBOX ──
function showInbox() {
  const inboxView = document.getElementById('inbox-view');
  const threadView = document.getElementById('chat-thread-view');
  if (inboxView) inboxView.style.display = 'block';
  if (threadView) threadView.classList.add('hidden');
  document.getElementById('chat-with-name').innerText = 'Inbox';
  chatActiveThread = null;
  if (chatRealtimeChannel) { client.removeChannel(chatRealtimeChannel); chatRealtimeChannel = null; }
}

// ── LEGACY showChatThread (kept for backward compatibility) ──
function showChatThread(name) {
  document.getElementById('chat-with-name').innerText = name;
  document.getElementById('inbox-view').style.display = 'none';
  document.getElementById('chat-thread-view')?.classList.remove('hidden');
}

// ── UNREAD COUNT ──
async function loadUnreadCount() {
  if (!chatCurrentUser) return;
  try {
    const { count } = await client.from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('recipient_id', chatCurrentUser.id)
      .eq('is_read', false);
    chatUnreadCount = count || 0;
  } catch (e) {}
}

function updateUnreadBadge() {
  // Update chat nav button badge
  const chatNav = document.getElementById('nav-chat');
  if (!chatNav) return;

  let badge = chatNav.querySelector('.chat-badge');
  if (chatUnreadCount > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'chat-badge';
      badge.style.cssText = 'position:absolute;top:-4px;right:-4px;background:#f07623;color:white;font-size:9px;font-weight:800;min-width:16px;height:16px;border-radius:8px;display:flex;align-items:center;justify-content:center;padding:0 3px;border:2px solid white';
      chatNav.style.position = 'relative';
      chatNav.appendChild(badge);
    }
    badge.textContent = chatUnreadCount > 9 ? '9+' : chatUnreadCount;
  } else if (badge) {
    badge.remove();
  }
}

// ── HELPERS ──
function scrollToBottom() {
  const container = document.getElementById('chat-messages');
  if (container) container.scrollTop = container.scrollHeight;
}

function escapeHtml(text) {
  return (text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function formatChatTime(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString('en-KE', { weekday: 'short' });
  return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
}

function stringToColor(str) {
  const colors = ['#3db83a','#3b82f6','#f07623','#8b5cf6','#ec4899','#f59e0b','#0891b2','#16a34a'];
  let h = 0; for (let c of (str||'?')) h = (h<<5)-h+c.charCodeAt(0);
  return colors[Math.abs(h) % colors.length];
}

// ── AUTO-BOOT CHAT ON DASHBOARD LOAD ──
document.addEventListener("DOMContentLoaded", async () => {
  // Init chat for any page that has the chat panel
  if (document.getElementById('chat-page')) {
    await initChat();
    updateUnreadBadge();

    // Auto-open chat if redirected from another page
    if (localStorage.getItem("openChat") === "true") {
      localStorage.removeItem("openChat");
      const recipientId = localStorage.getItem('chatRecipientId');
      const recipientName = localStorage.getItem('chatRecipientName');
      const jobId = localStorage.getItem('chatJobId');
      if (recipientId && recipientName) {
        localStorage.removeItem('chatRecipientId');
        localStorage.removeItem('chatRecipientName');
        localStorage.removeItem('chatJobId');
        setTimeout(() => startChatWith(recipientId, recipientName, jobId), 400);
      } else {
        setTimeout(() => openChatPage(), 300);
      }
    }
  }
});

// ============================================================
// GLOBAL EXPOSURE
// ============================================================
window.client = client;
window.signUp = signUp;
window.login = login;
window.detectMyLocation = detectMyLocation;
window.handleVettingUpload = handleVettingUpload;
window.loadDashboardStats = loadDashboardStats;
window.loadPendingHelpers = loadPendingHelpers;
window.updateVettingStatus = updateVettingStatus;
window.loadTrendingJobs = loadTrendingJobs;
window.loadMarketplaceJobs = loadMarketplaceJobs;
window.filterJobs = filterJobs;
window.handlePostJob = handlePostJob;
window.toggleAppMenu = toggleAppMenu;
window.handleProfileClick = handleProfileClick;
window.logout = async () => { await client.auth.signOut(); window.location.href = 'index.html'; };

// Chat globals
window.openChatPage = openChatPage;
window.exitChat = exitChat;
window.openChatFromNav = openChatFromNav;
window.loadChatList = loadChatList;
window.openThread = openThread;
window.sendMessage = sendMessage;
window.confirmHire = confirmHire;
window.showChatThread = showChatThread;
window.showInbox = showInbox;
window.startChatWith = startChatWith;
