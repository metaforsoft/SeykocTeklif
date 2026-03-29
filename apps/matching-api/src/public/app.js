const el = (id) => document.getElementById(id);

const textWrap = el("textWrap");
const docWrap = el("docWrap");
const dropzoneEl = el("dropzone");
const orderTextEl = el("orderText");
const fileInputEl = el("fileInput");
const fileStatusEl = el("fileStatus");
const topKEl = el("topK");
const analyzeBtnEl = el("analyzeBtn");
const strongAnalyzeBtnEl = el("strongAnalyzeBtn");
const teachBtnEl = el("teachBtn");
const instructionTextEl = el("instructionText");
const matchInstructionTextEl = el("matchInstructionText");
const profileNameEl = el("profileName");
const resultBodyEl = el("resultBody");
const saveStatusEl = el("saveStatus");
const stockModalEl = el("stockModal");
const allStockSearchEl = el("allStockSearch");
const allStockTableBodyEl = el("allStockTableBody");
const closeStockModalBtnEl = el("closeStockModalBtn");
const selectStockBtnEl = el("selectStockBtn");
const analysisModalEl = el("analysisModal");
const analysisModalTitleEl = el("analysisModalTitle");
const analysisModalDetailEl = el("analysisModalDetail");
const instructionDrawerToggleBtnEl = el("instructionDrawerToggleBtn");
const instructionDrawerEl = el("instructionDrawer");
const instructionDrawerOverlayEl = el("instructionDrawerOverlay");
const instructionDrawerCloseBtnEl = el("instructionDrawerCloseBtn");
const instructionChatBodyEl = el("instructionChatBody");
const instructionChatFormEl = el("instructionChatForm");
const instructionChatInputEl = el("instructionChatInput");
const instructionChatSendBtnEl = el("instructionChatSendBtn");
const offerIsyeriKoduEl = el("offerIsyeriKodu");
const offerBelgeTarihiEl = el("offerBelgeTarihi");
const offerCariKoduEl = el("offerCariKodu");
const offerParaBirimiEl = el("offerParaBirimi");
const offerKurTipiEl = el("offerKurTipi");
const offerKurDegeriEl = el("offerKurDegeri");
const offerTeslimOdemeSekliEl = el("offerTeslimOdemeSekli");
const offerNakliyeSekliEl = el("offerNakliyeSekli");
const offerLineBodyEl = el("offerLineBody");
const saveOfferDraftBtnEl = el("saveOfferDraftBtn");
const sendOfferBtnEl = el("sendOfferBtn");

let sourceMode = "text";
let rows = [];
let extractedDoc = null;
let allStocks = [];
let filteredStocks = [];
let modalRowIndex = null;
let modalSelectedStockId = null;
let offerDraftId = null;
let instructionDrawerOpen = false;
let pendingChatLearning = null;

function currentInstruction() {
  return instructionTextEl?.value?.trim() || "";
}

function currentMatchInstruction() {
  return matchInstructionTextEl?.value?.trim() || "";
}

function candidateCount() {
  const value = Number(topKEl?.value || 5);
  return Math.max(1, Math.min(20, value));
}

function setFileStatus(message, hasFile = false) {
  if (!fileStatusEl) return;
  fileStatusEl.textContent = message;
  fileStatusEl.classList.toggle("has-file", hasFile);
}

function setAnalyzeBusy(isBusy) {
  const busy = Boolean(isBusy);
  if (analyzeBtnEl) analyzeBtnEl.disabled = busy;
  if (strongAnalyzeBtnEl) strongAnalyzeBtnEl.disabled = busy;
  if (instructionChatSendBtnEl) instructionChatSendBtnEl.disabled = busy;
}

function setAnalysisModal(open, detailText = "") {
  if (!analysisModalEl) return;
  const isOpen = Boolean(open);
  analysisModalEl.classList.toggle("hidden", !isOpen);
  analysisModalEl.setAttribute("aria-hidden", isOpen ? "false" : "true");
  if (analysisModalTitleEl) {
    analysisModalTitleEl.textContent = isOpen ? "Analiz ediliyor..." : "";
  }
  if (analysisModalDetailEl) {
    analysisModalDetailEl.textContent = isOpen ? (detailText || "Islem devam ediyor...") : "";
  }
  setAnalyzeBusy(isOpen);
}

function setInstructionDrawerOpen(next) {
  instructionDrawerOpen = Boolean(next);
  instructionDrawerEl?.classList.toggle("is-open", instructionDrawerOpen);
  instructionDrawerOverlayEl?.classList.toggle("is-open", instructionDrawerOpen);
  if (instructionDrawerEl) {
    instructionDrawerEl.setAttribute("aria-hidden", instructionDrawerOpen ? "false" : "true");
  }
}

function appendInstructionMessage(role, text) {
  if (!instructionChatBodyEl) return;
  const item = document.createElement("div");
  item.className = `instruction-chat-msg ${role === "user" ? "user" : "assistant"}`;
  const bubble = document.createElement("div");
  bubble.className = "instruction-chat-bubble";
  bubble.textContent = text;
  item.appendChild(bubble);
  instructionChatBodyEl.appendChild(item);
  instructionChatBodyEl.scrollTop = instructionChatBodyEl.scrollHeight;
}

function sanitizeProfileToken(value) {
  return String(value ?? "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

function buildAutoProfileName(message) {
  const sourceToken = sourceMode === "doc" ? "dokuman" : "metin";
  const msgToken = sanitizeProfileToken(message).slice(0, 18) || "chat";
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
  return `chat-${sourceToken}-${msgToken}-${stamp}`;
}

function currentSampleName() {
  return sourceMode === "doc" ? "dokuman-girdisi" : "metin-girdisi";
}

async function ensureChatProfileSavedForLearning(message, doc) {
  if (!doc) return null;
  if (doc.learning?.applied_profile_id) {
    return {
      profileName: doc.learning.applied_profile_name || (profileNameEl?.value?.trim() || ""),
      profileId: Number(doc.learning.applied_profile_id)
    };
  }

  const profileName = buildAutoProfileName(message);
  const sampleName = currentSampleName();
  const result = await api("/profiles/save", "POST", {
    profileName,
    userInstruction: message,
    matchInstruction: message,
    extractedDoc: doc,
    sampleName
  });

  if (!doc.learning) doc.learning = {};
  doc.learning.user_instruction = message;
  doc.learning.effective_instruction = message;
  doc.learning.applied_match_instruction = message;
  doc.learning.applied_profile_id = Number(result.profileId);
  doc.learning.applied_profile_name = profileName;

  if (profileNameEl) profileNameEl.value = profileName;
  return { profileName, profileId: Number(result.profileId) };
}

async function rerunMatchingByInstruction(message) {
  if (instructionTextEl) instructionTextEl.value = message;
  if (matchInstructionTextEl) {
    matchInstructionTextEl.value = message;
  }
  appendInstructionMessage("assistant", "Talimat alindi. Analiz ve eslestirme birlikte yenileniyor...");

  try {
    setAnalysisModal(true, "Talimata gore analiz ve eslestirme yenileniyor...");
    const canReextract = sourceMode === "text"
      ? Boolean(orderTextEl?.value?.trim())
      : Boolean(fileInputEl?.files?.[0]);
    let doc = null;
    if (canReextract) {
      doc = await extractDocumentPayload();
      extractedDoc = doc;
      applyLearnedInstructions(doc);
    } else if (extractedDoc) {
      doc = extractedDoc;
    } else {
      throw new Error("Once metin veya dokuman girin.");
    }
    await runAnalysis(doc, {
      onProgress: ({ current, total }) => {
        setAnalysisModal(true, `${current}/${total} satir talimata gore analiz/eslestirme yapiliyor...`);
      }
    });
    pendingChatLearning = {
      message,
      createdAt: Date.now(),
      sourceMode,
      profileId: extractedDoc?.learning?.applied_profile_id ?? null
    };
    appendInstructionMessage("assistant", `Tamamlandi. ${rows.length} satir talimata gore yenilendi. Bu talimat, Secimleri Kaydet sonrasi ogrenecek.`);
  } catch (err) {
    appendInstructionMessage("assistant", `Islem basarisiz: ${err.message}`);
  } finally {
    setAnalysisModal(false);
  }
}

function setMode(mode) {
  sourceMode = mode;
  extractedDoc = null;
  offerDraftId = null;
  rows = [];
  pendingChatLearning = null;
  renderTable();
  if (mode === "text") {
    textWrap.classList.remove("hidden");
    docWrap.classList.add("hidden");
    fileInputEl.value = "";
    setFileStatus("Henuz dosya secilmedi.");
  } else {
    textWrap.classList.add("hidden");
    docWrap.classList.remove("hidden");
    orderTextEl.value = "";
  }
}

document.querySelectorAll('input[name="sourceMode"]').forEach((radio) => {
  radio.addEventListener("change", (e) => setMode(e.target.value));
});

instructionDrawerToggleBtnEl?.addEventListener("click", () => {
  setInstructionDrawerOpen(true);
  instructionChatInputEl?.focus();
});

instructionDrawerCloseBtnEl?.addEventListener("click", () => {
  setInstructionDrawerOpen(false);
});

instructionDrawerOverlayEl?.addEventListener("click", () => {
  setInstructionDrawerOpen(false);
});

instructionChatFormEl?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = instructionChatInputEl?.value?.trim() || "";
  if (!message) return;
  appendInstructionMessage("user", message);
  if (instructionChatInputEl) instructionChatInputEl.value = "";
  await rerunMatchingByInstruction(message);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && instructionDrawerOpen) {
    setInstructionDrawerOpen(false);
  }
});

async function api(path, method, body) {
  const res = await fetch(path, {
    method,
    headers: method === "GET" ? undefined : { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const txt = await res.text();
  let data = {};
  try {
    data = JSON.parse(txt);
  } catch {
    data = { raw: txt };
  }
  if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
  return data;
}

async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function extractDocumentPayload(options = {}) {
  const userInstruction = currentInstruction();
  if (sourceMode === "text") {
    return await api("/extract-source", "POST", {
      rawText: orderTextEl.value.trim(),
      userInstruction: userInstruction || undefined,
      ...options
    });
  }

  const file = fileInputEl.files?.[0];
  if (!file) throw new Error("Dokuman secin.");
  const contentBase64 = await fileToBase64(file);
  return await api("/extract-source", "POST", {
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    contentBase64,
    userInstruction: userInstruction || undefined,
    ...options
  });
}

function optionLabel(candidate) {
  return `${candidate.stock_code || "-"} - ${candidate.stock_name || "-"}`;
}

function selectedCandidate(row) {
  return row.candidates.find((candidate) => Number(candidate.stock_id) === Number(row.selected_stock_id)) || null;
}

function numericInput(value) {
  return String(value ?? "").replace(/[^\d]/g, "");
}

function decimalInput(value) {
  return String(value ?? "").replace(/[^\d.,-]/g, "");
}

function toDecimalOrNull(value) {
  const raw = String(value ?? "").trim().replace(",", ".");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseDimParts(dimText) {
  const parts = String(dimText ?? "")
    .split("x")
    .map((part) => Number(part.trim().replace(",", ".")))
    .filter((n) => Number.isFinite(n));
  return [
    parts[0] ?? null, // kalinlik/cap
    parts[1] ?? null, // en/et kal
    parts[2] ?? null // boy
  ];
}

function ensureOfferDefaults(row) {
  const [defaultKalinlik, defaultEnEtKal, defaultBoy] = parseDimParts(row.dim_text);
  if (row.offer_tip === undefined) row.offer_tip = "Satis";
  if (row.offer_isyeriDepoKodu === undefined) row.offer_isyeriDepoKodu = "";
  if (row.offer_kalinlikCap === undefined) row.offer_kalinlikCap = defaultKalinlik;
  if (row.offer_enEtKal === undefined) row.offer_enEtKal = defaultEnEtKal;
  if (row.offer_boy === undefined) row.offer_boy = defaultBoy;
  if (row.offer_adet === undefined || row.offer_adet === null) {
    row.offer_adet = Number(row.quantity) || 1;
  }
  if (row.offer_manuelStockAdi === undefined || row.offer_manuelStockAdi === null) {
    row.offer_manuelStockAdi = selectedCandidate(row)?.stock_name || "";
  }
}

function bindOfferLineInputs() {
  offerLineBodyEl.querySelectorAll("[data-k='offer-open-stock-modal']").forEach((button) => {
    button.addEventListener("click", async (e) => {
      await openStockModalForRow(Number(e.currentTarget.dataset.i));
    });
  });

  offerLineBodyEl.querySelectorAll("[data-k='offer-tip']").forEach((input) => {
    input.addEventListener("input", (e) => {
      const index = Number(e.target.dataset.i);
      rows[index].offer_tip = e.target.value;
    });
  });

  offerLineBodyEl.querySelectorAll("[data-k='offer-depo']").forEach((input) => {
    input.addEventListener("input", (e) => {
      const index = Number(e.target.dataset.i);
      rows[index].offer_isyeriDepoKodu = e.target.value;
    });
  });

  offerLineBodyEl.querySelectorAll("[data-k='offer-boy']").forEach((input) => {
    input.addEventListener("input", (e) => {
      const index = Number(e.target.dataset.i);
      e.target.value = decimalInput(e.target.value || "");
      rows[index].offer_boy = toDecimalOrNull(e.target.value);
    });
  });

  offerLineBodyEl.querySelectorAll("[data-k='offer-kalinlik']").forEach((input) => {
    input.addEventListener("input", (e) => {
      const index = Number(e.target.dataset.i);
      e.target.value = decimalInput(e.target.value || "");
      rows[index].offer_kalinlikCap = toDecimalOrNull(e.target.value);
    });
  });

  offerLineBodyEl.querySelectorAll("[data-k='offer-enet']").forEach((input) => {
    input.addEventListener("input", (e) => {
      const index = Number(e.target.dataset.i);
      e.target.value = decimalInput(e.target.value || "");
      rows[index].offer_enEtKal = toDecimalOrNull(e.target.value);
    });
  });

  offerLineBodyEl.querySelectorAll("[data-k='offer-adet']").forEach((input) => {
    input.addEventListener("input", (e) => {
      const index = Number(e.target.dataset.i);
      e.target.value = numericInput(e.target.value || "");
      rows[index].offer_adet = Number(e.target.value || "") || null;
    });
  });

  offerLineBodyEl.querySelectorAll("[data-k='offer-manuel']").forEach((input) => {
    input.addEventListener("input", (e) => {
      const index = Number(e.target.dataset.i);
      rows[index].offer_manuelStockAdi = e.target.value;
    });
  });
}

function renderOfferLines() {
  if (!offerLineBodyEl) return;

  if (rows.length === 0) {
    offerLineBodyEl.innerHTML = '<tr><td colspan="11" class="muted center">Teklif satiri henuz yok.</td></tr>';
    return;
  }

  rows.forEach((row) => ensureOfferDefaults(row));

  offerLineBodyEl.innerHTML = rows.map((row, index) => {
    const selected = selectedCandidate(row);
    return `
      <tr>
        <td>${index + 1}</td>
        <td><input data-k="offer-tip" data-i="${index}" value="${row.offer_tip ?? ""}" /></td>
        <td><input data-k="offer-depo" data-i="${index}" value="${row.offer_isyeriDepoKodu ?? ""}" /></td>
        <td>
          <div class="offer-stock-cell">
            <span>${selected?.stock_code ?? "-"}</span>
            <button type="button" class="btn-secondary mini-btn" data-k="offer-open-stock-modal" data-i="${index}">...</button>
          </div>
        </td>
        <td>${selected?.stock_name ?? "-"}</td>
        <td><input data-k="offer-boy" data-i="${index}" value="${row.offer_boy ?? ""}" /></td>
        <td><input data-k="offer-kalinlik" data-i="${index}" value="${row.offer_kalinlikCap ?? ""}" /></td>
        <td><input data-k="offer-enet" data-i="${index}" value="${row.offer_enEtKal ?? ""}" /></td>
        <td><input data-k="offer-adet" data-i="${index}" value="${row.offer_adet ?? ""}" /></td>
        <td><input data-k="offer-manuel" data-i="${index}" value="${row.offer_manuelStockAdi ?? ""}" /></td>
      </tr>
    `;
  }).join("");

  bindOfferLineInputs();
}

async function ensureAllStocksLoaded() {
  if (allStocks.length > 0) return;
  const res = await api("/stocks", "GET");
  allStocks = Array.isArray(res.items) ? res.items : [];
  filteredStocks = allStocks;
  renderAllStocksTable();
}

function stockSearchText(stock) {
  return [
    stock.stock_code,
    stock.stock_name,
    stock.stock_name2,
    stock.description,
    stock.category1,
    stock.product_type,
    stock.series,
    stock.temper,
    stock.dim_text
  ].filter(Boolean).join(" ").toLocaleLowerCase("tr-TR");
}

function renderAllStocksTable() {
  if (!allStockTableBodyEl) return;

  if (filteredStocks.length === 0) {
    allStockTableBodyEl.innerHTML = '<tr><td colspan="9" class="muted center">Sonuc yok.</td></tr>';
    return;
  }

  allStockTableBodyEl.innerHTML = filteredStocks.slice(0, 600).map((stock) => `
    <tr class="${Number(stock.stock_id) === Number(modalSelectedStockId) ? "selected-row" : ""}" data-k="stock-row" data-stock-id="${stock.stock_id}">
      <td>${stock.stock_code ?? "-"}</td>
      <td>${stock.stock_name ?? "-"}</td>
      <td>${stock.stock_name2 ?? "-"}</td>
      <td>${stock.series ?? "-"}</td>
      <td>${stock.temper ?? "-"}</td>
      <td>${stock.dim_text ?? "-"}</td>
      <td>${stock.product_type ?? "-"}</td>
      <td>${stock.category1 ?? "-"}</td>
      <td>${stock.description ?? "-"}</td>
    </tr>
  `).join("");

  allStockTableBodyEl.querySelectorAll("[data-k='stock-row']").forEach((rowEl) => {
    rowEl.addEventListener("click", () => {
      modalSelectedStockId = Number(rowEl.dataset.stockId);
      renderAllStocksTable();
    });
    rowEl.addEventListener("dblclick", () => {
      modalSelectedStockId = Number(rowEl.dataset.stockId);
      applyModalSelection();
    });
  });
}

function filterAllStocks() {
  const query = (allStockSearchEl?.value ?? "").trim().toLocaleLowerCase("tr-TR");
  filteredStocks = !query
    ? allStocks
    : allStocks.filter((stock) => stockSearchText(stock).includes(query));
  renderAllStocksTable();
}

async function openStockModalForRow(rowIndex) {
  modalRowIndex = Number(rowIndex);
  await ensureAllStocksLoaded();
  modalSelectedStockId = rows[modalRowIndex]?.selected_stock_id ? Number(rows[modalRowIndex].selected_stock_id) : null;
  if (allStockSearchEl) allStockSearchEl.value = "";
  filteredStocks = allStocks;
  renderAllStocksTable();
  stockModalEl.classList.remove("hidden");
}

function bindCandidateControls() {
  resultBodyEl.querySelectorAll("[data-k='candidate-select']").forEach((select) => {
    select.addEventListener("change", (e) => {
      const index = Number(e.target.dataset.i);
      const stockId = Number(e.target.value);
      const hit = rows[index].candidates.find((candidate) => Number(candidate.stock_id) === stockId);
      if (!hit) return;
      rows[index].selected_stock_id = hit.stock_id;
      rows[index].selected_score = hit.score;
      if (!rows[index].offer_manuelStockAdi) {
        rows[index].offer_manuelStockAdi = hit.stock_name || "";
      }
      renderTable();
    });
  });

  resultBodyEl.querySelectorAll("[data-k='open-stock-modal']").forEach((button) => {
    button.addEventListener("click", async (e) => {
      await openStockModalForRow(Number(e.currentTarget.dataset.i));
    });
  });
}

function bindRowInputs() {
  resultBodyEl.querySelectorAll("[data-k='qty']").forEach((input) => {
    input.addEventListener("input", (e) => {
      const index = Number(e.target.dataset.i);
      rows[index].quantity = Number(numericInput(e.target.value || "")) || null;
      rows[index].offer_adet = rows[index].quantity || rows[index].offer_adet || null;
      e.target.value = numericInput(e.target.value || "");
    });
  });
}

function renderTable() {
  if (rows.length === 0) {
    resultBodyEl.innerHTML = '<tr><td colspan="5" class="muted center">Sonuc yok.</td></tr>';
    renderOfferLines();
    return;
  }

  resultBodyEl.innerHTML = rows.map((row, index) => {
    return `
      <tr>
        <td>${index + 1}</td>
        <td><div>${row.dim_text || "-"}</div></td>
        <td class="stock-cell">
          <div class="stock-picker">
            <select data-k="candidate-select" data-i="${index}">
              ${row.candidates.slice(0, candidateCount()).map((candidate) => `
                <option value="${candidate.stock_id}" ${Number(candidate.stock_id) === Number(row.selected_stock_id) ? "selected" : ""}>
                  ${optionLabel(candidate)}
                </option>
              `).join("")}
            </select>
            <button type="button" class="btn-secondary mini-btn" data-k="open-stock-modal" data-i="${index}">...</button>
          </div>
        </td>
        <td>
          <input
            data-k="qty"
            data-i="${index}"
            class="qty-input"
            inputmode="numeric"
            pattern="[0-9]*"
            value="${numericInput(row.quantity)}"
            placeholder="Miktar"
          />
        </td>
        <td class="score">${row.selected_score ?? "-"}</td>
      </tr>
    `;
  }).join("");

  bindCandidateControls();
  bindRowInputs();
  renderOfferLines();
}

async function runAnalysis(doc, options = {}) {
  if (!doc) throw new Error("Kaynak cozumlenemedi.");
  if (!Array.isArray(doc.items) || doc.items.length === 0) {
    throw new Error("Olcu iceren siparis satiri bulunamadi.");
  }

  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  rows = [];
  offerDraftId = null;
  for (let index = 0; index < doc.items.length; index += 1) {
    const item = doc.items[index];
    onProgress?.({
      stage: "matching",
      current: index + 1,
      total: doc.items.length,
      item
    });
    const filters = item.series ? { series: item.series } : undefined;
    const res = await api("/match", "POST", {
      text: item.query,
      topK: candidateCount(),
      matchInstruction: currentMatchInstruction() || undefined,
      filters
    });
    const candidates = res.results || [];
    rows.push({
      matchHistoryId: Number(res.matchHistoryId),
      candidates,
      selected_stock_id: candidates[0]?.stock_id ?? null,
      selected_score: candidates[0]?.score ?? null,
      dim_text: item.dim_text,
      quantity: item.qty,
      series: item.series,
      header_context: item.header_context,
      user_note: item.qty ? `adet:${item.qty}` : ""
    });
  }

  renderTable();
  const learnedFrom = doc.learning?.applied_profile_name ? ` | Profil: ${doc.learning.applied_profile_name}` : "";
  saveStatusEl.textContent = `${rows.length} satir analiz edildi. Kaynak: ${doc.source_type} | Yontem: ${doc.extraction_method || "-"}${learnedFrom}`;
}

function applyLearnedInstructions(doc) {
  if (!doc?.learning) return;
  if (doc.learning.effective_instruction && instructionTextEl && !currentInstruction()) {
    instructionTextEl.value = doc.learning.effective_instruction;
  }
  if (doc.learning.applied_match_instruction && matchInstructionTextEl && !currentMatchInstruction()) {
    matchInstructionTextEl.value = doc.learning.applied_match_instruction;
  }
}

async function handleSelectedFile(file) {
  if (!file) return;
  try {
    pendingChatLearning = null;
    setFileStatus(file.name, true);
    extractedDoc = await extractDocumentPayload();
    applyLearnedInstructions(extractedDoc);
    setFileStatus(file.name, true);
  } catch (err) {
    extractedDoc = null;
    setFileStatus(file.name, true);
    saveStatusEl.textContent = `Dosya cozumleme hatasi: ${err.message}`;
  }
}

fileInputEl?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  await handleSelectedFile(file);
});

dropzoneEl?.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzoneEl.classList.add("is-dragover");
});

dropzoneEl?.addEventListener("dragleave", () => {
  dropzoneEl.classList.remove("is-dragover");
});

dropzoneEl?.addEventListener("drop", async (event) => {
  event.preventDefault();
  dropzoneEl.classList.remove("is-dragover");
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  fileInputEl.files = dataTransfer.files;
  await handleSelectedFile(file);
});

analyzeBtnEl?.addEventListener("click", async () => {
  try {
    setAnalysisModal(true, "Dokuman okunuyor...");
    const doc = await extractDocumentPayload();
    extractedDoc = doc;
    applyLearnedInstructions(doc);
    setAnalysisModal(true, `${doc.items?.length || 0} satir eslestirme kuyruguna alindi...`);
    await runAnalysis(doc, {
      onProgress: ({ current, total }) => {
        setAnalysisModal(true, `${current}/${total} satir eslestiriliyor...`);
      }
    });
  } catch (err) {
    alert(err.message);
  } finally {
    setAnalysisModal(false);
  }
});

strongAnalyzeBtnEl?.addEventListener("click", async () => {
  try {
    setAnalysisModal(true, "Guclu AI ile dokuman okunuyor...");
    const doc = await extractDocumentPayload({ forceAiFallback: true });
    extractedDoc = doc;
    applyLearnedInstructions(doc);
    if (fileInputEl.files?.[0]) {
      setFileStatus(fileInputEl.files[0].name, true);
    }
    const llmImageError = doc?.debug?.llm_image_error || "";
    const llmTextError = doc?.debug?.llm_text_error || "";
    if (String(llmImageError).includes("OPENAI_API_KEY missing") || String(llmTextError).includes("OPENAI_API_KEY missing")) {
      saveStatusEl.textContent = "AI Analiz secildi ancak OPENAI_API_KEY tanimli degil. Sistem OCR + parser ile devam etti.";
    }
    setAnalysisModal(true, `${doc.items?.length || 0} satir eslestirme kuyruguna alindi...`);
    await runAnalysis(doc, {
      onProgress: ({ current, total }) => {
        setAnalysisModal(true, `${current}/${total} satir eslestiriliyor...`);
      }
    });
  } catch (err) {
    alert(err.message);
  } finally {
    setAnalysisModal(false);
  }
});

teachBtnEl?.addEventListener("click", async () => {
  const userInstruction = currentInstruction();
  const profileName = profileNameEl?.value?.trim() || "";

  if (!extractedDoc) {
    alert("Once analiz edilecek metni veya dokumani cozumleyin.");
    return;
  }
  if (!userInstruction) {
    alert("Once analiz talimati girin.");
    return;
  }
  if (!profileName) {
    alert("Profil adi girin.");
    return;
  }

  try {
    const sampleName = currentSampleName();
    const result = await api("/profiles/save", "POST", {
      profileName,
      userInstruction,
      matchInstruction: currentMatchInstruction() || undefined,
      extractedDoc,
      sampleName
    });
    if (extractedDoc.learning) {
      extractedDoc.learning.user_instruction = userInstruction;
      extractedDoc.learning.effective_instruction = userInstruction;
      extractedDoc.learning.applied_match_instruction = currentMatchInstruction() || null;
      extractedDoc.learning.applied_profile_id = Number(result.profileId);
      extractedDoc.learning.applied_profile_name = profileName;
    }
    saveStatusEl.textContent = `Profil kaydedildi. ${profileName} (#${result.profileId}) sonraki benzer dosyalarda otomatik uygulanacak.`;
  } catch (err) {
    alert(err.message);
  }
});

function closeStockModal() {
  stockModalEl.classList.add("hidden");
  modalRowIndex = null;
  modalSelectedStockId = null;
}

closeStockModalBtnEl?.addEventListener("click", closeStockModal);
stockModalEl?.addEventListener("click", (event) => {
  if (event.target.dataset.k === "close-modal") {
    closeStockModal();
  }
});

function applyModalSelection() {
  if (modalRowIndex === null) return;
  const stockId = Number(modalSelectedStockId);
  const stock = allStocks.find((item) => Number(item.stock_id) === stockId);
  if (!stock) return;

  const existing = rows[modalRowIndex].candidates.find((item) => Number(item.stock_id) === stockId);
  if (!existing) {
    rows[modalRowIndex].candidates.unshift({
      stock_id: stock.stock_id,
      stock_code: stock.stock_code,
      stock_name: stock.stock_name,
      score: rows[modalRowIndex].selected_score ?? 0
    });
  }
  rows[modalRowIndex].selected_stock_id = stock.stock_id;
  if (!rows[modalRowIndex].offer_manuelStockAdi) {
    rows[modalRowIndex].offer_manuelStockAdi = stock.stock_name || "";
  }
  renderTable();
  closeStockModal();
}

selectStockBtnEl?.addEventListener("click", applyModalSelection);
allStockSearchEl?.addEventListener("input", filterAllStocks);

el("saveBtn").addEventListener("click", async () => {
  if (rows.length === 0) {
    alert("Once analiz yapin.");
    return;
  }

  const failed = [];
  let success = 0;
  for (const row of rows) {
    if (!row.selected_stock_id) {
      failed.push(`gecmis ${row.matchHistoryId}: secili stok yok`);
      continue;
    }
    try {
      await api("/feedback", "POST", {
        matchHistoryId: row.matchHistoryId,
        selected_stock_id: Number(row.selected_stock_id),
        user_note: row.user_note || (row.quantity ? `adet:${row.quantity}` : null)
      });
      success += 1;
    } catch (err) {
      failed.push(`gecmis ${row.matchHistoryId}: ${err.message}`);
    }
  }

  const total = rows.length;
  if (success > 0 && extractedDoc) {
    try {
      if (pendingChatLearning?.message) {
        const learning = await ensureChatProfileSavedForLearning(pendingChatLearning.message, extractedDoc);
        if (learning?.profileId) {
          pendingChatLearning.profileId = learning.profileId;
        }
      }
      await api("/profiles/confirm", "POST", {
        extractedDoc,
        approved: failed.length === 0
      });
      if (pendingChatLearning?.message) {
        if (failed.length === 0) {
          appendInstructionMessage("assistant", `Talimat ogrenildi ve onaylandi${pendingChatLearning.profileId ? ` (#${pendingChatLearning.profileId})` : ""}.`);
          pendingChatLearning = null;
        } else {
          appendInstructionMessage("assistant", "Kayit kismi tamamlandi. Talimat ogrenmesi tam onay icin yeniden Secimleri Kaydet bekliyor.");
        }
      }
    } catch {
      // Learning kaydi akisi bozmasin.
    }
  }

  if (failed.length === 0) {
    saveStatusEl.textContent = `Kayit basarili. ${success}/${total} satir kaydedildi.`;
  } else {
    const failLines = failed.map((item) => `- ${item}`).join("\n");
    saveStatusEl.textContent = `Kismi kayit tamamlandi. Kaydedilen: ${success}/${total}\nKaydedilemeyenler:\n${failLines}`;
  }
});

function collectOfferPayload() {
  const header = {
    isyeriKodu: offerIsyeriKoduEl?.value?.trim() || "",
    belgeTarihi: offerBelgeTarihiEl?.value?.trim() || "",
    cariKodu: offerCariKoduEl?.value?.trim() || "",
    paraBirimi: offerParaBirimiEl?.value?.trim() || "",
    paraKurTipi: offerKurTipiEl?.value?.trim() || "",
    paraKur: toDecimalOrNull(offerKurDegeriEl?.value),
    teslimOdemeSekli: offerTeslimOdemeSekliEl?.value?.trim() || "",
    nakliyeSekli: offerNakliyeSekliEl?.value?.trim() || ""
  };

  const required = [
    ["isyeriKodu", "Isyeri Kodu"],
    ["belgeTarihi", "Belge Tarihi"],
    ["cariKodu", "Cari Kodu"],
    ["paraBirimi", "Para Birimi"],
    ["teslimOdemeSekli", "Teslim / Odeme Sekli"],
    ["nakliyeSekli", "Nakliye Sekli"]
  ];

  for (const [field, label] of required) {
    if (!String(header[field] ?? "").trim()) {
      throw new Error(`${label} zorunlu.`);
    }
  }

  const lines = rows.map((row, index) => {
    ensureOfferDefaults(row);
    const selected = selectedCandidate(row);
    if (!selected) {
      throw new Error(`Satir ${index + 1}: secili stok yok.`);
    }

    const quantity = Number(row.offer_adet ?? row.quantity ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Satir ${index + 1}: adet pozitif olmali.`);
    }

    return {
      matchHistoryId: Number(row.matchHistoryId),
      selected_stock_id: Number(selected.stock_id),
      quantity,
      tip: row.offer_tip ?? "Satis",
      isyeriDepoKodu: row.offer_isyeriDepoKodu ?? "",
      stockCode: selected.stock_code ?? "",
      stockName: selected.stock_name ?? "",
      boy: row.offer_boy ?? null,
      kalinlikCap: row.offer_kalinlikCap ?? null,
      enEtKal: row.offer_enEtKal ?? null,
      manuelStockAdi: row.offer_manuelStockAdi ?? selected.stock_name ?? "",
      userNote: row.user_note || null
    };
  });

  return {
    draftId: offerDraftId ?? undefined,
    header,
    lines
  };
}

saveOfferDraftBtnEl?.addEventListener("click", async () => {
  if (rows.length === 0) {
    alert("Once analiz yapip satir olusturun.");
    return;
  }

  try {
    const payload = collectOfferPayload();
    const result = await api("/offers/save-draft", "POST", payload);
    offerDraftId = Number(result.draftId);
    saveStatusEl.textContent = `Teklif taslagi kaydedildi. Draft No: ${offerDraftId} | Satir: ${result.lineCount}`;
  } catch (err) {
    alert(err.message);
  }
});

sendOfferBtnEl?.addEventListener("click", async () => {
  if (rows.length === 0) {
    alert("Once analiz yapip satir olusturun.");
    return;
  }

  try {
    const payload = collectOfferPayload();
    const result = await api("/offers/send", "POST", payload);
    if (result.draftId) {
      offerDraftId = Number(result.draftId);
    }
    saveStatusEl.textContent = `Teklif gonderimi tamamlandi. Grup: ${result.offerGroupId} | Toplam: ${result.total} | Gonderilen: ${result.sent} | Kuyrukta: ${result.queued} | Hatali: ${result.failed}`;
  } catch (err) {
    alert(err.message);
  }
});

setInstructionDrawerOpen(false);
appendInstructionMessage("assistant", "Eslestirme talimatinizi yazin. Gonder dediginizde mevcut satirlar talimata gore yeniden eslestirilir.");
const initialMode = document.querySelector('input[name="sourceMode"]:checked')?.value || "text";
setMode(initialMode);
setFileStatus("Henuz dosya secilmedi.");
if (offerBelgeTarihiEl && !offerBelgeTarihiEl.value) {
  offerBelgeTarihiEl.value = new Date().toISOString().slice(0, 10);
}
