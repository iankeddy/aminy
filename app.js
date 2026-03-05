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

// --- VETTING & LOCATION (Missing Functions Restored) ---

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

function openChatPage() {
  document.getElementById("chat-page").classList.remove("hidden");
  document.getElementById("inbox-view").style.display = "block";
  document.getElementById("chat-thread-view").classList.add("hidden");
}

function exitChat() {
  document.getElementById("chat-page").classList.add("hidden");
}

function showChatThread(name) {
  document.getElementById("chat-with-name").innerText = name;
  document.getElementById("inbox-view").style.display = "none";
  document.getElementById("chat-thread-view").classList.remove("hidden");
}

// Navigate to page
function goToPage(page) {
  if (window.location.pathname.includes(page)) return; // Already there
  window.location.href = page;
}

// Open chat from bottom nav
async function openChatFromNav() {
  const { data: { user } } = await client.auth.getUser();
  if (!user) {
    window.location.href = "auth.html";
    return;
  }

  const { data: profile } = await client
    .from("profiles")
    .select("role, is_vetted")
    .eq("id", user.id)
    .single();

  if (profile.role === "helper" && profile.is_vetted !== true) {
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

// Highlight active nav item
document.addEventListener("DOMContentLoaded", () => {
  const currentPage = window.location.pathname.split("/").pop();
  document.querySelectorAll(".nav-item").forEach(btn => btn.classList.remove("active"));

  if (currentPage.includes("dashboard")) document.querySelector(".nav-item:nth-child(1)")?.classList.add("active");
  else if (currentPage.includes("market")) document.querySelector(".nav-item:nth-child(2)")?.classList.add("active");
  else if (currentPage.includes("auth")) document.querySelector(".nav-item:nth-child(4)")?.classList.add("active");

  // Auto-open chat if redirected
  if (localStorage.getItem("openChat") === "true") {
    localStorage.removeItem("openChat");
    setTimeout(() => { openChatPage(); }, 300);
  }
});

// =======================
// HOME JOB SEARCH
// =======================

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
    if (query.length < 2) {
      document.getElementById("search-results").innerHTML = "";
      return;
    }

    searchTimer = setTimeout(() => {
      searchOpenJobs(query);
    }, 400);
  });
});
async function openJobFromSearch(jobId) {
  const allowed = await ensureHelperIsApproved();
  if (!allowed) return;

  localStorage.setItem("selectedJobId", jobId);
  window.location.href = "market.html";
}

// =======================
// HOME JOB SEARCH (FIXED)
// =======================

async function searchOpenJobs(query) {
  const container = document.getElementById("search-results");
  const location = document.getElementById("location-filter")?.value || "";

  if (!container) return;

  container.innerHTML = "<p class='muted'>Searching jobs...</p>";

  let request = client
    .from("jobs")
    .select("id, title, description, budget, location")
    .eq("status", "open");

  if (query) {
    request = request.or(
      `title.ilike.%${query}%,description.ilike.%${query}%`
    );
  }

  if (location) {
    request = request.ilike("location", `%${location}%`);
  }

  const { data, error } = await request
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error(error);
    container.innerHTML = "<p class='error'>Search failed</p>";
    return;
  }

  if (!data || data.length === 0) {
    container.innerHTML = "<p class='muted'>No jobs found</p>";
    return;
  }

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


// =======================
// TRENDING JOBS (HOME)
// =======================

async function loadTrendingJobs() {
  const container = document.getElementById("trending-jobs-container");
  if (!container || !client) return;

  container.innerHTML = "<p class='muted'>Loading trending jobs...</p>";

  try {
    const { data, error } = await client
      .from("jobs")
      .select("id, title, description, budget, created_at")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(5);

    if (error || !data) throw error;

    container.innerHTML = data.length
      ? data.map(job => `
        <div class="trending-job-card" onclick="openJobFromSearch('${job.id}')">
          <h4>${job.title}</h4>
          <p>${job.description?.slice(0, 60) || ""}</p>
          <span class="budget">${job.budget || "Budget not set"}</span>
        </div>
      `).join("")
      : "<p class='muted'>No jobs available</p>";

  } catch {
    container.innerHTML = "<p class='muted'>Jobs unavailable</p>";
  }
}


function renderTrendingJobs(jobs) {
  const container = document.getElementById("trending-jobs-container");

  container.innerHTML = jobs.map(job => `
    <div class="trending-job-card" onclick="openJobFromSearch('${job.id}')">
      <h4>${job.title || "Untitled Job"}</h4>
      <p>${job.description ? job.description.slice(0, 60) + "..." : ""}</p>
      <span class="budget">${job.budget || "Budget not set"}</span>
    </div>
  `).join("");
}
// =======================
// MARKETPLACE JOBS (FIXED)
// =======================

let allMarketplaceJobs = [];

async function loadMarketplaceJobs() {
  const container = document.getElementById("jobs-container");
  if (!container || !client) return;

  container.innerHTML = "<p class='muted'>Loading available jobs...</p>";

  try {
    const { data, error } = await client
      .from("jobs")
      .select("id, title, description, budget, category, created_at")
      .eq("status", "open")
      .order("created_at", { ascending: false });

    if (error || !data) throw error;

    allMarketplaceJobs = data;
    renderMarketplaceJobs(allMarketplaceJobs);

  } catch {
    container.innerHTML = "<p class='muted'>Jobs unavailable</p>";
  }
}

function filterJobs(category) {
  let filtered = [...allMarketplaceJobs];

  if (category !== "all") {
    filtered = filtered.filter(job => job.category === category);
  }

  renderMarketplaceJobs(filtered);
}

function renderMarketplaceJobs(jobs) {
  const container = document.getElementById("jobs-container");
  if (!container) return;

  if (!jobs.length) {
    container.innerHTML = "<p class='muted'>No jobs found</p>";
    return;
  }

  container.innerHTML = jobs.map(job => `
    <div class="job-card" onclick="openJobFromSearch('${job.id}')">
      <div class="job-title">${job.title || "Untitled Job"}</div>
      <p>${job.description ? job.description.slice(0, 80) + "..." : ""}</p>
      <div class="job-footer">
        <span class="budget">${job.budget || "Budget not set"}</span>
      </div>
    </div>
  `).join("");
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

    const { error } = await client.from("jobs").insert([{
      title,
      description,
      budget,
      category,
      client_id: user.id,
      status: "open"
    }]);

    if (error) throw error;

    alert("Job posted successfully!");
    document.getElementById('job-title').value = "";
    document.getElementById('job-desc').value = "";
    document.getElementById('job-budget').value = "";
    document.getElementById('job-category').value = "";

    loadMarketplaceJobs?.();

  } catch (err) {
    alert(err.message);
  } finally {
    toggleLoader(false);
  }
}

function toggleAppMenu() {
  const menu = document.getElementById("app-menu");
  if (!menu) return;
  menu.classList.toggle("hidden");
}

async function handleProfileClick() {
  try {
    const { data: { user } } = await client.auth.getUser();

    if (user) {
      window.location.href = "dashboard.html";
    } else {
      window.location.href = "auth.html";
    }
  } catch (err) {
    console.error("Profile check failed:", err);
    window.location.href = "auth.html";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const { data: { user } } = await client.auth.getUser();
  const logoutLink = document.querySelector(".menu-content a:last-child");

  if (!user && logoutLink) {
    logoutLink.style.display = "none";
  }
});

async function ensureHelperIsApproved() {
  const { data: { user } } = await client.auth.getUser();

  if (!user) {
    alert("Please log in first.");
    return false;
  }

  const { data: profile, error } = await client
    .from("profiles")
    .select("role, is_vetted")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    alert("Unable to verify your account status.");
    return false;
  }

  // If helper and not approved → BLOCK
  if (profile.role === "helper" && profile.is_vetted !== true) {
    alert("Your account is under review. You cannot apply for jobs yet.");
    return false;
  }

  // Otherwise → ALLOW
  return true;
}



// --- GLOBAL EXPOSURE ---
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