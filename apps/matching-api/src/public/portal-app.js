const routes = [
  { path: "/app/dashboard", label: "Dashboard", id: "dashboard", roles: ["admin", "user"] },
  { path: "/app/matched-offers", label: "Eşleşmiş Teklifler", id: "matched-offers", roles: ["admin", "user"] },
  { path: "/app/users", label: "Kullanıcı Yönetimi", id: "users", roles: ["admin"] }
];

const pageTitleEl = document.getElementById("pageTitle");
const pageEyebrowEl = document.getElementById("pageEyebrow");
const pageContentEl = document.getElementById("pageContent");
const currentUserNameEl = document.getElementById("currentUserName");
const currentUserMetaEl = document.getElementById("currentUserMeta");
const sidebarNavEl = document.getElementById("sidebarNav");
const logoutBtnEl = document.getElementById("logoutBtn");

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function currentRoute(role) {
  const pathname = window.location.pathname;
  const route = routes.find((item) => item.path === pathname && item.roles.includes(role));
  return route || routes.find((item) => item.id === "dashboard");
}

function navLink(route, isActive) {
  return `
    <a class="nav-link ${isActive ? "active" : ""}" href="${route.path}">
      <span>${route.label}</span>
    </a>
  `;
}

function renderSidebar(user) {
  const allowed = routes.filter((route) => route.roles.includes(user.role));
  const route = currentRoute(user.role);
  sidebarNavEl.innerHTML = [
    ...allowed.map((item) => navLink(item, item.path === route.path)),
    `<button type="button" class="nav-link nav-link-button" id="openUiBtn"><span>Eşleme Konsolu</span></button>`
  ].join("");

  document.getElementById("openUiBtn")?.addEventListener("click", () => {
    window.open("/ui/", "_blank", "noopener");
  });
}

function renderCards(cards) {
  return `
    <section class="card-grid">
      <article class="stat-card"><span>Toplam Teklif</span><strong>${cards.totalOffers}</strong></article>
      <article class="stat-card"><span>Bugün Eşleşen</span><strong>${cards.todayOffers}</strong></article>
      <article class="stat-card"><span>Bekleyen</span><strong>${cards.pendingOffers}</strong></article>
      <article class="stat-card"><span>Aktif Kullanıcı</span><strong>${cards.totalUsers}</strong></article>
    </section>
  `;
}

function renderPieChart(items) {
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
  let offset = 0;
  const slices = items.map((item, index) => {
    const value = item.value / total;
    const dash = `${Math.max(1, value * 251)} 251`;
    const rotation = offset * 360;
    offset += value;
    return `<circle r="40" cx="50" cy="50" fill="transparent" stroke="var(--chart-${(index % 4) + 1})" stroke-width="16" stroke-dasharray="${dash}" transform="rotate(${rotation - 90} 50 50)"></circle>`;
  }).join("");

  const legend = items.map((item, index) => `
    <li><span class="legend-dot" style="background: var(--chart-${(index % 4) + 1})"></span>${item.label} <strong>${item.value}</strong></li>
  `).join("");

  return `
    <article class="chart-card">
      <div class="chart-card-head"><h3>Kaynak Dağılımı</h3><span>Daire</span></div>
      <div class="pie-layout">
        <svg viewBox="0 0 100 100" class="pie-chart">${slices}</svg>
        <ul class="chart-legend">${legend}</ul>
      </div>
    </article>
  `;
}

function renderLineChart(items) {
  const values = items.length > 0 ? items : [
    { label: "Pzt", value: 2 },
    { label: "Sal", value: 4 },
    { label: "Car", value: 3 },
    { label: "Per", value: 6 },
    { label: "Cum", value: 5 }
  ];
  const max = Math.max(...values.map((item) => item.value), 1);
  const points = values.map((item, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * 100;
    const y = 100 - ((item.value / max) * 80 + 10);
    return `${x},${y}`;
  }).join(" ");
  const labels = values.map((item) => `<span>${item.label}</span>`).join("");

  return `
    <article class="chart-card">
      <div class="chart-card-head"><h3>Günlük Trend</h3><span>Çizgi</span></div>
      <svg viewBox="0 0 100 100" class="line-chart">
        <polyline points="${points}" fill="none" stroke="var(--chart-2)" stroke-width="3"></polyline>
      </svg>
      <div class="line-labels">${labels}</div>
    </article>
  `;
}

function renderBarChart(items) {
  const values = items.length > 0 ? items : [
    { label: "Admin", value: 4 },
    { label: "User", value: 7 }
  ];
  const max = Math.max(...values.map((item) => item.value), 1);
  const bars = values.map((item, index) => `
    <div class="bar-item">
      <div class="bar-value" style="height:${Math.max(16, (item.value / max) * 140)}px; background: var(--chart-${(index % 4) + 1})"></div>
      <span>${item.label}</span>
      <strong>${item.value}</strong>
    </div>
  `).join("");

  return `
    <article class="chart-card">
      <div class="chart-card-head"><h3>Kullanıcı Bazlı İşlem</h3><span>Sütun</span></div>
      <div class="bar-chart">${bars}</div>
    </article>
  `;
}

async function renderDashboard() {
  const data = await api("/dashboard/summary");
  pageEyebrowEl.textContent = "Genel Görünüm";
  pageTitleEl.textContent = "Dashboard";
  pageContentEl.innerHTML = `
    ${renderCards(data.cards)}
    <section class="chart-grid">
      ${renderPieChart(data.pie)}
      ${renderLineChart(data.line)}
      ${renderBarChart(data.bar)}
    </section>
  `;
}

function renderUsersTable(items) {
  if (!items.length) {
    return `<div class="empty-box">Henüz kullanıcı yok.</div>`;
  }

  const rows = items.map((item) => `
    <tr>
      <td>${item.fullName}</td>
      <td>${item.username}</td>
      <td>${item.role}</td>
      <td>${item.isActive ? "Aktif" : "Pasif"}</td>
      <td>${new Date(item.createdAt).toLocaleString("tr-TR")}</td>
    </tr>
  `).join("");

  return `
    <div class="table-card">
      <table class="portal-table">
        <thead>
          <tr>
            <th>Ad Soyad</th>
            <th>Kullanıcı Adı</th>
            <th>Rol</th>
            <th>Durum</th>
            <th>Oluşturma</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

async function renderUsers() {
  pageEyebrowEl.textContent = "Yönetim";
  pageTitleEl.textContent = "Kullanıcı Yönetimi";
  pageContentEl.innerHTML = `
    <section class="split-grid">
      <article class="form-card">
        <h3>Yeni Kullanıcı</h3>
        <form id="userCreateForm" class="stack-form">
          <label><span>Ad Soyad</span><input name="fullName" required></label>
          <label><span>Kullanıcı Adı</span><input name="username" required></label>
          <label><span>Şifre</span><input type="password" name="password" required></label>
          <label>
            <span>Rol</span>
            <select name="role">
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <label class="checkbox-line"><input type="checkbox" name="isActive" checked> Aktif</label>
          <button type="submit" class="btn-primary">Kullanıcı Ekle</button>
          <p id="userFormStatus" class="form-status"></p>
        </form>
      </article>
      <article>
        <h3>Mevcut Kullanıcılar</h3>
        <div id="usersTableHost">Yükleniyor...</div>
      </article>
    </section>
  `;

  const tableHost = document.getElementById("usersTableHost");
  const loadUsers = async () => {
    const data = await api("/users");
    tableHost.innerHTML = renderUsersTable(data.items);
  };
  await loadUsers();

  document.getElementById("userCreateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const statusEl = document.getElementById("userFormStatus");
    statusEl.textContent = "";
    try {
      await api("/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: form.get("fullName"),
          username: form.get("username"),
          password: form.get("password"),
          role: form.get("role"),
          isActive: form.get("isActive") === "on"
        })
      });
      statusEl.textContent = "Kullanıcı oluşturuldu.";
      event.currentTarget.reset();
      await loadUsers();
    } catch (error) {
      statusEl.textContent = error instanceof Error ? error.message : "İşlem başarısız";
    }
  });
}

function renderOffersTable(items) {
  if (!items.length) {
    return `<div class="empty-box">Henüz kaydedilmiş teklif yok.</div>`;
  }

  const rows = items.map((item) => `
    <tr data-offer-id="${item.id}">
      <td>${item.id}</td>
      <td>${item.title}</td>
      <td>${item.sourceName || "-"}</td>
      <td>${item.sourceType || "-"}</td>
      <td>${item.profileName || "-"}</td>
      <td>${item.lineCount}</td>
      <td>${item.createdBy || "-"}</td>
      <td>${new Date(item.createdAt).toLocaleString("tr-TR")}</td>
    </tr>
  `).join("");

  return `
    <div class="table-card">
      <table class="portal-table portal-table-clickable">
        <thead>
          <tr>
            <th>ID</th>
            <th>Başlık</th>
            <th>Kaynak</th>
            <th>Tip</th>
            <th>Profil</th>
            <th>Satır</th>
            <th>Kullanıcı</th>
            <th>Tarih</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

async function renderMatchedOffers() {
  pageEyebrowEl.textContent = "Teklifler";
  pageTitleEl.textContent = "Eşleşmiş Teklifler";
  const data = await api("/matched-offers");
  pageContentEl.innerHTML = renderOffersTable(data.items);

  pageContentEl.querySelectorAll("[data-offer-id]").forEach((row) => {
    row.addEventListener("click", () => {
      const offerId = row.getAttribute("data-offer-id");
      if (!offerId) return;
      window.open(`/ui/?recordId=${offerId}`, "_blank", "noopener");
    });
  });
}

async function renderApp() {
  try {
    const auth = await api("/auth/me");
    const user = auth.user;
    if (!user) {
      window.location.href = "/login";
      return;
    }

    currentUserNameEl.textContent = user.fullName;
    currentUserMetaEl.textContent = `${user.username} • ${user.role}`;
    renderSidebar(user);

    const route = currentRoute(user.role);
    if (route.id === "users") {
      await renderUsers();
    } else if (route.id === "matched-offers") {
      await renderMatchedOffers();
    } else {
      await renderDashboard();
    }
  } catch (_error) {
    window.location.href = "/login";
  }
}

logoutBtnEl?.addEventListener("click", async () => {
  await api("/auth/logout", { method: "POST" }).catch(() => null);
  window.location.href = "/login";
});

renderApp();
