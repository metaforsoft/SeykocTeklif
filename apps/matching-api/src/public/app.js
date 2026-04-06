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
const addRowBtnEl = el("addRowBtn");
const exportTableBtnEl = el("exportTableBtn");
const sendMatchedOfferToErpBtnEl = el("sendMatchedOfferToErpBtn");
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
const offerMetaToggleBtnEl = el("offerMetaToggleBtn");
const offerMetaPanelEl = el("offerMetaPanel");
const offerMetaChevronEl = el("offerMetaChevron");
const offerMetaDateEl = el("offerMetaDate");
const offerMetaMovementCodeEl = el("offerMetaMovementCode");
const offerMetaCustomerEl = el("offerMetaCustomer");
const offerMetaRepresentativeEl = el("offerMetaRepresentative");
const offerMetaDescriptionEl = el("offerMetaDescription");

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
let currentMatchedOfferId = null;
let offerMetaOpen = false;
let matchedOfferLocked = false;

const OFFER_META_OPTIONS = {
};

const SOURCE_TYPE_LABELS = {
  text: "Metin",
  doc: "Doküman",
  image: "Görsel",
  file: "Dosya"
};

const EXTRACTION_METHOD_LABELS = {
  llm_image_fallback: "Yapay zeka görsel çözümleme",
  llm_text_fallback: "Yapay zeka metin çözümleme",
  ocr_parser: "OCR + ayrıştırıcı",
  ocr: "OCR",
  parser: "Ayrıştırıcı",
  text: "Metin çözümleme",
  file: "Dosya çözümleme"
};

function formatUiLabel(value, fallback = "-") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  return raw
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase("tr-TR") + part.slice(1))
    .join(" ");
}

function formatSourceType(value) {
  const key = String(value ?? "").trim().toLocaleLowerCase("tr-TR");
  return SOURCE_TYPE_LABELS[key] || formatUiLabel(key);
}

function formatExtractionMethod(value) {
  const key = String(value ?? "").trim().toLocaleLowerCase("tr-TR");
  return EXTRACTION_METHOD_LABELS[key] || formatUiLabel(key);
}

function currentInstruction() {
  return instructionTextEl?.value?.trim() || "";
}

function currentMatchInstruction() {
  return matchInstructionTextEl?.value?.trim() || "";
}

function extractInstructionSet(text, options = {}) {
  const normalized = String(text ?? "").trim().toLocaleLowerCase("tr-TR");
  if (!normalized) return {};

  const set = {};
  const kesimVarIndex = Math.max(normalized.lastIndexOf("kesim var"), normalized.lastIndexOf("kemim var"));
  const kesimYokIndex = Math.max(normalized.lastIndexOf("kesim yok"), normalized.lastIndexOf("kemim yok"));
  if (kesimVarIndex >= 0 || kesimYokIndex >= 0) {
    set.kesimDurumu = kesimYokIndex > kesimVarIndex ? "Kesim Yok" : "Kesim Var";
  }

  const allowImplicitMensei = Boolean(options.allowImplicitMensei);
  const mentionsMensei = normalized.includes("menşei") || normalized.includes("mensei");
  if (mentionsMensei || allowImplicitMensei) {
    if (normalized.includes("yerli")) {
      set.mensei = "YERLİ";
    } else if (normalized.includes("ithal")) {
      set.mensei = "İTHAL";
    }
  }

  const adetMatch = normalized.match(/adet\s*(?:=|:)?\s*(\d+)/i) || normalized.match(/(\d+)\s*adet/i);
  if (adetMatch) {
    const quantity = Number(adetMatch[1]);
    if (Number.isFinite(quantity) && quantity > 0) {
      set.quantity = quantity;
    }
  }

  return set;
}

function isDirectEditCommand(message) {
  const commands = parseInstructionCommands(message);
  return commands.some((command) => command?.set && Object.keys(command.set).length > 0);
}

function parseInstructionCommands(message) {
  const normalized = String(message ?? "").trim().toLocaleLowerCase("tr-TR");
  if (!normalized) return [];

  const commands = [];
  const rowRefPattern = /(\d+)\.\s*sat[ıi]r(?:ı|i|a|e|da|de|daki|deki|icin|için)?/g;
  const rowRefs = [...normalized.matchAll(rowRefPattern)];

  if (rowRefs.length > 0) {
    const segments = [];
    rowRefs.forEach((match, index) => {
      const rowIndex = Number(match[1]) - 1;
      const clauseStart = (match.index ?? 0) + match[0].length;
      const clauseEnd = index + 1 < rowRefs.length ? (rowRefs[index + 1].index ?? normalized.length) : normalized.length;
      const clause = normalized.slice(clauseStart, clauseEnd).trim();
      const set = extractInstructionSet(clause, { allowImplicitMensei: true });
      if (rowIndex >= 0 && Object.keys(set).length > 0) {
        commands.push({
          scope: "row",
          rowIndex,
          rowNumber: rowIndex + 1,
          set
        });
      }
      segments.push([match.index ?? 0, clauseEnd]);
    });

    let remaining = normalized;
    segments
      .sort((a, b) => b[0] - a[0])
      .forEach(([start, end]) => {
        remaining = `${remaining.slice(0, start)} ${remaining.slice(end)}`;
      });

    const globalSet = extractInstructionSet(remaining, {
      allowImplicitMensei: remaining.includes("eşleşen") || remaining.includes("tum") || remaining.includes("tüm") || remaining.includes("bütün") || remaining.includes("hepsi")
    });
    if (Object.keys(globalSet).length > 0) {
      commands.unshift({ scope: "all", set: globalSet });
    }
    return commands;
  }

  const globalSet = extractInstructionSet(normalized, {
    allowImplicitMensei: normalized.includes("eşleşen") || normalized.includes("satırlar") || normalized.includes("satirlarda") || normalized.includes("satırlarda") || normalized.includes("tum") || normalized.includes("tüm") || normalized.includes("bütün") || normalized.includes("hepsi")
  });
  if (Object.keys(globalSet).length > 0) {
    commands.push({ scope: "all", set: globalSet });
  }
  return commands;
}

function validateInstructionCommands(commands) {
  const valid = [];
  const ignored = [];

  commands.forEach((command) => {
    if (!command || !command.set || Object.keys(command.set).length === 0) {
      ignored.push({ reason: "empty" });
      return;
    }
    if (command.scope === "row") {
      if (!Number.isInteger(command.rowIndex) || command.rowIndex < 0 || command.rowIndex >= rows.length) {
        ignored.push({ reason: "row-out-of-range", rowNumber: command.rowNumber });
        return;
      }
    }
    valid.push(command);
  });

  return { valid, ignored };
}

function applyInstructionCommands(commands) {
  const touchedRows = new Set();
  const applied = [];

  const applySetToRow = (row, set, rowIndex) => {
    let changed = false;
    if (set.kesimDurumu && row.kesimDurumu !== set.kesimDurumu) {
      row.kesimDurumu = set.kesimDurumu;
      changed = true;
    }
    if (set.mensei && row.mensei !== set.mensei) {
      row.mensei = set.mensei;
      changed = true;
    }
    if (Number.isFinite(Number(set.quantity)) && Number(set.quantity) > 0) {
      const nextQuantity = Number(set.quantity);
      if (Number(row.quantity) !== nextQuantity) {
        row.quantity = nextQuantity;
        row.offer_adet = nextQuantity;
        changed = true;
      }
    }
    if (changed) {
      touchedRows.add(rowIndex);
    }
    return changed;
  };

  commands.forEach((command) => {
    if (command.scope === "all") {
      let changedCount = 0;
      rows.forEach((row, index) => {
        if (applySetToRow(row, command.set, index)) changedCount += 1;
      });
      applied.push({ ...command, changedCount });
      return;
    }

    const changed = applySetToRow(rows[command.rowIndex], command.set, command.rowIndex);
    applied.push({ ...command, changedCount: changed ? 1 : 0 });
  });

  return { applied, changedRows: touchedRows.size };
}

function describeInstructionCommands(applied, ignored) {
  const notes = [];

  applied.forEach((command) => {
    const parts = [];
    if (command.set.kesimDurumu) parts.push(`Kesim=${command.set.kesimDurumu}`);
    if (command.set.mensei) parts.push(`Menşei=${command.set.mensei}`);
    if (Number.isFinite(Number(command.set.quantity))) parts.push(`Adet=${Number(command.set.quantity)}`);
    if (parts.length === 0) return;

    if (command.scope === "all") {
      notes.push(`tüm satırlarda ${parts.join(", ")}`);
    } else {
      notes.push(`${command.rowNumber}. satırda ${parts.join(", ")}`);
    }
  });

  ignored.forEach((item) => {
    if (item.reason === "row-out-of-range") {
      notes.push(`${item.rowNumber}. satır yok, komut atlandı`);
    }
  });

  return notes;
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

function setAnalysisModal(open, detailText = "", titleText = "Analiz ediliyor...") {
  if (!analysisModalEl) return;
  const isOpen = Boolean(open);
  analysisModalEl.classList.toggle("hidden", !isOpen);
  analysisModalEl.setAttribute("aria-hidden", isOpen ? "false" : "true");
  if (analysisModalTitleEl) {
    analysisModalTitleEl.textContent = isOpen ? titleText : "";
  }
  if (analysisModalDetailEl) {
    analysisModalDetailEl.textContent = isOpen ? (detailText || "İşlem devam ediyor...") : "";
  }
  setAnalyzeBusy(isOpen);
}

function setMatchedOfferLocked(next) {
  matchedOfferLocked = Boolean(next);

  [
    orderTextEl,
    fileInputEl,
    topKEl,
    analyzeBtnEl,
    strongAnalyzeBtnEl,
    addRowBtnEl,
    el("saveBtn"),
    sendMatchedOfferToErpBtnEl,
    offerMetaDateEl,
    offerMetaMovementCodeEl,
    offerMetaCustomerEl,
    offerMetaRepresentativeEl,
    offerMetaDescriptionEl
  ].forEach((control) => {
    if (control) {
      control.disabled = matchedOfferLocked;
    }
  });

  document.querySelectorAll(".lookup-picker input").forEach((input) => {
    input.disabled = matchedOfferLocked;
  });

  resultBodyEl?.querySelectorAll("input, select, button").forEach((control) => {
    control.disabled = matchedOfferLocked;
  });
}

function fillSelectOptions(selectEl, options) {
  if (!selectEl) return;
  const baseOption = selectEl.querySelector('option[value=""]')?.outerHTML || '<option value="">Seçiniz</option>';
  selectEl.innerHTML = [
    baseOption,
    ...options.map((option) => {
      const value = typeof option === "string" ? option : String(option?.value ?? "");
      const label = typeof option === "string" ? option : String(option?.label ?? option?.value ?? "");
      return `<option value="${value}">${label}</option>`;
    })
  ].join("");
}

function selectedOptionLabel(selectEl) {
  return selectEl?.selectedOptions?.[0]?.textContent?.trim() || "";
}

async function fetchLookupOptions(lookupKey, query = "", limit = 30) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("limit", String(limit));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const res = await api(`/lookups/${lookupKey}${suffix}`, "GET");
  return Array.isArray(res.items) ? res.items : [];
}

function setupLookupPicker(selectEl, config) {
  if (!selectEl) return;

  selectEl.style.display = "none";

  const wrapper = document.createElement("div");
  wrapper.className = "lookup-picker";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = config.placeholder;
  input.autocomplete = "off";
  selectEl._lookupInput = input;

  const menu = document.createElement("div");
  menu.className = "lookup-picker-menu hidden";

  selectEl.parentNode.insertBefore(wrapper, selectEl);
  wrapper.appendChild(input);
  wrapper.appendChild(menu);
  wrapper.appendChild(selectEl);

  let debounceId = null;
  let requestId = 0;

  const closeMenu = () => menu.classList.add("hidden");
  const openMenu = () => menu.classList.remove("hidden");

  const renderOptions = (options) => {
    if (!options.length) {
      menu.innerHTML = '<div class="lookup-picker-empty">Sonuc bulunamadi.</div>';
      openMenu();
      return;
    }

    menu.innerHTML = options.map((option, index) => `
      <button type="button" class="lookup-picker-item" data-k="lookup-item" data-i="${index}">
        ${option.label ?? option.value ?? ""}
      </button>
    `).join("");

    menu.querySelectorAll("[data-k='lookup-item']").forEach((button) => {
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const hit = options[Number(button.dataset.i)];
        if (!hit) return;
        fillSelectOptions(selectEl, [hit]);
        selectEl.value = String(hit.value ?? "");
        input.value = String(hit.label ?? hit.value ?? "");
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        closeMenu();
      });
    });

    openMenu();
  };

  const search = async (query) => {
    if (query.trim().length < (config.minChars ?? 0)) {
      closeMenu();
      return;
    }

    const currentRequestId = ++requestId;
    menu.innerHTML = '<div class="lookup-picker-empty">Yukleniyor...</div>';
    openMenu();
    try {
      const options = await fetchLookupOptions(config.lookupKey, query.trim(), config.limit ?? 30);
      if (currentRequestId !== requestId) return;
      renderOptions(options);
    } catch (error) {
      menu.innerHTML = `<div class="lookup-picker-empty">Arama hatasi: ${error.message}</div>`;
      openMenu();
    }
  };

  input.addEventListener("focus", () => {
    void search(input.value.trim());
  });

  input.addEventListener("input", () => {
    fillSelectOptions(selectEl, []);
    if (debounceId) clearTimeout(debounceId);
    debounceId = setTimeout(() => {
      void search(input.value.trim());
    }, 220);
  });

  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      closeMenu();
      if (!selectEl.value) {
        input.value = "";
      }
    }, 120);
  });

  selectEl.addEventListener("change", () => {
    if (selectEl.value) {
      input.value = selectedOptionLabel(selectEl);
    }
  });
}

function setOfferMetaOpen(next) {
  offerMetaOpen = Boolean(next);
  offerMetaPanelEl?.classList.toggle("hidden", !offerMetaOpen);
  offerMetaPanelEl?.setAttribute("aria-hidden", offerMetaOpen ? "false" : "true");
  offerMetaToggleBtnEl?.setAttribute("aria-expanded", offerMetaOpen ? "true" : "false");
  if (offerMetaChevronEl) {
    offerMetaChevronEl.textContent = offerMetaOpen ? "-" : "+";
  }
}

function initializeOfferMetaPanel() {
  setupLookupPicker(offerMetaMovementCodeEl, {
    lookupKey: "movement-codes",
    placeholder: "Kod veya aciklama yazarak ara...",
    minChars: 0,
    limit: 30
  });
  setupLookupPicker(offerMetaCustomerEl, {
    lookupKey: "customers",
    placeholder: "Cari kodu veya unvan yazarak ara...",
    minChars: 2,
    limit: 40
  });
  setupLookupPicker(offerMetaRepresentativeEl, {
    lookupKey: "representatives",
    placeholder: "Temsilci kodu veya adi yazarak ara...",
    minChars: 1,
    limit: 30
  });

  if (offerMetaDateEl && !offerMetaDateEl.value) {
    offerMetaDateEl.value = new Date().toISOString().slice(0, 10);
  }

  offerMetaToggleBtnEl?.addEventListener("click", () => {
    setOfferMetaOpen(!offerMetaOpen);
  });

  setOfferMetaOpen(false);
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

function currentSourceName() {
  const fileName = fileInputEl?.files?.[0]?.name?.trim();
  if (fileName) return fileName;
  const textValue = orderTextEl?.value?.trim() || "";
  if (textValue) {
    const firstLine = textValue.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "Metin girdisi";
    return firstLine.slice(0, 80);
  }
  return sourceMode === "doc" ? "Doküman girdisi" : "Metin girdisi";
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
  const directEdit = isDirectEditCommand(message) && rows.length > 0;
  appendInstructionMessage("assistant", directEdit
    ? "Talimat alındı. Mevcut satırlar üzerinde alan güncellemesi uygulanıyor..."
    : "Talimat alındı. Analiz ve eşleştirme birlikte yenileniyor...");

  try {
    saveStatusEl.textContent = "ERP'ye gönderiliyor...";
    setAnalysisModal(true, "Teklif ERP sistemine gönderiliyor...", "ERP'ye Gönderiliyor...");
    await flushStatusPaint();
    const parsedCommands = parseInstructionCommands(message);
    const { valid: validCommands, ignored: ignoredCommands } = validateInstructionCommands(parsedCommands);
    let instructionResult = { applied: [], changedRows: 0 };

    if (directEdit) {
      instructionResult = applyInstructionCommands(validCommands);
      renderTable();
    } else {
      setAnalysisModal(true, "Talimata göre analiz ve eşleştirme yenileniyor...");
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
        throw new Error("Önce metin veya doküman girin.");
      }
      await runAnalysis(doc, {
        onProgress: ({ current, total }) => {
          setAnalysisModal(true, `${current}/${total} satır talimata göre analiz/eşleştirme yapılıyor...`);
        }
      });
      instructionResult = applyInstructionCommands(validCommands);
      renderTable();
    }
    pendingChatLearning = {
      message,
      createdAt: Date.now(),
      sourceMode,
      profileId: extractedDoc?.learning?.applied_profile_id ?? null
    };
    const notes = describeInstructionCommands(instructionResult.applied, ignoredCommands);
    const overrideNote = notes.length ? ` Uygulanan komutlar: ${notes.join(" | ")}.` : "";
    appendInstructionMessage("assistant", directEdit
      ? `Tamamlandı. ${instructionResult.changedRows} satır güncellendi.${overrideNote} Bu talimat, Seçimleri Kaydet sonrası öğrenilecek.`
      : `Tamamlandı. ${rows.length} satır talimata göre yenilendi.${overrideNote} Bu talimat, Seçimleri Kaydet sonrası öğrenilecek.`);
  } catch (err) {
    appendInstructionMessage("assistant", `İşlem başarısız: ${err.message}`);
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
    setFileStatus("Henüz dosya seçilmedi.");
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

async function downloadFile(path, method, body, fallbackFileName) {
  const res = await fetch(path, {
    method,
    headers: method === "GET" ? undefined : { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const txt = await res.text();
    let data = {};
    try {
      data = JSON.parse(txt);
    } catch {
      data = { raw: txt };
    }
    throw new Error(data.message || data.error || `HTTP ${res.status}`);
  }

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const fileName = match?.[1] || fallbackFileName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
  if (!file) throw new Error("Doküman seçin.");
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
  return `${candidate.stock_code || "-"}`;
}

function selectedCandidate(row) {
  const candidates = Array.isArray(row?.candidates) ? row.candidates : [];
  return candidates.find((candidate) => Number(candidate.stock_id) === Number(row.selected_stock_id)) || null;
}

function createEmptyRow(overrides = {}) {
  return {
    matchHistoryId: null,
    candidates: [],
    selected_stock_id: null,
    selected_score: null,
    dim_text: "",
    dimKalinlik: null,
    dimEn: null,
    dimBoy: null,
    kesimDurumu: "Kesim Var",
    mensei: "İTHAL",
    quantity: 1,
    series: null,
    header_context: null,
    user_note: "manuel_satir",
    isManual: true,
    ...overrides
  };
}

function addManualRow(afterIndex = null) {
  const newRow = createEmptyRow();
  if (Number.isInteger(afterIndex) && afterIndex >= 0 && afterIndex < rows.length) {
    rows.splice(afterIndex + 1, 0, newRow);
  } else {
    rows.push(newRow);
  }
  renderTable();
}

function removeRow(index) {
  if (!Number.isInteger(index) || index < 0 || index >= rows.length) return;
  rows.splice(index, 1);
  renderTable();
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

function displayDim(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : String(value).replace(".", ",");
}

function dimensionInput(value) {
  if (value === null || value === undefined) return "";
  return decimalInput(value);
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
  if (row.mensei === undefined || row.mensei === null || row.mensei === "") {
    row.mensei = "İTHAL";
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
    offerLineBodyEl.innerHTML = '<tr><td colspan="11" class="muted center">Henüz teklif satırı yok.</td></tr>';
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
        <td class="stock-name-cell">${selected?.stock_name ?? "-"}</td>
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
    stock.birim,
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
    allStockTableBodyEl.innerHTML = '<tr><td colspan="13" class="muted center">Sonuç yok.</td></tr>';
    return;
  }

  const formatErpNumber = (value) => {
    if (value === null || value === undefined || value === "") return "-";
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
  };

  allStockTableBodyEl.innerHTML = filteredStocks.slice(0, 600).map((stock) => `
    <tr class="${Number(stock.stock_id) === Number(modalSelectedStockId) ? "selected-row" : ""}" data-k="stock-row" data-stock-id="${stock.stock_id}">
      <td>${stock.stock_code ?? "-"}</td>
      <td>${stock.stock_name ?? "-"}</td>
      <td>${stock.stock_name2 ?? "-"}</td>
      <td>${stock.birim ?? "-"}</td>
      <td>${formatErpNumber(stock.erp_en)}</td>
      <td>${formatErpNumber(stock.erp_boy)}</td>
      <td>${formatErpNumber(stock.erp_yukseklik)}</td>
      <td>${formatErpNumber(stock.erp_cap)}</td>
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
      const hit = (rows[index].candidates || []).find((candidate) => Number(candidate.stock_id) === stockId);
      if (!hit) {
        rows[index].selected_stock_id = null;
        rows[index].selected_score = null;
        renderTable();
        return;
      }
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

  resultBodyEl.querySelectorAll("[data-k='add-row']").forEach((button) => {
    button.addEventListener("click", (e) => {
      addManualRow(Number(e.currentTarget.dataset.i));
    });
  });

  resultBodyEl.querySelectorAll("[data-k='remove-row']").forEach((button) => {
    button.addEventListener("click", (e) => {
      removeRow(Number(e.currentTarget.dataset.i));
    });
  });
}

function bindRowInputs() {
  resultBodyEl.querySelectorAll("[data-k='dim-kalinlik']").forEach((input) => {
    input.addEventListener("input", (e) => {
      const index = Number(e.target.dataset.i);
      e.target.value = decimalInput(e.target.value || "");
      rows[index].dimKalinlik = toDecimalOrNull(e.target.value);
      rows[index].offer_kalinlikCap = rows[index].dimKalinlik;
    });
  });

  resultBodyEl.querySelectorAll("[data-k='dim-en']").forEach((input) => {
    input.addEventListener("input", (e) => {
      const index = Number(e.target.dataset.i);
      e.target.value = decimalInput(e.target.value || "");
      rows[index].dimEn = toDecimalOrNull(e.target.value);
      rows[index].offer_enEtKal = rows[index].dimEn;
    });
  });

  resultBodyEl.querySelectorAll("[data-k='dim-boy']").forEach((input) => {
    input.addEventListener("input", (e) => {
      const index = Number(e.target.dataset.i);
      e.target.value = decimalInput(e.target.value || "");
      rows[index].dimBoy = toDecimalOrNull(e.target.value);
      rows[index].offer_boy = rows[index].dimBoy;
    });
  });

  resultBodyEl.querySelectorAll("[data-k='kesim']").forEach((select) => {
    select.addEventListener("change", (e) => {
      const index = Number(e.target.dataset.i);
      rows[index].kesimDurumu = e.target.value || "Kesim Var";
    });
  });

  resultBodyEl.querySelectorAll("[data-k='mensei']").forEach((select) => {
    select.addEventListener("change", (e) => {
      const index = Number(e.target.dataset.i);
      rows[index].mensei = e.target.value || "İTHAL";
    });
  });

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
    resultBodyEl.innerHTML = '<tr><td colspan="12" class="muted center">Sonuç yok.</td></tr>';
    renderOfferLines();
    return;
  }

  resultBodyEl.innerHTML = rows.map((row, index) => {
    const selected = selectedCandidate(row);
    const candidates = Array.isArray(row.candidates) ? row.candidates : [];
    const [defaultKalinlik, defaultEn, defaultBoy] = parseDimParts(row.dim_text);
    const kalinlik = row.dimKalinlik ?? defaultKalinlik;
    const en = row.dimEn ?? defaultEn;
    const boy = row.dimBoy ?? defaultBoy;
    const kesim = row.kesimDurumu || "Kesim Var";
    const mensei = row.mensei || "İTHAL";
    return `
      <tr>
        <td>${index + 1}</td>
        <td>
          <input data-k="dim-kalinlik" data-i="${index}" class="dim-input" value="${dimensionInput(kalinlik)}" ${matchedOfferLocked ? "disabled" : ""} />
        </td>
        <td>
          <input data-k="dim-en" data-i="${index}" class="dim-input" value="${dimensionInput(en)}" ${matchedOfferLocked ? "disabled" : ""} />
        </td>
        <td>
          <input data-k="dim-boy" data-i="${index}" class="dim-input" value="${dimensionInput(boy)}" ${matchedOfferLocked ? "disabled" : ""} />
        </td>
        <td class="stock-code-cell">
          <select data-k="candidate-select" data-i="${index}" ${(candidates.length === 0 || matchedOfferLocked) ? "disabled" : ""}>
            ${candidates.length === 0 ? '<option value="">Stok seçin</option>' : ""}
            ${candidates.slice(0, candidateCount()).map((candidate) => `
              <option value="${candidate.stock_id}" ${Number(candidate.stock_id) === Number(row.selected_stock_id) ? "selected" : ""}>
                ${optionLabel(candidate)}
              </option>
            `).join("")}
          </select>
        </td>
        <td>${selected?.stock_name ?? "-"}</td>
        <td class="pick-cell">
          <button type="button" class="btn-secondary mini-btn" data-k="open-stock-modal" data-i="${index}" ${matchedOfferLocked ? "disabled" : ""}>...</button>
        </td>
        <td>${selected?.birim ?? "-"}</td>
        <td>
          <select data-k="kesim" data-i="${index}" class="cut-select" ${matchedOfferLocked ? "disabled" : ""}>
            <option value="Kesim Var" ${kesim === "Kesim Var" ? "selected" : ""}>Kesim Var</option>
            <option value="Kesim Yok" ${kesim === "Kesim Yok" ? "selected" : ""}>Kesim Yok</option>
          </select>
        </td>
        <td>
          <select data-k="mensei" data-i="${index}" class="cut-select" ${matchedOfferLocked ? "disabled" : ""}>
            <option value="İTHAL" ${mensei === "İTHAL" ? "selected" : ""}>İTHAL</option>
            <option value="YERLİ" ${mensei === "YERLİ" ? "selected" : ""}>YERLİ</option>
          </select>
        </td>
        <td>
          <input
            data-k="qty"
            data-i="${index}"
            class="qty-input"
            inputmode="numeric"
            pattern="[0-9]*"
            value="${numericInput(row.quantity)}"
            placeholder="Adet"
            ${matchedOfferLocked ? "disabled" : ""}
          />
        </td>
        <td class="row-actions-cell">
          <div class="row-action-stack">
            <button type="button" class="btn-secondary row-action-btn row-action-btn--icon" data-k="add-row" data-i="${index}" title="Altına ekle" aria-label="Altına ekle">+</button>
            <button type="button" class="btn-secondary row-action-btn row-action-btn--icon" data-k="remove-row" data-i="${index}" title="Satırı kaldır" aria-label="Satırı kaldır">×</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  bindCandidateControls();
  bindRowInputs();
  renderOfferLines();
  setMatchedOfferLocked(matchedOfferLocked);
}

async function runAnalysis(doc, options = {}) {
  if (!doc) throw new Error("Kaynak çözümlenemedi.");
  if (!Array.isArray(doc.items) || doc.items.length === 0) {
    throw new Error("Ölçü içeren sipariş satırı bulunamadı.");
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
    const [defaultKalinlik, defaultEn, defaultBoy] = parseDimParts(item.dim_text);
    rows.push({
      matchHistoryId: Number(res.matchHistoryId),
      candidates,
      selected_stock_id: candidates[0]?.stock_id ?? null,
      selected_score: candidates[0]?.score ?? null,
      dim_text: item.dim_text,
      dimKalinlik: defaultKalinlik,
      dimEn: defaultEn,
      dimBoy: defaultBoy,
      kesimDurumu: "Kesim Var",
      quantity: item.qty,
      series: item.series,
      header_context: item.header_context,
      user_note: item.qty ? `adet:${item.qty}` : ""
    });
  }

  renderTable();
  const learnedFrom = doc.learning?.applied_profile_name ? ` | Profil: ${doc.learning.applied_profile_name}` : "";
  saveStatusEl.textContent = `${rows.length} satır analiz edildi. Kaynak: ${formatSourceType(doc.source_type)} | Yöntem: ${formatExtractionMethod(doc.extraction_method)}${learnedFrom}`;
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

function mapRowsForOfferSave() {
  return rows.map((row) => ({
    matchHistoryId: row.matchHistoryId ?? null,
    selected_stock_id: row.selected_stock_id ?? null,
    selected_score: row.selected_score ?? null,
    quantity: row.quantity ?? null,
    dimKalinlik: row.dimKalinlik ?? null,
    dimEn: row.dimEn ?? null,
    dimBoy: row.dimBoy ?? null,
    kesimDurumu: row.kesimDurumu ?? null,
    mensei: row.mensei ?? "İTHAL",
    user_note: row.user_note ?? null,
    header_context: row.header_context ?? null,
    isManual: Boolean(row.isManual)
  }));
}

function collectMatchedTableExportRows() {
  return rows.map((row, index) => {
    ensureOfferDefaults(row);
    const selected = selectedCandidate(row);
    return {
      sira: index + 1,
      kalinlik: row.dimKalinlik ?? null,
      en: row.dimEn ?? null,
      boy: row.dimBoy ?? null,
      stokKodu: selected?.stock_code ?? "",
      stokAdi: selected?.stock_name ?? "",
      birim: selected?.birim ?? "",
      kesimDurumu: row.kesimDurumu ?? "Kesim Var",
      mensei: row.mensei ?? "İTHAL",
      adet: row.quantity ?? null
    };
  });
}

async function saveMatchedOfferRecord() {
  if (rows.length === 0) return null;
  const result = await api("/matched-offers/save", "POST", {
    offerId: currentMatchedOfferId,
    title: currentSourceName(),
    sourceName: currentSourceName(),
    sourceType: extractedDoc?.source_type || (sourceMode === "doc" ? "doc" : "text"),
    extractionMethod: extractedDoc?.extraction_method || null,
    profileName: extractedDoc?.learning?.applied_profile_name || null,
    ...collectMatchedOfferMeta(),
    rows: mapRowsForOfferSave()
  });
  currentMatchedOfferId = Number(result.offerId);
  return currentMatchedOfferId;
}

function collectMatchedOfferMeta() {
  return {
    offerDate: offerMetaDateEl?.value?.trim() || "",
    movementCode: offerMetaMovementCodeEl?.value?.trim() || "",
    customerCode: offerMetaCustomerEl?.value?.trim() || "",
    representativeCode: offerMetaRepresentativeEl?.value?.trim() || "",
    description: offerMetaDescriptionEl?.value?.trim() || ""
  };
}

function applyMatchedOfferMeta(meta = {}) {
  if (offerMetaDateEl) {
    offerMetaDateEl.value = meta.offerDate || new Date().toISOString().slice(0, 10);
  }
  if (offerMetaMovementCodeEl) {
    fillSelectOptions(offerMetaMovementCodeEl, meta.movementCode ? [{ value: meta.movementCode, label: meta.movementCode }] : []);
    offerMetaMovementCodeEl.value = meta.movementCode || "";
    if (offerMetaMovementCodeEl._lookupInput) {
      offerMetaMovementCodeEl._lookupInput.value = meta.movementCode || "";
    }
    offerMetaMovementCodeEl.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (offerMetaCustomerEl) {
    fillSelectOptions(offerMetaCustomerEl, meta.customerCode ? [{ value: meta.customerCode, label: meta.customerCode }] : []);
    offerMetaCustomerEl.value = meta.customerCode || "";
    if (offerMetaCustomerEl._lookupInput) {
      offerMetaCustomerEl._lookupInput.value = meta.customerCode || "";
    }
    offerMetaCustomerEl.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (offerMetaRepresentativeEl) {
    fillSelectOptions(offerMetaRepresentativeEl, meta.representativeCode ? [{ value: meta.representativeCode, label: meta.representativeCode }] : []);
    offerMetaRepresentativeEl.value = meta.representativeCode || "";
    if (offerMetaRepresentativeEl._lookupInput) {
      offerMetaRepresentativeEl._lookupInput.value = meta.representativeCode || "";
    }
    offerMetaRepresentativeEl.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (offerMetaDescriptionEl) {
    offerMetaDescriptionEl.value = meta.description || "";
  }
}

async function flushStatusPaint() {
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function validateMatchedOfferMeta() {
  const meta = collectMatchedOfferMeta();
  if (!meta.movementCode) {
    throw new Error("Hareket Kodu seçilmeli.");
  }
  if (!meta.customerCode) {
    throw new Error("Cari seçilmeli.");
  }
  if (!meta.representativeCode) {
    throw new Error("Müşteri Temsilcisi seçilmeli.");
  }
  return meta;
}

async function loadMatchedOffer(recordId) {
  const data = await api(`/matched-offers/${recordId}`, "GET");
  const offer = data.offer || {};
  currentMatchedOfferId = Number(offer.id);
  const offerStatus = String(offer.status || "").trim().toLowerCase();
  setMatchedOfferLocked(offerStatus === "sent");
  rows = (Array.isArray(data.rows) ? data.rows : []).map((row) => {
    const stockId = Number(row.selected_stock_id) || null;
    const stockCode = row.stock_code || "-";
    const stockName = row.stock_name || "-";
    const birim = row.birim || "-";
    return {
      matchHistoryId: row.matchHistoryId ?? null,
      candidates: stockId ? [{
        stock_id: stockId,
        stock_code: stockCode,
        stock_name: stockName,
        birim,
        score: row.selected_score ?? 0
      }] : [],
      selected_stock_id: stockId,
      selected_score: row.selected_score ?? null,
      dim_text: "",
      dimKalinlik: row.dimKalinlik ?? null,
      dimEn: row.dimEn ?? null,
      dimBoy: row.dimBoy ?? null,
      kesimDurumu: row.kesimDurumu || "Kesim Var",
      mensei: row.mensei || "İTHAL",
      quantity: row.quantity ?? null,
      series: null,
      header_context: null,
      user_note: row.user_note || "",
      isManual: Boolean(row.isManual)
    };
  });
  extractedDoc = {
    source_type: offer.sourceType || "matched_offer",
    extraction_method: offer.extractionMethod || "kayit_yukleme",
    parser_confidence: null,
    items: [],
    learning: {
      fingerprint_text: "",
      fingerprint_json: {},
      applied_profile_name: offer.profileName || null
    }
  };
  applyMatchedOfferMeta(offer);
  renderTable();
  saveStatusEl.textContent = matchedOfferLocked
    ? `Kayıt yüklendi. Teklif #${currentMatchedOfferId} kayıtlı, değiştirme kapalı. | Kaynak: ${offer.sourceName || offer.title || "-"}`
    : `Kayıt yüklendi. Teklif #${currentMatchedOfferId} | Kaynak: ${offer.sourceName || offer.title || "-"}`;
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
    saveStatusEl.textContent = `Dosya çözümleme hatası: ${err.message}`;
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
    setAnalysisModal(true, "Doküman okunuyor...");
    const doc = await extractDocumentPayload();
    extractedDoc = doc;
    applyLearnedInstructions(doc);
    setAnalysisModal(true, `${doc.items?.length || 0} satır eşleştirme kuyruğuna alındı...`);
    await runAnalysis(doc, {
      onProgress: ({ current, total }) => {
        setAnalysisModal(true, `${current}/${total} satır eşleştiriliyor...`);
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
    setAnalysisModal(true, "Güçlü yapay zeka ile doküman okunuyor...");
    const doc = await extractDocumentPayload({ forceAiFallback: true });
    extractedDoc = doc;
    applyLearnedInstructions(doc);
    if (fileInputEl.files?.[0]) {
      setFileStatus(fileInputEl.files[0].name, true);
    }
    const llmImageError = doc?.debug?.llm_image_error || "";
    const llmTextError = doc?.debug?.llm_text_error || "";
    if (String(llmImageError).includes("OPENAI_API_KEY missing") || String(llmTextError).includes("OPENAI_API_KEY missing")) {
      saveStatusEl.textContent = "Yapay zeka analizi seçildi ancak OPENAI_API_KEY tanımlı değil. Sistem OCR + ayrıştırıcı ile devam etti.";
    }
    setAnalysisModal(true, `${doc.items?.length || 0} satır eşleştirme kuyruğuna alındı...`);
    await runAnalysis(doc, {
      onProgress: ({ current, total }) => {
        setAnalysisModal(true, `${current}/${total} satır eşleştiriliyor...`);
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
    alert("Önce analiz edilecek metni veya dokümanı çözümleyin.");
    return;
  }
  if (!userInstruction) {
    alert("Önce analiz talimatı girin.");
    return;
  }
  if (!profileName) {
    alert("Profil adı girin.");
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
  } finally {
    setAnalysisModal(false);
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
      birim: stock.birim ?? null,
      score: rows[modalRowIndex].selected_score ?? 0
    });
  }
  rows[modalRowIndex].selected_stock_id = stock.stock_id;
  rows[modalRowIndex].selected_score = existing?.score ?? rows[modalRowIndex].selected_score ?? 0;
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
    alert("Önce analiz yapın.");
    return;
  }

  try {
    saveStatusEl.textContent = "Kaydediliyor...";
    setAnalysisModal(true, "Eşleştirme ve başlık bilgileri kaydediliyor...", "Kaydediliyor...");
    await flushStatusPaint();

    const failed = [];
    let success = 0;
    const feedbackRows = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => Number.isFinite(Number(row.matchHistoryId)));

    if (feedbackRows.length === 0) {
      const offerId = await saveMatchedOfferRecord();
      saveStatusEl.textContent = `Kaydedildi. Manuel satırlar teklif olarak kaydedildi.${offerId ? ` Teklif kaydı: #${offerId}.` : ""}`;
      return;
    }

    for (const { row, index } of feedbackRows) {
      if (!row.selected_stock_id) {
        failed.push(`satır ${index + 1}: seçili stok yok`);
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
        failed.push(`satır ${index + 1}: ${err.message}`);
      }
    }

    const total = feedbackRows.length;
    const manualCount = rows.length - feedbackRows.length;
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
            appendInstructionMessage("assistant", `Talimat öğrenildi ve onaylandı${pendingChatLearning.profileId ? ` (#${pendingChatLearning.profileId})` : ""}.`);
            pendingChatLearning = null;
          } else {
            appendInstructionMessage("assistant", "Kayıt kısmi tamamlandı. Talimat öğrenmesi tam onay için yeniden Seçimleri Kaydet bekliyor.");
          }
        }
      } catch {
        // Learning kaydi akisi bozmasin.
      }
    }

    if (failed.length === 0) {
      const offerId = await saveMatchedOfferRecord();
      saveStatusEl.textContent = `Kaydedildi. ${success}/${total} satır kaydedildi.${manualCount > 0 ? ` Manuel satır: ${manualCount}.` : ""}${offerId ? ` Teklif kaydı: #${offerId}.` : ""}`;
    } else {
      const failLines = failed.map((item) => `- ${item}`).join("\n");
      saveStatusEl.textContent = `Kısmi kayıt tamamlandı. Kaydedilen: ${success}/${total}${manualCount > 0 ? ` | Manuel satır: ${manualCount}` : ""}\nKaydedilemeyenler:\n${failLines}`;
    }
  } catch (err) {
    alert(err.message);
  } finally {
    setAnalysisModal(false);
  }
});

exportTableBtnEl?.addEventListener("click", async () => {
  if (rows.length === 0) {
    alert("Önce analiz yapın.");
    return;
  }

  try {
    await downloadFile("/exports/matched-table", "POST", {
      rows: collectMatchedTableExportRows()
    }, "eslestirilen-satirlar.xlsx");
    saveStatusEl.textContent = "Eşleştirilen satırlar Excel olarak indirildi.";
  } catch (err) {
    alert(err.message);
  }
});

sendMatchedOfferToErpBtnEl?.addEventListener("click", async () => {
  if (rows.length === 0) {
    alert("Önce analiz yapın.");
    return;
  }

  try {
    saveStatusEl.textContent = "ERP'ye gönderiliyor...";
    setAnalysisModal(true, "Teklif ERP sistemine gönderiliyor...", "ERP'ye Gönderiliyor...");
    await flushStatusPaint();

    if (!Number.isFinite(Number(currentMatchedOfferId)) || Number(currentMatchedOfferId) <= 0) {
      throw new Error("ERP'ye göndermeden önce Seçimleri Kaydet ile eşleşmeyi kaydetmelisiniz.");
    }

    const offerMeta = validateMatchedOfferMeta();
    const offerId = Number(currentMatchedOfferId);
    const result = await api("/matched-offers/send-erp", "POST", {
      offerId,
      ...offerMeta,
      rows: mapRowsForOfferSave()
    });

    saveStatusEl.textContent = `ERP gönderimi tamamlandı. Teklif kaydı: #${offerId}. Uyum mesajı: ${result.uyumResponse?.message ?? "İşlem başarılı"}`;
  } catch (err) {
    alert(err.message);
  } finally {
    setAnalysisModal(false);
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
      throw new Error(`Satır ${index + 1}: seçili stok yok.`);
    }

    const quantity = Number(row.offer_adet ?? row.quantity ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Satır ${index + 1}: adet pozitif olmalı.`);
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
    alert("Önce analiz yapıp satır oluşturun.");
    return;
  }

  try {
    const payload = collectOfferPayload();
    const result = await api("/offers/save-draft", "POST", payload);
    offerDraftId = Number(result.draftId);
    saveStatusEl.textContent = `Teklif taslağı kaydedildi. Draft No: ${offerDraftId} | Satır: ${result.lineCount}`;
  } catch (err) {
    alert(err.message);
  }
});

sendOfferBtnEl?.addEventListener("click", async () => {
  if (rows.length === 0) {
    alert("Önce analiz yapıp satır oluşturun.");
    return;
  }

  try {
    const payload = collectOfferPayload();
    const result = await api("/offers/send", "POST", payload);
    if (result.draftId) {
      offerDraftId = Number(result.draftId);
    }
    saveStatusEl.textContent = `Teklif gönderimi tamamlandı. Grup: ${result.offerGroupId} | Toplam: ${result.total} | Gönderilen: ${result.sent} | Kuyrukta: ${result.queued} | Hatalı: ${result.failed}`;
  } catch (err) {
    alert(err.message);
  }
});

setInstructionDrawerOpen(false);
appendInstructionMessage("assistant", "Eşleştirme talimatınızı yazın. Gönder dediğinizde mevcut satırlar talimata göre yeniden eşleştirilir.");
const initialMode = document.querySelector('input[name="sourceMode"]:checked')?.value || "text";
setMode(initialMode);
setFileStatus("Henüz dosya seçilmedi.");
if (offerBelgeTarihiEl && !offerBelgeTarihiEl.value) {
  offerBelgeTarihiEl.value = new Date().toISOString().slice(0, 10);
}

initializeOfferMetaPanel();
const pageParams = new URLSearchParams(window.location.search);
setMatchedOfferLocked(pageParams.get("readonly") === "1");

const urlRecordId = Number(pageParams.get("recordId"));
if (Number.isFinite(urlRecordId) && urlRecordId > 0) {
  loadMatchedOffer(urlRecordId).catch((err) => {
    saveStatusEl.textContent = `Kayıt yüklenemedi: ${err.message}`;
  });
}

