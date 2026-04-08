const routes = [
  { path: "/app/dashboard", label: "Dashboard", id: "dashboard", roles: ["admin", "user"] },
  { path: "/app/matched-offers", label: "Eşleşmiş Teklifler", id: "matched-offers", roles: ["admin", "user"] },
  { path: "/app/users", label: "Kullanıcı Yönetimi", id: "users", roles: ["admin"] },
  { path: "/app/matching-rules", label: "Kural Yönetimi", id: "matching-rules", roles: ["admin"] }
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function prettyJson(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("tr-TR");
}

function badge(label, tone = "neutral") {
  return `<span class="info-chip info-chip--${tone}">${escapeHtml(label)}</span>`;
}

function summarizeRuleCondition(condition) {
  if (!condition || typeof condition !== "object") return "-";
  if (Array.isArray(condition.all)) {
    return condition.all.map((item) => `${item.field} ${item.operator} ${item.value}`).join(" AND ");
  }
  if (Array.isArray(condition.any)) {
    return condition.any.map((item) => `${item.field} ${item.operator} ${item.value}`).join(" OR ");
  }
  if (condition.field && condition.operator) {
    return `${condition.field} ${condition.operator} ${condition.value ?? ""}`.trim();
  }
  return prettyJson(condition);
}

function summarizeRuleEffect(effect) {
  if (!effect || typeof effect !== "object") return "-";
  const type = String(effect.type || "-");
  if (effect.value !== undefined && effect.value !== null && effect.value !== "") {
    return `${type}: ${effect.value}`;
  }
  if (effect.field) {
    return `${type}: ${effect.field}`;
  }
  return type;
}

function renderPolicySummary(policyJson) {
  const matchPolicy = policyJson?.matchPolicy || {};
  const rowDefaults = policyJson?.rowDefaults || {};
  const chips = [];

  if (policyJson?.extractionPrompt) chips.push(badge("Extraction override", "orange"));
  if (matchPolicy.stockCodePrefix) chips.push(badge(`Prefix ${matchPolicy.stockCodePrefix}`, "blue"));
  if (matchPolicy.preferredSeries) chips.push(badge(`Seri ${matchPolicy.preferredSeries}`, "green"));
  if (matchPolicy.preferredTemper) chips.push(badge(`Temper ${matchPolicy.preferredTemper}`, "green"));
  if (matchPolicy.preferredProductType) chips.push(badge(`Tip ${matchPolicy.preferredProductType}`, "green"));
  if (Array.isArray(matchPolicy.requiredTerms) && matchPolicy.requiredTerms.length > 0) {
    chips.push(...matchPolicy.requiredTerms.slice(0, 3).map((term) => badge(`Terim ${term}`, "neutral")));
  }
  if (rowDefaults.kesimDurumu) chips.push(badge(rowDefaults.kesimDurumu, "blue"));
  if (rowDefaults.mensei) chips.push(badge(rowDefaults.mensei, "blue"));
  if (rowDefaults.quantity) chips.push(badge(`Adet ${rowDefaults.quantity}`, "blue"));

  return chips.join("") || badge("Boş policy", "neutral");
}

function renderPlanPreview(plan) {
  if (!plan) {
    return `<div class="empty-box">Henüz soft preference önizlemesi oluşturulmadı.</div>`;
  }

  const policy = plan.matchPolicy || {};
  const defaults = plan.rowDefaults || {};

  return `
    <section class="mini-stat-grid">
      <article class="mini-stat-card"><span>Re-extract</span><strong>${plan.needsReextract ? "Evet" : "Hayır"}</strong></article>
      <article class="mini-stat-card"><span>Re-match</span><strong>${plan.needsRematch ? "Evet" : "Hayır"}</strong></article>
      <article class="mini-stat-card"><span>Learnable</span><strong>${plan.learnable ? "Evet" : "Hayır"}</strong></article>
    </section>
    <section class="result-card-grid">
      <article class="result-card">
        <div class="result-card-head"><strong>Match Policy</strong></div>
        <div class="chip-row">${renderPolicySummary({ matchPolicy: policy })}</div>
      </article>
      <article class="result-card">
        <div class="result-card-head"><strong>Satır Defaults</strong></div>
        <div class="chip-row">${renderPolicySummary({ rowDefaults: defaults })}</div>
      </article>
      <article class="result-card">
        <div class="result-card-head"><strong>Extraction Prompt</strong></div>
        <p>${escapeHtml(plan.extractionPrompt || "-")}</p>
      </article>
    </section>
  `;
}

function renderInstructionPolicies(items) {
  if (!items.length) {
    return `<div class="empty-box">Henüz kayıtlı tercih politikası yok.</div>`;
  }

  const rows = items.map((item) => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.source_type)}</td>
      <td>${item.success_count} / ${item.failure_count}</td>
      <td>${item.use_count}</td>
      <td><div class="chip-row">${renderPolicySummary(item.policy_json)}</div></td>
      <td><span class="status-badge ${item.active ? "status-badge--sent" : "status-badge--draft"}">${item.active ? "Aktif" : "Pasif"}</span></td>
      <td>
        <button
          type="button"
          class="btn-secondary btn-small"
          data-policy-toggle="${item.id}"
          data-next-active="${item.active ? "0" : "1"}"
        >${item.active ? "Pasifleştir" : "Aktifleştir"}</button>
      </td>
    </tr>
  `).join("");

  return `
    <div class="table-card">
      <table class="portal-table">
        <thead>
          <tr>
            <th>Ad</th>
            <th>Kaynak</th>
            <th>Başarı / Hata</th>
            <th>Kullanım</th>
            <th>Özet</th>
            <th>Durum</th>
            <th>İşlem</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderRecentAuditTable(items) {
  if (!items.length) {
    return `<div class="empty-box">Henüz kural geçmişi bulunan bir eşleşme yok.</div>`;
  }

  const rows = items.map((item) => {
    const summary = item.rule_summary_json || {};
    return `
      <tr>
        <td>${item.id}</td>
        <td>${formatDateTime(item.created_at)}</td>
        <td>${escapeHtml(String(item.input_text || "").slice(0, 80))}</td>
        <td>${escapeHtml(item.stock_code || "-")}</td>
        <td>${escapeHtml(summary.stage || "-")}</td>
        <td>${summary.keptCount ?? "-"}</td>
        <td><button type="button" class="btn-secondary btn-small" data-audit-open="${item.id}">Detayı Aç</button></td>
      </tr>
    `;
  }).join("");

  return `
    <div class="table-card">
      <table class="portal-table">
        <thead>
          <tr>
            <th>Match ID</th>
            <th>Tarih</th>
            <th>Girdi</th>
            <th>Seçilen Stok</th>
            <th>Stage</th>
            <th>Kalan</th>
            <th>İşlem</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderAuditDetail(items) {
  if (!items) {
    return `<div class="empty-box">Bir kayıt seçtiğinizde kural geçmişi burada açılır.</div>`;
  }
  if (!items.length) {
    return `<div class="empty-box">Seçilen eşleşme için kayıtlı kural geçmişi yok.</div>`;
  }

  return `<section class="result-card-grid">${items.map((item) => `
    <article class="result-card">
      <div class="result-card-head">
        <strong>Kural ${item.rule_id}</strong>
        ${badge(item.decision, item.decision === "kept" ? "green" : "orange")}
      </div>
      <p>${escapeHtml(item.reason_text || "-")}</p>
      <div class="chip-row">
        ${item.candidate_stock_id ? badge(`Aday ${item.candidate_stock_id}`, "blue") : ""}
        ${item.delta_score !== null ? badge(`Skor ${item.delta_score}`, "neutral") : ""}
        ${badge(formatDateTime(item.created_at), "neutral")}
      </div>
    </article>
  `).join("")}</section>`;
}

function readHardRuleForm(formEl) {
  const form = new FormData(formEl);
  const field = String(form.get("conditionField") ?? "input.dim1").trim();
  const minValue = String(form.get("conditionMin") ?? "").trim();
  const maxValue = String(form.get("conditionMax") ?? "").trim();
  const equalsValue = String(form.get("conditionEquals") ?? "").trim();
  const clauses = [];

  if (minValue) clauses.push({ field, operator: "gte", value: Number.isFinite(Number(minValue)) ? Number(minValue) : minValue });
  if (maxValue) clauses.push({ field, operator: "lte", value: Number.isFinite(Number(maxValue)) ? Number(maxValue) : maxValue });
  if (equalsValue) clauses.push({ field, operator: "eq", value: Number.isFinite(Number(equalsValue)) ? Number(equalsValue) : equalsValue });

  if (clauses.length === 0) {
    throw new Error("En az bir koşul değeri girmeniz gerekiyor.");
  }

  const effectType = String(form.get("effectType") ?? "require_prefix").trim();
  const effectValue = String(form.get("effectValue") ?? "").trim();
  const effectField = String(form.get("effectField") ?? "").trim();
  const effect = { type: effectType };

  if (effectType === "require_prefix" || effectType === "reject_prefix" || effectType === "require_exact_series") {
    if (!effectValue) throw new Error("Seçilen kural tipi için bir değer girmeniz gerekiyor.");
    effect.value = effectValue;
  } else if (effectType === "require_non_null" || effectType === "reject_if_missing_dimension") {
    if (!effectField) throw new Error("Seçilen kural tipi için hedef alan seçmeniz gerekiyor.");
    effect.field = effectField;
  }

  return {
    rule_set_name: "default",
    priority: Number(form.get("priority") ?? 100),
    description: String(form.get("description") ?? "").trim() || null,
    rule_type: "hard_filter",
    target_level: "pair",
    condition_json: clauses.length === 1 ? clauses[0] : { all: clauses },
    effect_json: effect,
    stop_on_match: form.get("stopOnMatch") === "on",
    is_active: true
  };
}

function activateRuleEditorTab(tabId) {
  document.querySelectorAll("[data-rule-tab]").forEach((button) => {
    const active = button.getAttribute("data-rule-tab") === tabId;
    button.classList.toggle("is-active", active);
  });
  document.querySelectorAll("[data-rule-panel]").forEach((panel) => {
    panel.classList.toggle("hidden", panel.getAttribute("data-rule-panel") !== tabId);
  });
}

function hardRulesPanelMarkup() {
  return `
    <section data-rule-panel="hard">
      <section class="rule-layout rule-layout--single">
        <article class="form-card">
          <div class="section-head">
            <h3>Zorunlu Kural Oluştur</h3>
            <p>Burada tanımlanan kurallar tüm eşleştirmelerde geçerli olur.</p>
          </div>
          <form id="portalRuleCreateForm" class="stack-form">
            <label><span>Öncelik</span><input name="priority" type="number" value="100" required></label>
            <label><span>Açıklama</span><input name="description" placeholder="0-8 kalınlıkta ALV zorunlu"></label>
            <div class="dual-grid">
              <label>
                <span>Kontrol Edilecek Alan</span>
                <select name="conditionField">
                  <option value="input.dim1">Kalınlık</option>
                  <option value="input.dim2">En</option>
                  <option value="input.dim3">Boy</option>
                  <option value="input.series">Alaşım Serisi</option>
                  <option value="input.product_type">Ürün Tipi</option>
                </select>
              </label>
              <label class="checkbox-line"><input type="checkbox" name="stopOnMatch"> İlk uygun kuralda dur</label>
            </div>
            <div class="triple-grid">
              <label><span>En Az</span><input name="conditionMin" placeholder="0"></label>
              <label><span>En Çok</span><input name="conditionMax" placeholder="8"></label>
              <label><span>Tam Eşit</span><input name="conditionEquals" placeholder="7075"></label>
            </div>
            <div class="dual-grid">
              <label>
                <span>Uygulanacak Kural</span>
                <select name="effectType">
                  <option value="require_prefix">Stok kodu şu önek ile başlamalı</option>
                  <option value="reject_prefix">Stok kodu şu önek ile başlamamalı</option>
                  <option value="require_exact_series">Alaşım serisi tam eşleşmeli</option>
                  <option value="require_non_null">Seçilen alan boş olmamalı</option>
                  <option value="reject_if_missing_dimension">Ölçü bilgisi eksikse ele</option>
                </select>
              </label>
              <label><span>Kural Değeri</span><input name="effectValue" placeholder="ALV"></label>
            </div>
            <label>
              <span>Hedef Alan</span>
              <select name="effectField">
                <option value="">Alan seçin</option>
                <option value="candidate.stock_code">Stok Kodu</option>
                <option value="candidate.stock_name">Stok Adı</option>
                <option value="candidate.dim1">Kalınlık</option>
                <option value="candidate.dim2">En</option>
                <option value="candidate.dim3">Boy</option>
              </select>
            </label>
            <button type="submit" class="btn-primary">Zorunlu Kuralı Kaydet</button>
            <p id="portalRuleCreateStatus" class="form-status"></p>
          </form>
        </article>

      </section>

      <section>
        <div class="section-head section-head--row">
          <div>
            <h3>Zorunlu Kural Listesi</h3>
            <p>Sistemde kayıtlı ve eşleşmeyi kesin olarak etkileyen kurallar.</p>
          </div>
          <button id="portalRuleRefreshBtn" type="button" class="btn-secondary">Listeyi Yenile</button>
        </div>
        <div id="portalRulesTableHost">Yükleniyor...</div>
      </section>
    </section>
  `;
}

function softPreferencesPanelMarkup() {
  return `
    <section data-rule-panel="soft" class="hidden">
      <section class="rule-layout">
        <article class="form-card">
          <div class="section-head">
            <h3>Tercih Talimatı Önizleme</h3>
            <p>Yazdığınız talimatın eşleşmeye nasıl yön vereceğini önceden görün.</p>
          </div>
          <form id="policyPreviewForm" class="stack-form">
            <div class="dual-grid">
              <label>
                <span>Kaynak Tipi</span>
                <select name="sourceMode">
                  <option value="text">text</option>
                  <option value="excel">excel</option>
                  <option value="image">image</option>
                </select>
              </label>
              <label>
                <span>Satır Sayısı</span>
                <input name="rowCount" type="number" value="1" min="0">
              </label>
            </div>
            <label>
              <span>Talimat</span>
              <textarea name="message" rows="6" placeholder="APL ile başlayan stokları öne al, 7075 serisini tercih et."></textarea>
            </label>
            <button type="submit" class="btn-primary">Önizleme Oluştur</button>
            <p id="policyPreviewStatus" class="form-status"></p>
          </form>
          <div id="policyPreviewHost">${renderPlanPreview(null)}</div>
        </article>

        <article class="form-card">
          <div class="section-head">
            <h3>Bu Alan Ne İşe Yarıyor?</h3>
            <p>Buradaki talimatlar zorunlu eleme yapmaz, sıralamayı ve yorumlamayı etkiler.</p>
          </div>
          <div class="note-block">
            <p>Zorunlu kurallar ekranı adayları kesin olarak eler. Bu ekran ise tercih, yeniden yorumlama ve öğrenilmiş yönlendirme davranışını gösterir.</p>
            <p>Önizleme alanı sistemin talimatı nasıl anladığını gösterir. Alttaki liste ise daha önce öğrenilmiş tercih politikalarını gösterir.</p>
          </div>
        </article>
      </section>

      <section>
        <div class="section-head section-head--row">
          <div>
            <h3>Kayıtlı Tercih Politikaları</h3>
            <p>Geçmiş kullanımdan öğrenilmiş ve gerektiğinde açılıp kapatılabilen talimat kuralları.</p>
          </div>
          <button id="policyRefreshBtn" type="button" class="btn-secondary">Listeyi Yenile</button>
        </div>
        <div id="policyTableHost">Yükleniyor...</div>
      </section>
    </section>
  `;
}

function auditPanelMarkup() {
  return `
    <section data-rule-panel="audit" class="hidden">
      <section class="rule-layout">
        <article>
          <div class="section-head section-head--row">
            <div>
              <h3>Son Kural Kayıtları</h3>
              <p>Kural geçmişi tutulan son eşleşmeler burada listelenir.</p>
            </div>
            <button id="auditRefreshBtn" type="button" class="btn-secondary">Listeyi Yenile</button>
          </div>
          <div id="recentAuditTableHost">Yükleniyor...</div>
        </article>
        <article>
          <div class="section-head">
            <h3>Kural Geçmişi Detayı</h3>
            <p>Seçilen eşleşme için hangi kuralın nasıl çalıştığını burada görebilirsiniz.</p>
          </div>
          <div id="auditDetailHost">${renderAuditDetail(null)}</div>
        </article>
      </section>
    </section>
  `;
}

function parseJsonInput(rawValue, fieldName) {
  const value = String(rawValue ?? "").trim();
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch (_error) {
    throw new Error(`${fieldName} alanı geçerli JSON olmalı.`);
  }
}

function renderSidebar(user) {
  const allowed = routes.filter((route) => route.roles.includes(user.role));
  const route = currentRoute(user.role);
  sidebarNavEl.innerHTML = [
    ...allowed.map((item) => navLink(item, item.path === route.path)),
    `<a class="nav-link" href="/ui/" onclick="window.open('/ui/', '_blank', 'noopener'); return false;"><span>Eşleme Konsolu</span></a>`
  ].join("");
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
    { label: "Çar", value: 3 },
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
    <tr data-offer-id="${item.id}" data-offer-status="${item.status || ""}">
      <td>${item.id}</td>
      <td>${item.title}</td>
      <td>${item.sourceName || "-"}</td>
      <td>${item.sourceType || "-"}</td>
      <td>${item.profileName || "-"}</td>
      <td>${item.lineCount}</td>
      <td>${item.createdBy || "-"}</td>
      <td><span class="status-badge ${item.sentToErp ? "status-badge--sent" : "status-badge--draft"}">${item.sentToErp ? "ERP'ye Gönderildi" : "Bekliyor"}</span></td>
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
            <th>ERP</th>
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
      const offerStatus = String(row.getAttribute("data-offer-status") || "").trim().toLowerCase();
      const readonlyParam = offerStatus === "sent" ? "&readonly=1" : "";
      window.open(`/ui/?recordId=${offerId}${readonlyParam}`, "_blank", "noopener");
    });
  });
}

function renderRulesTable(items) {
  if (!items.length) {
    return `<div class="empty-box">Henüz tanımlı kural yok.</div>`;
  }

  const rows = items.map((item) => `
    <tr>
      <td>${escapeHtml(item.rule_set_name || "default")}</td>
      <td>${item.priority}</td>
      <td>${escapeHtml(item.description || "-")}</td>
      <td>${escapeHtml(item.rule_type || "hard_constraint")}</td>
      <td><pre class="inline-pre">${escapeHtml(prettyJson(item.condition_json))}</pre></td>
      <td><pre class="inline-pre">${escapeHtml(prettyJson(item.effect_json))}</pre></td>
      <td><span class="status-badge ${item.is_active ? "status-badge--sent" : "status-badge--draft"}">${item.is_active ? "Aktif" : "Pasif"}</span></td>
      <td>
        <button
          type="button"
          class="btn-secondary btn-small"
          data-rule-toggle="${item.id}"
          data-next-active="${item.is_active ? "0" : "1"}"
        >${item.is_active ? "Pasifleştir" : "Aktifleştir"}</button>
      </td>
    </tr>
  `).join("");

  return `
    <div class="table-card">
      <table class="portal-table">
        <thead>
          <tr>
            <th>Set</th>
            <th>Öncelik</th>
            <th>Açıklama</th>
            <th>Tip</th>
            <th>Koşul</th>
            <th>Etki</th>
            <th>Durum</th>
            <th>İşlem</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderRuleTestResult(data) {
  if (!data) {
    return `<div class="empty-box">Henüz test çalıştırılmadı.</div>`;
  }

  const keptCount = Array.isArray(data.keptCandidateIds) ? data.keptCandidateIds.length : 0;
  return `
    <div class="table-card">
      <div class="rule-result-head">
        <strong>Kalan aday sayısı: ${keptCount}</strong>
      </div>
      <pre class="json-block">${escapeHtml(prettyJson(data))}</pre>
    </div>
  `;
}

async function renderMatchingRules() {
  pageEyebrowEl.textContent = "Yönetim";
  pageTitleEl.textContent = "Kural Yönetimi";
  pageContentEl.innerHTML = `
    <section class="rule-page">
      <section class="rule-layout">
        <article class="form-card">
          <div class="section-head">
            <h3>Yeni Kural</h3>
            <p>Koşul ve etki alanları JSON formatında girilir.</p>
          </div>
          <form id="portalRuleCreateForm" class="stack-form">
            <label><span>Kural Seti</span><input name="ruleSetName" value="default" required></label>
            <label><span>Öncelik</span><input name="priority" type="number" value="100" required></label>
            <label><span>Açıklama</span><input name="description" placeholder="0-8 kalınlıkta ALV zorunlu"></label>
            <label>
              <span>Tip</span>
              <select name="ruleType">
                <option value="hard_constraint">hard_constraint</option>
              </select>
            </label>
            <label>
              <span>Koşul JSON</span>
              <textarea name="conditionJson" rows="8">{
  "all": [
    { "field": "input.dim1", "operator": "gte", "value": 0 },
    { "field": "input.dim1", "operator": "lte", "value": 8 }
  ]
}</textarea>
            </label>
            <label>
              <span>Etki JSON</span>
              <textarea name="effectJson" rows="6">{
  "type": "require_prefix",
  "value": "ALV"
}</textarea>
            </label>
            <button type="submit" class="btn-primary">Kural Oluştur</button>
            <p id="portalRuleCreateStatus" class="form-status"></p>
          </form>
        </article>

        <article class="form-card">
          <div class="section-head">
            <h3>Kural Testi</h3>
            <p>Giriş metni ve aday stok ID listesiyle hard rule davranışını kontrol et.</p>
          </div>
          <form id="portalRuleTestForm" class="stack-form">
            <label>
              <span>Giriş Metni</span>
              <textarea name="inputText" rows="6" placeholder="AL LEVHA 1050 H14 1x1000x2000"></textarea>
            </label>
            <label>
              <span>Aday Stok ID</span>
              <textarea name="candidateIds" rows="4" placeholder="1,2,3"></textarea>
            </label>
            <button type="submit" class="btn-secondary">Test Çalıştır</button>
            <p id="portalRuleTestStatus" class="form-status"></p>
          </form>
          <div id="portalRuleTestResult">${renderRuleTestResult(null)}</div>
        </article>
      </section>

      <section>
        <div class="section-head section-head--row">
          <div>
            <h3>Aktif Kurallar</h3>
            <p>Sistemde tanımlı hard rule kayıtları burada listelenir.</p>
          </div>
          <button id="portalRuleRefreshBtn" type="button" class="btn-secondary">Listeyi Yenile</button>
        </div>
        <div id="portalRulesTableHost">Yükleniyor...</div>
      </section>
    </section>
  `;

  const tableHost = document.getElementById("portalRulesTableHost");
  const createStatusEl = document.getElementById("portalRuleCreateStatus");
  const testStatusEl = document.getElementById("portalRuleTestStatus");
  const testResultEl = document.getElementById("portalRuleTestResult");

  const loadRules = async () => {
    const data = await api("/matching-rules");
    tableHost.innerHTML = renderRulesTable(data.items || []);
  };

  await loadRules();

  document.getElementById("portalRuleRefreshBtn")?.addEventListener("click", async () => {
    await loadRules();
  });

  tableHost.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const ruleId = target.getAttribute("data-rule-toggle");
    if (!ruleId) return;
    const nextActive = target.getAttribute("data-next-active") === "1";
    target.setAttribute("disabled", "disabled");
    try {
      await api(`/matching-rules/${ruleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: nextActive })
      });
      await loadRules();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Kural güncellenemedi.");
    } finally {
      target.removeAttribute("disabled");
    }
  });

  document.getElementById("portalRuleCreateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    createStatusEl.textContent = "";
    const form = new FormData(event.currentTarget);
    try {
      const conditionJson = parseJsonInput(form.get("conditionJson"), "Koşul JSON");
      const effectJson = parseJsonInput(form.get("effectJson"), "Etki JSON");
      await api("/matching-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rule_set_name: form.get("ruleSetName"),
          priority: Number(form.get("priority")),
          description: form.get("description"),
          rule_type: form.get("ruleType"),
          condition_json: conditionJson,
          effect_json: effectJson
        })
      });
      createStatusEl.textContent = "Kural oluşturuldu.";
      await loadRules();
    } catch (error) {
      createStatusEl.textContent = error instanceof Error ? error.message : "Kural oluşturulamadı.";
    }
  });

  document.getElementById("portalRuleTestForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    testStatusEl.textContent = "";
    const form = new FormData(event.currentTarget);
    const inputText = String(form.get("inputText") ?? "").trim();
    const candidateStockIds = String(form.get("candidateIds") ?? "")
      .split(/[\s,;]+/)
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value > 0);

    try {
      const result = await api("/matching-rules/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputText, candidateStockIds })
      });
      testResultEl.innerHTML = renderRuleTestResult(result);
      testStatusEl.textContent = "Test tamamlandı.";
    } catch (error) {
      testStatusEl.textContent = error instanceof Error ? error.message : "Test çalıştırılamadı.";
    }
  });
}

function renderRulesTableV2(items) {
  if (!items.length) {
    return `<div class="empty-box">Henüz tanımlı kural yok.</div>`;
  }

  const rows = items.map((item) => `
    <tr>
      <td>${escapeHtml(item.rule_set_name || "default")}</td>
      <td>${item.priority}</td>
      <td>${escapeHtml(item.description || "-")}</td>
      <td>${escapeHtml(item.rule_type || "hard_filter")}</td>
      <td>${escapeHtml(summarizeRuleCondition(item.condition_json))}</td>
      <td>${escapeHtml(summarizeRuleEffect(item.effect_json))}</td>
      <td><span class="status-badge ${item.active ? "status-badge--sent" : "status-badge--draft"}">${item.active ? "Aktif" : "Pasif"}</span></td>
      <td><button type="button" class="btn-secondary btn-small" data-rule-toggle="${item.id}" data-next-active="${item.active ? "0" : "1"}">${item.active ? "Pasifleştir" : "Aktifleştir"}</button></td>
    </tr>
  `).join("");

  return `
    <div class="table-card">
      <table class="portal-table">
        <thead>
          <tr>
            <th>Set</th>
            <th>Öncelik</th>
            <th>Açıklama</th>
            <th>Tip</th>
            <th>Koşul</th>
            <th>Etki</th>
            <th>Durum</th>
            <th>İşlem</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderRuleTestResultV2(data) {
  if (!data) {
    return `<div class="empty-box">Henüz test çalıştırılmadı.</div>`;
  }

  const removedCount = Math.max(0, Number(data.beforeCount || 0) - Number(data.afterCount || 0));
  const items = Array.isArray(data.items) ? data.items : [];
  const audits = Array.isArray(data.audits) ? data.audits : [];

  return `
    <section class="mini-stat-grid">
      <article class="mini-stat-card"><span>Başlangıçtaki Aday Sayısı</span><strong>${Number(data.beforeCount || 0)}</strong></article>
      <article class="mini-stat-card"><span>Kalan Aday Sayısı</span><strong>${Number(data.afterCount || 0)}</strong></article>
      <article class="mini-stat-card"><span>Elenen Aday Sayısı</span><strong>${removedCount}</strong></article>
    </section>
    <section class="stack-section">
      <div class="section-head"><h3>Kalan Adaylar</h3><p>Hard rule sonrası filtrelenmiş liste.</p></div>
      ${items.length === 0 ? `<div class="empty-box">Hiç aday kalmadı.</div>` : `<section class="result-card-grid">${items.map((item) => `
        <article class="result-card">
          <div class="result-card-head">
            <strong>${escapeHtml(item.stock_code || "-")}</strong>
            ${badge(`ID ${item.stock_id}`, "blue")}
          </div>
          <p>${escapeHtml(item.stock_name || "-")}</p>
          <div class="chip-row">${(item.rule_hits || []).map((hit) => badge(hit, "green")).join("") || badge("Rule hit yok", "neutral")}</div>
        </article>
      `).join("")}</section>`}
    </section>
    <section class="stack-section">
      <div class="section-head"><h3>Kural Kararları</h3><p>Kural motorunun her aday için verdiği kararlar.</p></div>
      ${audits.length === 0 ? `<div class="empty-box">Kural kararı kaydı oluşmadı.</div>` : `<section class="result-card-grid">${audits.map((item) => `
        <article class="result-card">
          <div class="result-card-head">
            <strong>Kural ${item.ruleId}</strong>
            ${badge(item.decision || "-", item.decision === "kept" ? "green" : "orange")}
          </div>
          <p>${escapeHtml(item.reasonText || "-")}</p>
          <div class="chip-row">
            ${item.candidateStockId ? badge(`Aday ${item.candidateStockId}`, "blue") : ""}
            ${item.deltaScore ? badge(`Skor ${item.deltaScore}`, "neutral") : ""}
          </div>
        </article>
      `).join("")}</section>`}
    </section>
  `;
}

async function renderMatchingRulesV2() {
  pageEyebrowEl.textContent = "Yönetim";
  pageTitleEl.textContent = "Kural Yönetimi";
  pageContentEl.innerHTML = `
    <section class="rule-page">
      <div class="tab-strip">
        <button type="button" class="tab-btn is-active" data-rule-tab="hard">Zorunlu Kurallar</button>
        <button type="button" class="tab-btn" data-rule-tab="soft">Tercih Talimatları</button>
      </div>
      ${hardRulesPanelMarkup()}
      ${softPreferencesPanelMarkup()}
    </section>
  `;

  const rulesTableHost = document.getElementById("portalRulesTableHost");
  const ruleCreateStatusEl = document.getElementById("portalRuleCreateStatus");
  const policyTableHost = document.getElementById("policyTableHost");
  const policyPreviewStatusEl = document.getElementById("policyPreviewStatus");
  const policyPreviewHost = document.getElementById("policyPreviewHost");

  const loadRules = async () => {
    const data = await api("/matching-rules");
    rulesTableHost.innerHTML = renderRulesTableV2(data.items || []);
  };
  const loadPolicies = async () => {
    const data = await api("/instruction-policies");
    policyTableHost.innerHTML = renderInstructionPolicies(data.items || []);
  };

  await Promise.all([loadRules(), loadPolicies()]);

  document.querySelectorAll("[data-rule-tab]").forEach((button) => {
    button.addEventListener("click", () => activateRuleEditorTab(button.getAttribute("data-rule-tab")));
  });
  document.getElementById("portalRuleRefreshBtn")?.addEventListener("click", async () => loadRules());
  document.getElementById("policyRefreshBtn")?.addEventListener("click", async () => loadPolicies());

  rulesTableHost.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const ruleId = target.getAttribute("data-rule-toggle");
    if (!ruleId) return;
    const nextActive = target.getAttribute("data-next-active") === "1";
    target.setAttribute("disabled", "disabled");
    try {
      await api(`/matching-rules/${ruleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: nextActive })
      });
      await loadRules();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Kural güncellenemedi.");
    } finally {
      target.removeAttribute("disabled");
    }
  });

  policyTableHost.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const policyId = target.getAttribute("data-policy-toggle");
    if (!policyId) return;
    const nextActive = target.getAttribute("data-next-active") === "1";
    target.setAttribute("disabled", "disabled");
    try {
      await api(`/instruction-policies/${policyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: nextActive })
      });
      await loadPolicies();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Tercih politikası güncellenemedi.");
    } finally {
      target.removeAttribute("disabled");
    }
  });

  document.getElementById("portalRuleCreateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    ruleCreateStatusEl.textContent = "";
    try {
      const payload = readHardRuleForm(event.currentTarget);
      await api("/matching-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      ruleCreateStatusEl.textContent = "Zorunlu kural kaydedildi.";
      event.currentTarget.reset();
      await loadRules();
    } catch (error) {
      ruleCreateStatusEl.textContent = error instanceof Error ? error.message : "Zorunlu kural kaydedilemedi.";
    }
  });

  document.getElementById("policyPreviewForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    policyPreviewStatusEl.textContent = "";
    const form = new FormData(event.currentTarget);
    try {
      const result = await api("/instructions/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: String(form.get("message") ?? ""),
          rowCount: Number(form.get("rowCount") ?? 0),
          sourceMode: String(form.get("sourceMode") ?? "text")
        })
      });
      policyPreviewHost.innerHTML = renderPlanPreview(result.plan);
      policyPreviewStatusEl.textContent = "Önizleme oluşturuldu.";
    } catch (error) {
      policyPreviewStatusEl.textContent = error instanceof Error ? error.message : "Önizleme oluşturulamadı.";
    }
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
    } else if (route.id === "matching-rules") {
      await renderMatchingRulesV2();
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

