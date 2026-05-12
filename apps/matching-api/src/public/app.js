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
const offerMetaWarehouseEl = el("offerMetaWarehouse");
const offerMetaPaymentPlanEl = el("offerMetaPaymentPlan");
const offerMetaIncotermEl = el("offerMetaIncoterm");
const offerMetaSpecialCodeEl = el("offerMetaSpecialCode");
const offerMetaDeliveryDateEl = el("offerMetaDeliveryDate");
const offerMetaDescriptionEl = el("offerMetaDescription");
const refreshRulesBtnEl = el("refreshRulesBtn");
const ruleListBodyEl = el("ruleListBody");
const ruleSetNameInputEl = el("ruleSetNameInput");
const rulePriorityInputEl = el("rulePriorityInput");
const ruleDescriptionInputEl = el("ruleDescriptionInput");
const ruleTypeInputEl = el("ruleTypeInput");
const ruleConditionInputEl = el("ruleConditionInput");
const ruleEffectInputEl = el("ruleEffectInput");
const createRuleBtnEl = el("createRuleBtn");
const ruleTestTextInputEl = el("ruleTestTextInput");
const ruleTestCandidateIdsInputEl = el("ruleTestCandidateIdsInput");
const runRuleTestBtnEl = el("runRuleTestBtn");
const ruleTestResultEl = el("ruleTestResult");

let sourceMode = "text";
let rows = [];
let extractedDoc = null;
let cachedSourcePayload = null;
let allStocks = [];
let filteredStocks = [];
let modalRowIndex = null;
let modalSelectedStockId = null;
let offerDraftId = null;
let instructionDrawerOpen = false;
let pendingChatLearning = null;
let activeMatchPolicy = null;
let activeRowDefaults = null;
let currentMatchedOfferId = null;
let offerMetaOpen = false;
let matchedOfferLocked = false;
let matchingRules = [];
let pendingInstructionSuggestion = null;

function mergeMatchPolicy(nextPolicy) {
  if (!nextPolicy) return;
  activeMatchPolicy = { ...nextPolicy };
}

function resetInstructionState() {
  pendingChatLearning = null;
  activeMatchPolicy = null;
  activeRowDefaults = null;
  if (instructionTextEl) instructionTextEl.value = "";
  if (matchInstructionTextEl) matchInstructionTextEl.value = "";
}

function isClearInstructionStateCommand(message) {
  const normalized = String(message || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/ı/g, "i")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .trim();

  return /\b(filtreleri|filtreyi|talimatlari|talimati|komutlari|komutu)\s+temizle\b/i.test(normalized)
    || /\b(eslestirme|eşleştirme)\s+filtresini\s+temizle\b/i.test(normalized)
    || /\bsifirla\b/i.test(normalized);
}

function describeActiveMatchPolicy(policy) {
  if (!policy) return "";
  const parts = [];
  if (policy.stockCodePrefix) parts.push(`stok kodu ${policy.stockCodePrefix} ile başlayanlar`);
  if (policy.preferredSeries) parts.push(`alaşım ${policy.preferredSeries}`);
  if (policy.preferredTemper) parts.push(`temper ${policy.preferredTemper}`);
  if (policy.preferredProductType) parts.push(`tip ${policy.preferredProductType}`);
  if (Array.isArray(policy.requiredStockCodeTerms) && policy.requiredStockCodeTerms.length) {
    parts.push(`stok kodunda ${policy.requiredStockCodeTerms.join(", ")}`);
  }
  if (Array.isArray(policy.requiredStockNameTerms) && policy.requiredStockNameTerms.length) {
    parts.push(`stok adında ${policy.requiredStockNameTerms.join(", ")}`);
  }
  if (parts.length === 0) return "";
  return parts.join(" | ");
}

function parseInstructionRowTargets(message) {
  const normalized = normalizeInstructionText(message);
  const matches = [
    ...normalized.matchAll(/(\d+)\s*\.\s*sat(?:ir|ır)[a-z]*/g),
    ...normalized.matchAll(/(\d+)\s+sat(?:ir|ır)(?:i|a|e|da|de|daki|deki|icin)\b/g)
  ];
  return [...new Set(matches
    .map((match) => Number(match[1]) - 1)
    .filter((index) => Number.isInteger(index) && index >= 0 && index < rows.length))];
}

function parseInstructionTargetScope(message) {
  if (parseInstructionRowTargets(message).length > 0) {
    return null;
  }

  const normalized = String(message || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/ı/g, "i")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .trim();

  const target = {};
  const tamperEmpty = /\btamperi?\s+bos\s+olan/i.test(normalized) || /\btemperi?\s+bos\s+olan/i.test(normalized);
  const tamperMatch = normalized.match(/\btamperi?\s+(t\d{1,4}|h\d{1,4}|o|f)\s+olan/i)
    || normalized.match(/\btemperi?\s+(t\d{1,4}|h\d{1,4}|o|f)\s+olan/i);
  const alasimMatch = normalized.match(/\balasimi?\s+([1-9]\d{3})\s+olan/i)
    || normalized.match(/\bserisi?\s+([1-9]\d{3})\s+olan/i)
    || normalized.match(/\b([1-9]\d{3})\s+olan/i);
  const dim1Match = normalized.match(/\bkalinlik\s*(?:=|:)?\s*(\d+(?:[.,]\d+)?)\s+olan/i);
  const dim2Match = normalized.match(/\ben\s*(?:=|:)?\s*(\d+(?:[.,]\d+)?)\s+olan/i);
  const dim3Match = normalized.match(/\bboy\s*(?:=|:)?\s*(\d+(?:[.,]\d+)?)\s+olan/i);
  const quantityMatch = normalized.match(/\b(?:adet|miktar)\s*(?:=|:)?\s*(\d+(?:[.,]\d+)?)\s+olan/i);
  const kgMatch = normalized.match(/\bkg\s*(?:=|:)?\s*(\d+(?:[.,]\d+)?)\s+olan/i);
  const unitPriceMatch = normalized.match(/\b(?:birim\s*fiyat|fiyat)\s*(?:=|:)?\s*(\d+(?:[.,]\d+)?)\s+olan/i);
  const scrapMatch = normalized.match(/\b(?:talas|talas\s*mik)\s*(?:=|:)?\s*(\d+(?:[.,]\d+)?)\s+olan/i);
  const customerNoMatch = normalized.match(/\bmusteri\s*no\s*(?:=|:)?\s*([a-z0-9._-]+)\s+olan/i);
  const customerPartNoMatch = normalized.match(/\bmusteri\s*parca\s*no\s*(?:=|:)?\s*([a-z0-9._-]+)\s+olan/i);
  const unitMatch = normalized.match(/\bbirim\s*(?:=|:)?\s*([a-z0-9._-]+)\s+olan/i);
  const originMatch = normalized.match(/\bmensei\s*(?:=|:)?\s*(yerli|ithal)\s+olan/i);
  const cutMatch = normalized.match(/\bkesim\s*(var|yok)\s+olan/i);
  const stockCodeMatch = normalized.match(/\bstok\s*kodunda\s+([a-z0-9._-]{2,30})\s+(?:gecen|geçen|gecsin|geçsin|olsun)\s+olan/i);
  const stockNameMatch = normalized.match(/\bstok\s*adinda\s+(.+?)\s+(?:gecen|geçen|gecsin|geçsin|olsun)\s+olan/i)
    || normalized.match(/\bstok\s*adinda\s+(.+?)\s+olan/i);
  const asksTargetedAction = /\bolanlar/i.test(normalized)
    || /\bolanlari/i.test(normalized)
    || /\bolanlarin/i.test(normalized)
    || /\bolanlari\s+(?:ara|getir|esle|eşle)/i.test(normalized)
    || /\bolanlarin\s+stok/i.test(normalized)
    || /\byeniden\s+ara/i.test(normalized);

  if (tamperEmpty) target.tamperEmpty = true;
  if (tamperMatch) target.tamper = tamperMatch[1].toUpperCase();
  if (alasimMatch) target.alasim = alasimMatch[1];
  if (dim1Match) target.dimKalinlik = Number(dim1Match[1].replace(",", "."));
  if (dim2Match) target.dimEn = Number(dim2Match[1].replace(",", "."));
  if (dim3Match) target.dimBoy = Number(dim3Match[1].replace(",", "."));
  if (quantityMatch) target.quantity = Number(quantityMatch[1].replace(",", "."));
  if (kgMatch) target.kg = Number(kgMatch[1].replace(",", "."));
  if (unitPriceMatch) target.birimFiyat = Number(unitPriceMatch[1].replace(",", "."));
  if (scrapMatch) target.talasMik = Number(scrapMatch[1].replace(",", "."));
  if (customerNoMatch) target.musteriNo = customerNoMatch[1].toLocaleLowerCase("tr-TR");
  if (customerPartNoMatch) target.musteriParcaNo = customerPartNoMatch[1].toLocaleLowerCase("tr-TR");
  if (unitMatch) target.birim = unitMatch[1].toLocaleLowerCase("tr-TR");
  if (originMatch) target.mensei = originMatch[1] === "yerli" ? "yerli" : "ithal";
  if (cutMatch) target.kesimDurumu = cutMatch[1] === "var" ? "var" : "yok";
  if (stockCodeMatch) target.stockCodeTerm = stockCodeMatch[1].toUpperCase();
  if (stockNameMatch) target.stockNameTerm = stockNameMatch[1].trim().toLocaleLowerCase("tr-TR");

  return asksTargetedAction && Object.keys(target).length ? target : null;
}

function rowMatchesTargetScope(row, target) {
  if (!target) return true;
  const selected = selectedCandidate(row);
  const tamper = String(selected?.tamper ?? row.tamper ?? "").trim().toUpperCase();
  const alasim = String(selected?.alasim ?? row.alasim ?? "").trim();
  const stockCode = String(selected?.stock_code ?? "").toUpperCase();
  const stockName = String(selected?.stock_name ?? "").toLocaleLowerCase("tr-TR");
  const birim = String(selected?.birim ?? "").toLocaleLowerCase("tr-TR");
  const nearlyEqual = (left, right) => {
    const a = Number(left);
    const b = Number(right);
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 0.001;
  };

  if (target.tamperEmpty && tamper) return false;
  if (target.tamper && tamper !== target.tamper) return false;
  if (target.alasim && alasim !== target.alasim) return false;
  if (target.dimKalinlik != null && !nearlyEqual(row.dimKalinlik, target.dimKalinlik)) return false;
  if (target.dimEn != null && !nearlyEqual(row.dimEn, target.dimEn)) return false;
  if (target.dimBoy != null && !nearlyEqual(row.dimBoy, target.dimBoy)) return false;
  if (target.quantity != null && !nearlyEqual(row.quantity ?? row.offer_adet, target.quantity)) return false;
  if (target.kg != null && !nearlyEqual(row.kg, target.kg)) return false;
  if (target.birimFiyat != null && !nearlyEqual(row.birimFiyat, target.birimFiyat)) return false;
  if (target.talasMik != null && !nearlyEqual(row.talasMik, target.talasMik)) return false;
  if (target.musteriNo && !String(row.musteriNo ?? "").toLocaleLowerCase("tr-TR").includes(target.musteriNo)) return false;
  if (target.musteriParcaNo && !String(row.musteriParcaNo ?? "").toLocaleLowerCase("tr-TR").includes(target.musteriParcaNo)) return false;
  if (target.birim && birim !== target.birim) return false;
  if (target.mensei && String(row.mensei ?? "").toLocaleLowerCase("tr-TR") !== target.mensei) return false;
  if (target.kesimDurumu && !String(row.kesimDurumu ?? "").toLocaleLowerCase("tr-TR").includes(target.kesimDurumu)) return false;
  if (target.stockCodeTerm && !stockCode.includes(target.stockCodeTerm)) return false;
  if (target.stockNameTerm && !stockName.includes(target.stockNameTerm)) return false;
  return true;
}

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

function currentMatchPolicy() {
  return activeMatchPolicy || extractedDoc?.learning?.applied_match_policy || null;
}

function currentRowDefaults() {
  return activeRowDefaults || extractedDoc?.learning?.row_defaults || null;
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
    offerMetaWarehouseEl,
    offerMetaPaymentPlanEl,
    offerMetaIncotermEl,
    offerMetaSpecialCodeEl,
    offerMetaDeliveryDateEl,
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

  document.querySelectorAll("[data-k='copy-first-row']").forEach((button) => {
    button.disabled = matchedOfferLocked;
  });
}

function copyFirstRowValue(field) {
  if (matchedOfferLocked) return;
  if (!Array.isArray(rows) || rows.length < 2) return;

  const firstRow = rows[0];
  const firstSelected = selectedCandidate(firstRow);

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    switch (field) {
      case "dimKalinlik":
        row.dimKalinlik = firstRow.dimKalinlik ?? null;
        row.offer_kalinlikCap = row.dimKalinlik;
        break;
      case "dimEn":
        row.dimEn = firstRow.dimEn ?? null;
        row.offer_enEtKal = row.dimEn;
        break;
      case "dimBoy":
        row.dimBoy = firstRow.dimBoy ?? null;
        row.offer_boy = row.dimBoy;
        break;
      case "kesimDurumu":
        row.kesimDurumu = firstRow.kesimDurumu || "Kesim Var";
        break;
      case "mensei":
        row.mensei = firstRow.mensei || "İTHAL";
        break;
      case "quantity":
        row.quantity = firstRow.quantity ?? null;
        row.offer_adet = row.quantity || row.offer_adet || null;
        break;
      case "kg":
        row.kg = firstRow.kg ?? null;
        break;
      case "birimFiyat":
        row.birimFiyat = firstRow.birimFiyat ?? null;
        break;
      case "talasMik":
        row.talasMik = firstRow.talasMik ?? null;
        break;
      case "musteriNo":
        row.musteriNo = firstRow.musteriNo ?? "";
        break;
      case "musteriParcaNo":
        row.musteriParcaNo = firstRow.musteriParcaNo ?? "";
        break;
      case "selected_stock_id":
        row.selected_stock_id = firstRow.selected_stock_id ?? null;
        row.selected_score = firstRow.selected_score ?? null;
        if (firstSelected) {
          const existing = Array.isArray(row.candidates)
            ? row.candidates.find((candidate) => Number(candidate.stock_id) === Number(firstSelected.stock_id))
            : null;
          if (!existing) {
            row.candidates = [firstSelected, ...(Array.isArray(row.candidates) ? row.candidates : [])];
          }
          if (!row.offer_manuelStockAdi) {
            row.offer_manuelStockAdi = firstSelected.stock_name || "";
          }
        }
        break;
      default:
        break;
    }
  }

  const labels = {
    dimKalinlik: "Kalınlık",
    dimEn: "En",
    dimBoy: "Boy",
    kesimDurumu: "Kesim Durumu",
    mensei: "Menşei",
    quantity: "Adet",
    kg: "Kg",
    birimFiyat: "Birim Fiyat",
    talasMik: "Talaş Mik.",
    musteriNo: "Müşteri No",
    musteriParcaNo: "Müşteri Parça No",
    selected_stock_id: "Stok Kodu"
  };
  renderTable();
  saveStatusEl.textContent = `İlk satırdaki ${labels[field] || field} değeri tüm satırlara uygulandı.`;
}

function bindHeaderCopyControls() {
  document.querySelectorAll("[data-k='copy-first-row']").forEach((button) => {
    button.addEventListener("click", () => {
      copyFirstRowValue(String(button.dataset.field || "").trim());
    });
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
  setupLookupPicker(offerMetaWarehouseEl, {
    lookupKey: "warehouses",
    placeholder: "Depo kodu veya aciklama yazarak ara...",
    minChars: 0,
    limit: 30
  });
  setupLookupPicker(offerMetaPaymentPlanEl, {
    lookupKey: "payment-plans",
    placeholder: "Plan kodu veya aciklama yazarak ara...",
    minChars: 0,
    limit: 30
  });
  setupLookupPicker(offerMetaIncotermEl, {
    lookupKey: "incoterms",
    placeholder: "Teslim sekli yazarak ara...",
    minChars: 0,
    limit: 30
  });
  setupLookupPicker(offerMetaSpecialCodeEl, {
    lookupKey: "special-codes",
    placeholder: "Ozel kod veya aciklama yazarak ara...",
    minChars: 0,
    limit: 30
  });

  if (offerMetaDateEl && !offerMetaDateEl.value) {
    offerMetaDateEl.value = new Date().toISOString().slice(0, 10);
  }
  if (offerMetaDeliveryDateEl && !offerMetaDeliveryDateEl.value) {
    offerMetaDeliveryDateEl.value = "";
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

function normalizeInstructionText(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/ı/g, "i")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .trim();
}

function isWholeTableRerunInstruction(message) {
  const normalized = normalizeInstructionText(message);
  if (!normalized) return false;
  const directWholeTableCommands = [
    "yeniden ara",
    "yeniden esle",
    "yeniden eşle",
    "yeniden esles",
    "yeniden eşleş",
    "tekrar ara",
    "yenile"
  ];
  if (directWholeTableCommands.includes(normalized)) {
    return true;
  }
  const mentionsAllRows = /\b(butun|bütün|tum|tüm)\s+satir/i.test(normalized)
    || /\b(tumunu|tümünü|hepsini)\b/i.test(normalized);
  const rerunVerb = /\b(yeniden\s+(ara|esle|eşle)|yenile|tekrar\s+(ara|esle|eşle)|esle|eşle)\b/i.test(normalized);
  return mentionsAllRows && rerunVerb;
}

function buildInstructionSuggestion(message) {
  const normalized = normalizeInstructionText(message);
  if (!normalized) return null;

  const scopeParts = [];
  const actionParts = [];
  const ruleParts = [];

  const tamperValue = normalized.match(/\btamperi?\s+(t\d{1,4}|h\d{1,4}|o|f)\b/i)
    || normalized.match(/\btemperi?\s+(t\d{1,4}|h\d{1,4}|o|f)\b/i);
  const alasimValue = normalized.match(/\balasimi?\s+([1-9]\d{3})\b/i);
  const dim1Value = normalized.match(/\bkalinlik\s+(\d+(?:[.,]\d+)?)\b/i);
  const dim2Value = normalized.match(/\ben\s+(\d+(?:[.,]\d+)?)\b/i);
  const dim3Value = normalized.match(/\bboy\s+(\d+(?:[.,]\d+)?)\b/i);
  const stockCodeValue = normalized.match(/\bstok\s*kod(?:u|unda)?\s+([a-z0-9._-]{2,30})\s+(?:gecen|geçen|gecsin|geçsin|olsun)\b/i)
    || normalized.match(/\bstok\s*kod(?:u|unda)?\s+([a-z0-9._-]{2,12})\s+ile\s+baslayan\b/i)
    || normalized.match(/\b([a-z0-9._-]{2,30})\s+(?:gecen|geçen|gecsin|geçsin)\s+stok\s*kod(?:u|unda)?\b/i);
  const stockNameValue = normalized.match(/\bstok\s*ad(?:i|ı|inda|ında)?\s+(.+?)\s+(?:gecen|geçen|gecsin|geçsin|olsun)\b/i)
    || normalized.match(/\b(.+?)\s+(?:gecen|geçen|gecsin|geçsin)\s+stok\s*ad(?:i|ı|inda|ında)?\b/i);

  if (/\btamperi?\s+bos\s+olan/i.test(normalized) || /\btemperi?\s+bos\s+olan/i.test(normalized)) {
    scopeParts.push("tamperi boş olanların");
  } else if (tamperValue) {
    scopeParts.push(`tamperi ${tamperValue[1].toUpperCase()} olanların`);
  }

  if (alasimValue) scopeParts.push(`alaşımı ${alasimValue[1]} olanların`);

  if (stockNameValue) {
    const term = stockNameValue[1].trim();
    actionParts.push(`${scopeParts.length ? "" : ""}stok adında ${term} geçsin`);
  } else if (stockCodeValue) {
    const term = stockCodeValue[1].trim().toUpperCase();
    actionParts.push(`stok kodunda ${term} geçsin`);
  } else if (dim1Value || dim2Value || dim3Value || tamperValue || alasimValue) {
    const dimParts = [];
    if (dim1Value) dimParts.push(`kalınlık ${String(dim1Value[1]).replace(",", ".")}`);
    if (dim2Value) dimParts.push(`en ${String(dim2Value[1]).replace(",", ".")}`);
    if (dim3Value) dimParts.push(`boy ${String(dim3Value[1]).replace(",", ".")}`);
    if (tamperValue && !scopeParts.length) dimParts.unshift(`tamper ${tamperValue[1].toUpperCase()}`);
    if (alasimValue && !scopeParts.length) dimParts.unshift(`${alasimValue[1]} serisinde`);
    if (dimParts.length) actionParts.push(`${dimParts.join(" ")} olanlarda ara`);
  }

  if (/\btamper\s+bos\s+olamaz\b/i.test(normalized) || /\btemper\s+bos\s+olamaz\b/i.test(normalized)) {
    ruleParts.push("tamper boş olamaz");
  }
  if (/\balasim\s+bos\s+olamaz\b/i.test(normalized) || /\balaşim\s+bos\s+olamaz\b/i.test(normalized) || /\balaşım\s+bos\s+olamaz\b/i.test(normalized)) {
    ruleParts.push("alaşım boş olamaz");
  }
  if (/\bstok\s*kodu\s+bos\s+olamaz\b/i.test(normalized)) {
    ruleParts.push("stok kodu boş olamaz");
  }
  if (/\bstok\s*adi\s+bos\s+olamaz\b/i.test(normalized) || /\bstok\s*adı\s+bos\s+olamaz\b/i.test(normalized)) {
    ruleParts.push("stok adı boş olamaz");
  }

  let suggestion = "";
  if (scopeParts.length && actionParts.length) {
    suggestion = `${scopeParts.join(" ve ")} ${actionParts.join(", ")}`;
  } else if (actionParts.length) {
    suggestion = actionParts.join(", ");
  }

  suggestion = suggestion
    .replace(/\bbutun\s+satirlarda\b/gi, "")
    .replace(/\btum\s+satirlarda\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (ruleParts.length) {
    suggestion = suggestion ? `${suggestion}. ${ruleParts.join(". ")}.` : `${ruleParts.join(". ")}.`;
  }

  suggestion = suggestion.replace(/\.\s*\./g, ".").trim();
  if (!suggestion) return null;

  return suggestion.charAt(0).toLocaleUpperCase("tr-TR") + suggestion.slice(1);
}

function appendInstructionSuggestion(originalMessage, suggestionText) {
  if (!instructionChatBodyEl) return;
  pendingInstructionSuggestion = { originalMessage, suggestionText };

  const item = document.createElement("div");
  item.className = "instruction-chat-msg assistant";

  const bubble = document.createElement("div");
  bubble.className = "instruction-chat-bubble instruction-chat-bubble--suggestion";

  const title = document.createElement("div");
  title.className = "instruction-suggestion-title";
  title.textContent = "Talimat tam anlaşılamadı. Şunu uygulayayım mı?";

  const suggestion = document.createElement("div");
  suggestion.className = "instruction-suggestion-text";
  suggestion.textContent = suggestionText;

  const actions = document.createElement("div");
  actions.className = "instruction-suggestion-actions";

  const approveBtn = document.createElement("button");
  approveBtn.type = "button";
  approveBtn.className = "btn-primary instruction-suggestion-btn";
  approveBtn.textContent = "Evet, bunu uygula";
  approveBtn.addEventListener("click", async () => {
    const pending = pendingInstructionSuggestion;
    pendingInstructionSuggestion = null;
    if (!pending) return;
    appendInstructionMessage("assistant", `Öneri uygulanıyor: ${pending.suggestionText}`);
    await rerunMatchingByInstruction(pending.suggestionText, { fromSuggestion: true });
  });

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "btn-secondary instruction-suggestion-btn";
  editBtn.textContent = "Metne yaz";
  editBtn.addEventListener("click", () => {
    if (instructionChatInputEl) {
      instructionChatInputEl.value = suggestionText;
      instructionChatInputEl.focus();
      instructionChatInputEl.setSelectionRange(instructionChatInputEl.value.length, instructionChatInputEl.value.length);
    }
  });

  actions.appendChild(approveBtn);
  actions.appendChild(editBtn);
  bubble.appendChild(title);
  bubble.appendChild(suggestion);
  bubble.appendChild(actions);
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

function mergeRowDefaults(nextDefaults) {
  if (!nextDefaults) return;
  activeRowDefaults = {
    ...(activeRowDefaults || {}),
    ...nextDefaults
  };
}

function buildMatchFiltersForRow(row, policyOverride = null) {
  const policy = policyOverride || currentMatchPolicy();
  const filters = {};
  if (policy?.preferredSeries) {
    filters.series = policy.preferredSeries;
  } else if (row?.series) {
    filters.series = row.series;
  }
  if (policy?.preferredProductType) {
    filters.product_type = policy.preferredProductType;
  }
  return Object.keys(filters).length > 0 ? filters : undefined;
}

async function rerunMatchingByInstruction(message, options = {}) {
  if (isClearInstructionStateCommand(message)) {
    resetInstructionState();
    appendInstructionMessage("assistant", "Aktif eşleştirme filtresi ve sohbet talimat bağlamı temizlendi.");
    return;
  }

  const response = await api("/instructions/plan", "POST", {
    message,
    rowCount: rows.length,
    sourceMode
  });
  const plan = response.plan || {};
  const rowTargetIndexes = parseInstructionRowTargets(message);
  const scopedMatchPolicy = rowTargetIndexes.length > 0 && plan.matchPolicy ? plan.matchPolicy : null;
  const scopedMatchInstruction = scopedMatchPolicy ? (plan.sanitizedMessage || message) : "";
  const targetScope = parseInstructionTargetScope(message);
  const targetIndexes = rowTargetIndexes.length > 0
    ? rowTargetIndexes
    : targetScope && !plan.matchPolicy
    ? rows.map((row, index) => (rowMatchesTargetScope(row, targetScope) ? index : -1)).filter((index) => index >= 0)
    : [];
  if (targetScope && targetIndexes.length === 0 && !plan.matchPolicy && !plan.extractionPrompt && !isWholeTableRerunInstruction(message)) {
    appendInstructionMessage("assistant", "Bu talimata uyan bir satır bulunamadı. Bu yüzden tüm satırlar yeniden aranmadı.");
    return;
  }
  const hasRowCommands = Array.isArray(plan.rowCommands) && plan.rowCommands.length > 0;
  const wholeTableRerun = isWholeTableRerunInstruction(message);
  const hasMatchIntent = Boolean(plan.matchPolicy || plan.extractionPrompt || hasRowCommands || wholeTableRerun);

  if (!hasMatchIntent) {
    const suggestion = options.fromSuggestion ? null : buildInstructionSuggestion(message);
    if (suggestion && normalizeInstructionText(suggestion) !== normalizeInstructionText(message)) {
      appendInstructionSuggestion(message, suggestion);
    } else {
      appendInstructionMessage("assistant", "Talimat anlaşılmadı. Örnek: `tamper h14 olanlarda ara`, `kalınlık 10 olanlarda ara`, `en 150 boy 3000 olanlarda ara`, `stok adı alurex geçenlerde ara`, `2. satır kesim yok`.");
    }
    return;
  }

  if (plan.extractionPrompt && instructionTextEl) {
    instructionTextEl.value = plan.extractionPrompt;
  }
  if (plan.extractionPrompt && matchInstructionTextEl) {
    matchInstructionTextEl.value = plan.extractionPrompt;
  }
  if (plan.matchPolicy && !scopedMatchPolicy) {
    if (matchInstructionTextEl) {
      matchInstructionTextEl.value = plan.sanitizedMessage || message;
    }
    mergeMatchPolicy(plan.matchPolicy);
  }
  if (plan.rowDefaults) {
    mergeRowDefaults(plan.rowDefaults);
  }

  const willRerun = Boolean(plan.needsRematch || plan.needsReextract || wholeTableRerun);
  appendInstructionMessage("assistant", willRerun
    ? "Talimat alındı. Yeniden analiz ve eşleştirme uygulanıyor..."
    : "Talimat alındı. Mevcut satırlar üzerinde güncelleme uygulanıyor...");

  try {
    saveStatusEl.textContent = "Talimat uygulanıyor...";
    setAnalysisModal(true, "Talimat uygulanıyor...", "Talimat İşleniyor...");
    await flushStatusPaint();
    let instructionResult = { applied: [], changedRows: 0 };

    if (willRerun) {
      setAnalysisModal(true, "Talimata göre analiz ve eşleştirme yenileniyor...");
      const canReextract = sourceMode === "text"
        ? Boolean(orderTextEl?.value?.trim())
        : Boolean(fileInputEl?.files?.[0]);
      let doc = null;
      let reextracted = false;
      if (canReextract) {
        doc = await extractDocumentPayload();
        extractedDoc = doc;
        applyLearnedInstructions(doc);
        reextracted = true;
      } else if (plan.extractionPrompt && cachedSourcePayload) {
        setAnalysisModal(true, "Kaynak veri yeni talimatla tekrar çözümleniyor...");
        doc = await reextractFromCache(plan.extractionPrompt);
        if (doc) {
          extractedDoc = doc;
          applyLearnedInstructions(doc);
          reextracted = true;
        }
      } else if (extractedDoc) {
        doc = extractedDoc;
      } else if (rows.length > 0) {
        doc = buildDocFromExistingRows();
        extractedDoc = doc;
      } else {
        throw new Error("Önce metin veya doküman girin.");
      }
      const findMatchingItem = (r, itms) => {
        return itms.find(itm => itm.dim_text === r.dim_text || (r.header_context && itm.header_context === r.header_context));
      };

      if (targetScope && targetIndexes.length === 0 && plan.matchPolicy) {
        appendInstructionMessage("assistant", "Tabloda bu hedef alan degeri bulunamadi; talimat arama filtresi olarak tum satirlara uygulanacak.");
      }
      
      if (targetIndexes.length > 0 && extractedDoc?.items?.length > 0) {
        const items = extractedDoc.items;
        for (let position = 0; position < targetIndexes.length; position += 1) {
          const rowIndex = targetIndexes[position];
          const item = items[rowIndex] ?? findMatchingItem(rows[rowIndex], items);
          if (!item) continue;
          setAnalysisModal(true, `${position + 1}/${targetIndexes.length} hedef satır yeniden aranıyor...`);
          const filters = buildMatchFiltersForRow({ ...rows[rowIndex], series: item.series ?? rows[rowIndex].series }, scopedMatchPolicy);
          const res = await api("/match", "POST", {
            text: item.query,
            topK: candidateCount(),
            matchInstruction: scopedMatchInstruction || currentMatchInstruction() || undefined,
            matchPolicy: scopedMatchPolicy || currentMatchPolicy() || undefined,
            filters
          });
          const candidates = res.results || [];
          rows[rowIndex] = {
            ...rows[rowIndex],
            matchHistoryId: Number(res.matchHistoryId),
            candidates,
            selected_stock_id: candidates[0]?.stock_id ?? null,
            selected_score: candidates[0]?.score ?? null,
            alasim: candidates[0]?.alasim ?? rows[rowIndex].alasim ?? null,
            tamper: candidates[0]?.tamper ?? rows[rowIndex].tamper ?? null
          };
          if (res.ruleWarning) {
            appendInstructionMessage("assistant", `⚠️ Uyarı: Hedef satır için ${res.ruleWarning}`);
          }
        }
      } else if (!reextracted && !canReextract && rows.length > 0) {
        await rematchExistingRows({
          onProgress: ({ current, total }) => {
            setAnalysisModal(true, `${current}/${total} satır talimata göre yeniden eşleştiriliyor...`);
          }
        });
      } else {
        await runAnalysis(doc, {
          onProgress: ({ current, total }) => {
            setAnalysisModal(true, `${current}/${total} satır talimata göre analiz/eşleştirme yapılıyor...`);
          }
        });
      }
      instructionResult = applyInstructionCommands(plan.rowCommands || []);
      renderTable();
    } else {
      instructionResult = applyInstructionCommands(plan.rowCommands || []);
      renderTable();
    }

    pendingChatLearning = plan.learnable && !scopedMatchPolicy ? {
      rawMessage: message,
      plan,
      createdAt: Date.now(),
      sourceMode
    } : null;

    const notes = describeInstructionCommands(instructionResult.applied, plan.ignoredRowCommands || []);
    const overrideNote = notes.length ? ` Uygulanan komutlar: ${notes.join(" | ")}.` : "";
    const learnNote = pendingChatLearning ? " Bu talimat, Seçimleri Kaydet sonrası policy adayı olarak değerlendirilecek." : "";
    const activeFilterNote = !plan.matchPolicy && currentMatchPolicy()
      ? ` Aktif eşleştirme filtresi korunuyor: ${describeActiveMatchPolicy(currentMatchPolicy())}.`
      : "";
    const alreadyAppliedNote = !willRerun && Array.isArray(plan.rowCommands) && plan.rowCommands.length > 0 && instructionResult.changedRows === 0
      ? " Değişiklik yapılmadı; bu komut ilgili satırlarda zaten uygulanmış."
      : "";
    appendInstructionMessage("assistant", willRerun
      ? `Tamamlandı. ${(targetIndexes.length > 0 ? targetIndexes.length : rows.length)} satır güncellendi.${overrideNote}${learnNote}${activeFilterNote}`
      : `Tamamlandı. ${instructionResult.changedRows} satır güncellendi.${overrideNote}${alreadyAppliedNote}${learnNote}${activeFilterNote}`);
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
  resetInstructionState();
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
  pendingInstructionSuggestion = null;
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
  if (!res.ok) {
    const err = new Error(data.message || data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
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
    const payload = {
      rawText: orderTextEl.value.trim(),
      userInstruction: userInstruction || undefined,
      ...options
    };
    cachedSourcePayload = { type: "text", rawText: payload.rawText };
    return await api("/extract-source", "POST", payload);
  }

  const file = fileInputEl.files?.[0];
  if (!file) throw new Error("Doküman seçin.");
  const contentBase64 = await fileToBase64(file);
  cachedSourcePayload = {
    type: "doc",
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    contentBase64
  };
  return await api("/extract-source", "POST", {
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    contentBase64,
    userInstruction: userInstruction || undefined,
    ...options
  });
}

async function reextractFromCache(instruction, options = {}) {
  if (!cachedSourcePayload) return null;
  if (cachedSourcePayload.type === "text") {
    return await api("/extract-source", "POST", {
      rawText: cachedSourcePayload.rawText,
      userInstruction: instruction || undefined,
      ...options
    });
  }
  return await api("/extract-source", "POST", {
    fileName: cachedSourcePayload.fileName,
    mimeType: cachedSourcePayload.mimeType,
    contentBase64: cachedSourcePayload.contentBase64,
    userInstruction: instruction || undefined,
    ...options
  });
}

function selectedFileLooksLikeImage() {
  const file = fileInputEl.files?.[0];
  if (!file) return false;
  if (String(file.type || "").startsWith("image/")) return true;
  return /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(file.name || "");
}

function optionLabel(candidate) {
  return `${candidate.stock_code || "-"}`;
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
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function parseJsonInput(raw, label) {
  try {
    return JSON.parse(String(raw ?? "").trim());
  } catch (err) {
    throw new Error(`${label} geçerli JSON olmalı. ${err.message}`);
  }
}

function selectedCandidate(row) {
  const candidates = Array.isArray(row?.candidates) ? row.candidates : [];
  return candidates.find((candidate) => Number(candidate.stock_id) === Number(row.selected_stock_id)) || null;
}

function renderSelectedCandidateMeta(row) {
  const selected = selectedCandidate(row);
  if (!selected) {
    return "";
  }
  return "";
}

function renderMatchingRules() {
  if (!ruleListBodyEl) return;
  if (!Array.isArray(matchingRules) || matchingRules.length === 0) {
    ruleListBodyEl.innerHTML = '<tr><td colspan="6" class="muted center">Kural yok.</td></tr>';
    return;
  }

  ruleListBodyEl.innerHTML = matchingRules.map((rule) => `
    <tr>
      <td>${rule.id}</td>
      <td>${escapeHtml(rule.rule_set_name || "-")}</td>
      <td>
        <div>${escapeHtml(rule.description || "-")}</div>
        <div class="small muted">${escapeHtml(rule.effect_json?.type || "-")}</div>
      </td>
      <td>${escapeHtml(rule.rule_type || "-")}</td>
      <td>${rule.active ? "Aktif" : "Pasif"}</td>
      <td>
        <button type="button" class="btn-secondary mini-btn" data-k="toggle-rule" data-rule-id="${rule.id}" data-next-active="${rule.active ? "0" : "1"}">
          ${rule.active ? "Pasif Yap" : "Aktif Yap"}
        </button>
      </td>
    </tr>
  `).join("");

  ruleListBodyEl.querySelectorAll("[data-k='toggle-rule']").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const ruleId = Number(event.currentTarget.dataset.ruleId);
      const nextActive = event.currentTarget.dataset.nextActive === "1";
      try {
        await api(`/matching-rules/${ruleId}`, "PUT", { active: nextActive });
        await loadMatchingRules();
        saveStatusEl.textContent = `Kural #${ruleId} ${nextActive ? "aktif" : "pasif"} yapıldı.`;
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

async function loadMatchingRules() {
  if (!ruleListBodyEl) return;
  ruleListBodyEl.innerHTML = '<tr><td colspan="6" class="muted center">Kurallar yükleniyor...</td></tr>';
  const response = await api("/matching-rules", "GET");
  matchingRules = Array.isArray(response.items) ? response.items : [];
  renderMatchingRules();
}

function collectRuleTestCandidateIds() {
  const manual = String(ruleTestCandidateIdsInputEl?.value ?? "").trim();
  if (manual) {
    return manual
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item) && item > 0);
  }

  const ids = rows
    .flatMap((row) => Array.isArray(row.candidates) ? row.candidates.map((candidate) => Number(candidate.stock_id)) : [])
    .filter((item) => Number.isFinite(item) && item > 0);
  return [...new Set(ids)].slice(0, 20);
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
    alasim: null,
    tamper: null,
    kesimDurumu: "Kesim Var",
    mensei: "İTHAL",
    quantity: 1,
    kg: null,
    birimFiyat: null,
    talasMik: null,
    musteriNo: "",
    musteriParcaNo: "",
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

function roundWeight(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(5));
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function evaluateStockFormula(formula, variables) {
  const raw = String(formula ?? "").trim();
  if (!raw) return null;

  const aliases = {
    CAP: variables.cap,
    "ÇAP": variables.cap,
    EN: variables.en,
    BOY: variables.boy,
    YUKSEKLIK: variables.yukseklik,
    "YÜKSEKLİK": variables.yukseklik,
    "ÖZGÜLAĞIRLIK": variables.specificGravity,
    OZGULAGIRLIK: variables.specificGravity,
    OZAGIRLIK: variables.specificGravity
  };

  const expression = raw.replace(/\[([^\]]+)\]/g, (_match, token) => {
    const normalized = String(token || "")
      .trim()
      .toLocaleUpperCase("tr-TR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const exact = String(token || "").trim().toLocaleUpperCase("tr-TR");
    const value = aliases[exact] ?? aliases[normalized];
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : "0";
  });

  if (!/^[0-9+\-*/().,\s]+$/.test(expression)) return null;
  try {
    const normalizedExpression = expression.replace(/,/g, ".");
    const result = Function(`"use strict"; return (${normalizedExpression});`)();
    const n = Number(result);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function formulaReferencesOnlyLengthWithDiameter(formula) {
  const normalized = String(formula ?? "")
    .toLocaleUpperCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return /(?:\[|\b)(?:CAP|ÇAP)(?:\]|\b)/.test(normalized)
    && /(?:\[|\b)BOY(?:\]|\b)/.test(normalized)
    && !/(?:\[|\b)EN(?:\]|\b)/.test(normalized);
}

function calculateRowWeights(row) {
  const selected = selectedCandidate(row);
  const weightFormula = selected?.weight_formula ?? "";
  const scrapFormula = selected?.scrap_formula ?? "";
  const useSecondDimensionAsLength = formulaReferencesOnlyLengthWithDiameter(weightFormula)
    || formulaReferencesOnlyLengthWithDiameter(scrapFormula);
  const cap = firstFiniteNumber(row.dimKalinlik, selected?.erp_cap);
  const en = firstFiniteNumber(row.dimEn, selected?.erp_en);
  const boy = firstFiniteNumber(row.dimBoy, selected?.erp_boy, useSecondDimensionAsLength ? row.dimEn : null);
  const yukseklik = firstFiniteNumber(selected?.erp_yukseklik);
  const specificGravity = firstFiniteNumber(selected?.specific_gravity);
  const quantity = firstFiniteNumber(row.quantity) ?? 1;

  if (!cap || !boy || !specificGravity || !selected?.weight_formula) {
    return null;
  }

  const variables = { cap, en, boy, yukseklik, specificGravity };
  const unitKg = evaluateStockFormula(selected.weight_formula, variables);
  if (unitKg === null) return null;

  const unitTalas = row.kesimDurumu === "Kesim Yok"
    ? 0
    : evaluateStockFormula(selected.scrap_formula, variables) ?? 0;
  const baseKg = unitKg * quantity;
  const talasMik = unitTalas * quantity;

  return {
    kg: roundWeight(baseKg + talasMik),
    talasMik: roundWeight(talasMik)
  };
}

function recalculateRowWeights(index) {
  const row = rows[index];
  if (!row) return;
  const calculated = calculateRowWeights(row);
  if (!calculated) return;
  row.kg = calculated.kg;
  row.talasMik = calculated.talasMik;
}

function refreshWeightInputs(index) {
  const row = rows[index];
  if (!row) return;
  const kgInput = resultBodyEl?.querySelector(`[data-k='kg'][data-i='${index}']`);
  const talasInput = resultBodyEl?.querySelector(`[data-k='talas-mik'][data-i='${index}']`);
  if (kgInput) kgInput.value = fixedDecimalInput(row.kg, 5);
  if (talasInput) talasInput.value = fixedDecimalInput(row.talasMik, 5);
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

function fixedDecimalInput(value, fractionDigits = 5) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return decimalInput(value);
  return n.toFixed(fractionDigits).replace(".", ",");
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

function countDimParts(dimText) {
  return String(dimText ?? "")
    .split("x")
    .map((part) => Number(part.trim().replace(",", ".")))
    .filter((n) => Number.isFinite(n)).length;
}

function rowDimensionsForCandidate(dimText, candidate) {
  const [defaultKalinlik, defaultEn, defaultBoy] = parseDimParts(dimText);
  const hasTwoInputDimensions = countDimParts(dimText) === 2;
  const usesDiameterLengthFormula = formulaReferencesOnlyLengthWithDiameter(candidate?.weight_formula)
    || formulaReferencesOnlyLengthWithDiameter(candidate?.scrap_formula);

  if (hasTwoInputDimensions && usesDiameterLengthFormula) {
    return {
      dimKalinlik: defaultKalinlik,
      dimEn: null,
      dimBoy: defaultEn
    };
  }

  return {
    dimKalinlik: defaultKalinlik,
    dimEn: defaultEn,
    dimBoy: defaultBoy
  };
}

function ensureOfferDefaults(row) {
  const selected = selectedCandidate(row);
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
  if (row.alasim === undefined || row.alasim === null || row.alasim === "") {
    row.alasim = selected?.alasim ?? null;
  }
  if (row.tamper === undefined || row.tamper === null || row.tamper === "") {
    row.tamper = selected?.tamper ?? null;
  }
  if (row.offer_manuelStockAdi === undefined || row.offer_manuelStockAdi === null) {
    row.offer_manuelStockAdi = selected?.stock_name || "";
  }
}

function syncRowStockAttributes(index, candidate) {
  if (!rows[index]) return;
  if (countDimParts(rows[index].dim_text) > 0) {
    const mappedDims = rowDimensionsForCandidate(rows[index].dim_text, candidate);
    rows[index].dimKalinlik = mappedDims.dimKalinlik;
    rows[index].dimEn = mappedDims.dimEn;
    rows[index].dimBoy = mappedDims.dimBoy;
  }
  rows[index].alasim = candidate?.alasim ?? null;
  rows[index].tamper = candidate?.tamper ?? null;
  recalculateRowWeights(index);
}

function ensureResultTableStructure() {
  const kgHeaderButton = document.querySelector('#resultTable [data-field="kg"]');
  const kgHeaderCell = kgHeaderButton?.closest("th");
  const nextHeaderCell = kgHeaderCell?.nextElementSibling;
  if (kgHeaderCell && (!nextHeaderCell || nextHeaderCell.textContent?.trim() !== "Birim Fiyat")) {
    const header = document.createElement("th");
    header.textContent = "Birim Fiyat";
    kgHeaderCell.insertAdjacentElement("afterend", header);
  }

  resultBodyEl?.querySelectorAll("td[colspan='18']").forEach((cell) => {
    cell.setAttribute("colspan", "19");
  });
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
    stock.birim,
    stock.cinsi,
    stock.alasim,
    stock.tamper,
    stock.erp_en,
    stock.erp_boy,
    stock.erp_yukseklik,
    stock.erp_cap,
    stock.specific_gravity,
    stock.weight_formula,
    stock.scrap_formula
  ].filter(Boolean).join(" ").toLocaleLowerCase("tr-TR");
}

function renderAllStocksTable() {
  if (!allStockTableBodyEl) return;

  if (filteredStocks.length === 0) {
    allStockTableBodyEl.innerHTML = '<tr><td colspan="11" class="muted center">Sonuç yok.</td></tr>';
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
      <td>${stock.birim ?? "-"}</td>
      <td>${formatErpNumber(stock.erp_en)}</td>
      <td>${formatErpNumber(stock.erp_boy)}</td>
      <td>${formatErpNumber(stock.erp_yukseklik)}</td>
      <td>${formatErpNumber(stock.erp_cap)}</td>
      <td>${formatErpNumber(stock.specific_gravity)}</td>
      <td>${stock.cinsi ?? "-"}</td>
      <td>${stock.alasim ?? "-"}</td>
      <td>${stock.tamper ?? "-"}</td>
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
        syncRowStockAttributes(index, null);
        renderTable();
        return;
      }
      rows[index].selected_stock_id = hit.stock_id;
      rows[index].selected_score = hit.score;
      syncRowStockAttributes(index, hit);
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
      recalculateRowWeights(index);
      refreshWeightInputs(index);
    });
  });

  resultBodyEl.querySelectorAll("[data-k='dim-en']").forEach((input) => {
    input.addEventListener("input", (e) => {
      const index = Number(e.target.dataset.i);
      e.target.value = decimalInput(e.target.value || "");
      rows[index].dimEn = toDecimalOrNull(e.target.value);
      rows[index].offer_enEtKal = rows[index].dimEn;
      recalculateRowWeights(index);
      refreshWeightInputs(index);
    });
  });

  resultBodyEl.querySelectorAll("[data-k='dim-boy']").forEach((input) => {
    input.addEventListener("input", (e) => {
      const index = Number(e.target.dataset.i);
      e.target.value = decimalInput(e.target.value || "");
      rows[index].dimBoy = toDecimalOrNull(e.target.value);
      rows[index].offer_boy = rows[index].dimBoy;
      recalculateRowWeights(index);
      refreshWeightInputs(index);
    });
  });

  resultBodyEl.querySelectorAll("[data-k='kesim']").forEach((select) => {
    select.addEventListener("change", (e) => {
      const index = Number(e.target.dataset.i);
      rows[index].kesimDurumu = e.target.value || "Kesim Var";
      recalculateRowWeights(index);
      refreshWeightInputs(index);
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
      recalculateRowWeights(index);
      refreshWeightInputs(index);
    });
  });

  resultBodyEl.querySelectorAll("[data-k='kg']").forEach((input) => {
    input.addEventListener("input", (e) => {
      const index = Number(e.target.dataset.i);
      e.target.value = decimalInput(e.target.value || "");
      rows[index].kg = toDecimalOrNull(e.target.value);
    });
  });

  resultBodyEl.querySelectorAll("[data-k='birim-fiyat']").forEach((input) => {
    input.addEventListener("input", (e) => {
      const index = Number(e.target.dataset.i);
      e.target.value = decimalInput(e.target.value || "");
      rows[index].birimFiyat = toDecimalOrNull(e.target.value);
    });
  });

  resultBodyEl.querySelectorAll("[data-k='talas-mik']").forEach((input) => {
    input.addEventListener("input", (e) => {
      const index = Number(e.target.dataset.i);
      e.target.value = decimalInput(e.target.value || "");
      rows[index].talasMik = toDecimalOrNull(e.target.value);
    });
  });

  resultBodyEl.querySelectorAll("[data-k='musteri-no']").forEach((input) => {
    input.addEventListener("input", (e) => {
      const index = Number(e.target.dataset.i);
      rows[index].musteriNo = String(e.target.value || "");
    });
  });

  resultBodyEl.querySelectorAll("[data-k='musteri-parca-no']").forEach((input) => {
    input.addEventListener("input", (e) => {
      const index = Number(e.target.dataset.i);
      rows[index].musteriParcaNo = String(e.target.value || "");
    });
  });
}

function renderTable() {
  ensureResultTableStructure();
  if (rows.length === 0) {
    resultBodyEl.innerHTML = '<tr><td colspan="18" class="muted center">Sonuç yok.</td></tr>';
    renderOfferLines();
    return;
  }

  resultBodyEl.innerHTML = rows.map((row, index) => {
    recalculateRowWeights(index);
    const selected = selectedCandidate(row);
    const candidates = Array.isArray(row.candidates) ? row.candidates : [];
    const [defaultKalinlik, defaultEn, defaultBoy] = parseDimParts(row.dim_text);
    const keepEnBlankForDiameterLength = row.dimEn == null && row.dimBoy != null && countDimParts(row.dim_text) === 2;
    const kalinlik = row.dimKalinlik ?? defaultKalinlik;
    const en = keepEnBlankForDiameterLength ? null : (row.dimEn ?? defaultEn);
    const boy = row.dimBoy ?? defaultBoy;
    const alasim = selected?.alasim ?? row.alasim ?? "-";
    const tamper = selected?.tamper ?? row.tamper ?? "-";
    const kesim = row.kesimDurumu || "Kesim Var";
    const mensei = row.mensei || "İTHAL";
    const kg = row.kg ?? null;
    const birimFiyat = row.birimFiyat ?? null;
    const talasMik = row.talasMik ?? null;
    const musteriNo = row.musteriNo ?? "";
    const musteriParcaNo = row.musteriParcaNo ?? "";
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
        <td>${alasim || "-"}</td>
        <td>${tamper || "-"}</td>
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
        <td class="stock-name-cell">
          <div>${selected?.stock_name ?? "-"}</div>
          ${renderSelectedCandidateMeta(row)}
        </td>
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
        <td>
          <input
            data-k="kg"
            data-i="${index}"
            class="qty-input"
            value="${fixedDecimalInput(kg, 5)}"
            placeholder="Kg"
            ${matchedOfferLocked ? "disabled" : ""}
          />
        </td>
        <td>
          <input
            data-k="birim-fiyat"
            data-i="${index}"
            class="qty-input"
            value="${dimensionInput(birimFiyat)}"
            placeholder="Birim Fiyat"
            ${matchedOfferLocked ? "disabled" : ""}
          />
        </td>
        <td>
          <input
            data-k="talas-mik"
            data-i="${index}"
            class="qty-input"
            value="${fixedDecimalInput(talasMik, 5)}"
            placeholder="Talaş Mik."
            ${matchedOfferLocked ? "disabled" : ""}
          />
        </td>
        <td>
          <input
            data-k="musteri-no"
            data-i="${index}"
            class="qty-input"
            value="${musteriNo}"
            placeholder="Müşteri No"
            ${matchedOfferLocked ? "disabled" : ""}
          />
        </td>
        <td>
          <input
            data-k="musteri-parca-no"
            data-i="${index}"
            class="qty-input"
            value="${musteriParcaNo}"
            placeholder="Müşteri Parça No"
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

function buildDocFromExistingRows() {
  const items = rows.map((row) => {
    const dims = [row.dimKalinlik, row.dimEn, row.dimBoy].filter((d) => d !== null && d !== undefined);
    const dimText = row.dim_text || dims.join("x");
    const queryParts = [
      row.header_context || "",
      dimText,
      row.series ? `seri ${row.series}` : ""
    ].filter(Boolean);
    return {
      raw: dimText,
      query: queryParts.join(" ").trim() || dimText,
      normalized_line: dimText,
      dim_text: dimText,
      dim1: row.dimKalinlik ?? null,
      dim2: row.dimEn ?? null,
      dim3: row.dimBoy ?? null,
      qty: row.quantity ?? null,
      series: row.series ?? null,
      alasim: row.alasim ?? null,
      temper: row.tamper ?? null,
      kg: row.kg ?? null,
      birimFiyat: row.birimFiyat ?? null,
      talasMik: row.talasMik ?? null,
      musteriNo: row.musteriNo ?? "",
      musteriParcaNo: row.musteriParcaNo ?? "",
      kesimDurumu: row.kesimDurumu ?? null,
      mensei: row.mensei ?? null,
      header_context: row.header_context ?? null,
      confidence: 0.9
    };
  });

  return {
    source_type: "plain_text",
    extracted_text: items.map((item) => item.raw).join("\n"),
    header_context: null,
    items,
    parser_confidence: 0.9,
    extraction_method: "existing_rows",
    learning: null,
    debug: null
  };
}

async function rematchExistingRows(options = {}) {
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const BATCH_SIZE = 5;
  let completed = 0;

  for (let batchStart = 0; batchStart < rows.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, rows.length);
    const batchIndexes = [];
    for (let i = batchStart; i < batchEnd; i++) batchIndexes.push(i);

    const promises = batchIndexes.map(async (index) => {
      const row = rows[index];
      const dims = [row.dimKalinlik, row.dimEn, row.dimBoy].filter((d) => d !== null && d !== undefined);
      const dimText = row.dim_text || dims.join("x");
      const queryParts = [
        row.header_context || "",
        dimText,
        row.series ? `seri ${row.series}` : ""
      ].filter(Boolean);
      const queryText = queryParts.join(" ").trim() || dimText;

      if (!queryText) return;

      const filters = buildMatchFiltersForRow(row);
      const res = await api("/match", "POST", {
        text: queryText,
        topK: candidateCount(),
        matchInstruction: currentMatchInstruction() || undefined,
        matchPolicy: currentMatchPolicy() || undefined,
        filters
      });

      const candidates = res.results || [];
      const selectedCandidate = candidates[0] ?? null;
      const mappedDims = rowDimensionsForCandidate(rows[index].dim_text, selectedCandidate);
      rows[index] = {
        ...rows[index],
        matchHistoryId: Number(res.matchHistoryId),
        candidates,
        selected_stock_id: selectedCandidate?.stock_id ?? null,
        selected_score: selectedCandidate?.score ?? null,
        dimKalinlik: mappedDims.dimKalinlik,
        dimEn: mappedDims.dimEn,
        dimBoy: mappedDims.dimBoy,
        alasim: selectedCandidate?.alasim ?? rows[index].alasim ?? null,
        tamper: selectedCandidate?.tamper ?? rows[index].tamper ?? null
      };
    });

    await Promise.all(promises);
    completed += batchIndexes.length;
    onProgress?.({
      stage: "matching",
      current: completed,
      total: rows.length
    });
  }

  renderTable();
  saveStatusEl.textContent = `${rows.length} satır yeniden eşleştirildi.`;
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
    const filters = buildMatchFiltersForRow({ series: item.series });
    const res = await api("/match", "POST", {
      text: item.query,
      topK: candidateCount(),
      matchInstruction: currentMatchInstruction() || undefined,
      matchPolicy: currentMatchPolicy() || undefined,
      filters
    });
    if (res.ruleWarning) {
      alert(`Uyarı (Satır ${index + 1}): ${res.ruleWarning}`);
    }
    const candidates = res.results || [];
    const selectedCandidate = candidates[0] ?? null;
    const mappedDims = rowDimensionsForCandidate(item.dim_text, selectedCandidate);
    rows.push({
      matchHistoryId: Number(res.matchHistoryId),
      candidates,
      selected_stock_id: selectedCandidate?.stock_id ?? null,
      selected_score: selectedCandidate?.score ?? null,
      dim_text: item.dim_text,
      dimKalinlik: mappedDims.dimKalinlik,
      dimEn: mappedDims.dimEn,
      dimBoy: mappedDims.dimBoy,
      alasim: selectedCandidate?.alasim ?? item.alasim ?? null,
      tamper: selectedCandidate?.tamper ?? item.temper ?? null,
      kesimDurumu: item.kesimDurumu || "Kesim Var",
      mensei: item.mensei || "İTHAL",
      quantity: item.qty,
      kg: item.kg ?? null,
      birimFiyat: item.birimFiyat ?? null,
      talasMik: item.talasMik ?? null,
      musteriNo: item.musteriNo ?? "",
      musteriParcaNo: item.musteriParcaNo ?? "",
      series: item.series,
      header_context: item.header_context,
      user_note: item.qty ? `adet:${item.qty}` : ""
    });
  }

  const rowDefaults = currentRowDefaults() || doc.learning?.row_defaults || null;
  if (rowDefaults) {
    applyInstructionCommands([{ scope: "all", set: rowDefaults }]);
  }

  renderTable();
  const learnedProfile = doc.learning?.applied_profile_name ? ` | Profil: ${doc.learning.applied_profile_name}` : "";
  const learnedPolicy = doc.learning?.applied_instruction_policy_name ? ` | Talimat Politikası: ${doc.learning.applied_instruction_policy_name}` : "";
  saveStatusEl.textContent = `${rows.length} satır analiz edildi. Kaynak: ${formatSourceType(doc.source_type)} | Yöntem: ${formatExtractionMethod(doc.extraction_method)}${learnedProfile}${learnedPolicy}`;
}

function applyLearnedInstructions(doc) {
  if (!doc?.learning) return;
  if (doc.learning.effective_instruction && instructionTextEl && !currentInstruction()) {
    instructionTextEl.value = doc.learning.effective_instruction;
  }
  if (doc.learning.applied_match_instruction && matchInstructionTextEl && !currentMatchInstruction()) {
    matchInstructionTextEl.value = doc.learning.applied_match_instruction;
  }
  if (!activeMatchPolicy && doc.learning.applied_match_policy) {
    activeMatchPolicy = doc.learning.applied_match_policy;
  }
  if (!activeRowDefaults && doc.learning.row_defaults) {
    activeRowDefaults = doc.learning.row_defaults;
  }
}

function mapRowsForOfferSave() {
  return rows.map((row) => ({
    matchHistoryId: row.matchHistoryId ?? null,
    selected_stock_id: row.selected_stock_id ?? null,
    selected_score: row.selected_score ?? null,
    quantity: row.quantity ?? null,
    kg: row.kg ?? null,
    birimFiyat: row.birimFiyat ?? null,
    talasMik: row.talasMik ?? null,
    musteriNo: row.musteriNo ?? "",
    musteriParcaNo: row.musteriParcaNo ?? "",
    dimKalinlik: row.dimKalinlik ?? null,
    dimEn: row.dimEn ?? null,
    dimBoy: row.dimBoy ?? null,
    alasim: selectedCandidate(row)?.alasim ?? row.alasim ?? null,
    tamper: selectedCandidate(row)?.tamper ?? row.tamper ?? null,
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
      alasim: selected?.alasim ?? row.alasim ?? "",
      tamper: selected?.tamper ?? row.tamper ?? "",
      stokKodu: selected?.stock_code ?? "",
      stokAdi: selected?.stock_name ?? "",
      birim: selected?.birim ?? "",
      kesimDurumu: row.kesimDurumu ?? "Kesim Var",
      mensei: row.mensei ?? "İTHAL",
      adet: row.quantity ?? null,
      kg: row.kg ?? null,
      birimFiyat: row.birimFiyat ?? null,
      talasMik: row.talasMik ?? null,
      musteriNo: row.musteriNo ?? "",
      musteriParcaNo: row.musteriParcaNo ?? ""
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
  const transportTypeCode = offerMetaIncotermEl?.value?.trim() || "";
  const incotermLabel = offerMetaIncotermEl?._lookupInput?.value?.trim() || transportTypeCode;
  return {
    offerDate: offerMetaDateEl?.value?.trim() || "",
    movementCode: offerMetaMovementCodeEl?.value?.trim() || "",
    customerCode: offerMetaCustomerEl?.value?.trim() || "",
    representativeCode: offerMetaRepresentativeEl?.value?.trim() || "",
    warehouseCode: offerMetaWarehouseEl?.value?.trim() || "",
    paymentPlanCode: offerMetaPaymentPlanEl?.value?.trim() || "",
    incotermName: incotermLabel,
    transportTypeCode,
    specialCode: offerMetaSpecialCodeEl?.value?.trim() || "",
    deliveryDate: offerMetaDeliveryDateEl?.value?.trim() || "",
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
  if (offerMetaWarehouseEl) {
    fillSelectOptions(offerMetaWarehouseEl, meta.warehouseCode ? [{ value: meta.warehouseCode, label: meta.warehouseCode }] : []);
    offerMetaWarehouseEl.value = meta.warehouseCode || "";
    if (offerMetaWarehouseEl._lookupInput) {
      offerMetaWarehouseEl._lookupInput.value = meta.warehouseCode || "";
    }
    offerMetaWarehouseEl.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (offerMetaPaymentPlanEl) {
    fillSelectOptions(offerMetaPaymentPlanEl, meta.paymentPlanCode ? [{ value: meta.paymentPlanCode, label: meta.paymentPlanCode }] : []);
    offerMetaPaymentPlanEl.value = meta.paymentPlanCode || "";
    if (offerMetaPaymentPlanEl._lookupInput) {
      offerMetaPaymentPlanEl._lookupInput.value = meta.paymentPlanCode || "";
    }
    offerMetaPaymentPlanEl.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (offerMetaIncotermEl) {
    const incotermValue = meta.transportTypeCode || meta.incotermName || "";
    const incotermLabel = meta.incotermName || meta.transportTypeCode || "";
    fillSelectOptions(offerMetaIncotermEl, incotermValue ? [{ value: incotermValue, label: incotermLabel }] : []);
    offerMetaIncotermEl.value = incotermValue;
    if (offerMetaIncotermEl._lookupInput) {
      offerMetaIncotermEl._lookupInput.value = incotermLabel;
    }
    offerMetaIncotermEl.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (offerMetaSpecialCodeEl) {
    fillSelectOptions(offerMetaSpecialCodeEl, meta.specialCode ? [{ value: meta.specialCode, label: meta.specialCode }] : []);
    offerMetaSpecialCodeEl.value = meta.specialCode || "";
    if (offerMetaSpecialCodeEl._lookupInput) {
      offerMetaSpecialCodeEl._lookupInput.value = meta.specialCode || "";
    }
    offerMetaSpecialCodeEl.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (offerMetaDeliveryDateEl) {
    offerMetaDeliveryDateEl.value = meta.deliveryDate || "";
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
    const alasim = row.alasim || null;
    const tamper = row.tamper || null;
    return {
      matchHistoryId: row.matchHistoryId ?? null,
      candidates: stockId ? [{
        stock_id: stockId,
        stock_code: stockCode,
        stock_name: stockName,
        birim,
        alasim,
        tamper,
        erp_cap: row.erp_cap ?? null,
        erp_en: row.erp_en ?? null,
        erp_boy: row.erp_boy ?? null,
        erp_yukseklik: row.erp_yukseklik ?? null,
        specific_gravity: row.specific_gravity ?? null,
        weight_formula: row.weight_formula ?? null,
        scrap_formula: row.scrap_formula ?? null,
        score: row.selected_score ?? 0
      }] : [],
      selected_stock_id: stockId,
      selected_score: row.selected_score ?? null,
      dim_text: "",
      dimKalinlik: row.dimKalinlik ?? null,
      dimEn: row.dimEn ?? null,
      dimBoy: row.dimBoy ?? null,
      kg: row.kg ?? null,
      birimFiyat: row.birimFiyat ?? null,
      talasMik: row.talasMik ?? null,
      musteriNo: row.musteriNo || "",
      musteriParcaNo: row.musteriParcaNo || "",
      alasim,
      tamper,
      kesimDurumu: row.kesimDurumu || "Kesim Var",
      mensei: row.mensei || "İTHAL",
      quantity: row.quantity ?? null,
      series: null,
      header_context: null,
      user_note: row.user_note || "",
      isManual: Boolean(row.isManual)
    };
  });
  rows.forEach((_row, index) => {
    if (rows[index].kg == null || rows[index].talasMik == null) {
      recalculateRowWeights(index);
    }
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
    const hasSourceInput = sourceMode === "text"
      ? Boolean(orderTextEl?.value?.trim())
      : Boolean(fileInputEl?.files?.[0]);
    const hasExistingRows = rows.length > 0;

    if (!hasSourceInput && !hasExistingRows) {
      alert("Lütfen analiz edilecek sipariş metnini girin veya doküman seçin.");
      return;
    }

    resetInstructionState();
    pendingChatLearning = null;

    if (hasSourceInput) {
      setAnalysisModal(true, "Doküman okunuyor...");
      const doc = await extractDocumentPayload(selectedFileLooksLikeImage() ? { forceAiFallback: true } : {});
      extractedDoc = doc;
      applyLearnedInstructions(doc);
      setAnalysisModal(true, `${doc.items?.length || 0} satır eşleştirme kuyruğuna alındı...`);
      await runAnalysis(doc, {
        onProgress: ({ current, total }) => {
          setAnalysisModal(true, `${current}/${total} satır eşleştiriliyor...`);
        }
      });
    } else {
      setAnalysisModal(true, "Mevcut satırlar yeniden eşleştiriliyor...");
      await rematchExistingRows({
        onProgress: ({ current, total }) => {
          setAnalysisModal(true, `${current}/${total} satır yeniden eşleştiriliyor...`);
        }
      });
    }
  } catch (err) {
    alert(err.message);
  } finally {
    setAnalysisModal(false);
  }
});

strongAnalyzeBtnEl?.addEventListener("click", async () => {
  try {
    const hasSourceInput = sourceMode === "text"
      ? Boolean(orderTextEl?.value?.trim())
      : Boolean(fileInputEl?.files?.[0]);
    const hasExistingRows = rows.length > 0;

    if (!hasSourceInput && !hasExistingRows) {
      alert("Lütfen analiz edilecek sipariş metnini girin veya doküman seçin.");
      return;
    }

    resetInstructionState();
    pendingChatLearning = null;

    if (!hasSourceInput && hasExistingRows) {
      setAnalysisModal(true, "Mevcut satırlar yeniden eşleştiriliyor...");
      await rematchExistingRows({
        onProgress: ({ current, total }) => {
          setAnalysisModal(true, `${current}/${total} satır yeniden eşleştiriliyor...`);
        }
      });
      setAnalysisModal(false);
      return;
    }

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
      erp_cap: stock.erp_cap ?? null,
      erp_en: stock.erp_en ?? null,
      erp_boy: stock.erp_boy ?? null,
      erp_yukseklik: stock.erp_yukseklik ?? null,
      specific_gravity: stock.specific_gravity ?? null,
      weight_formula: stock.weight_formula ?? null,
      scrap_formula: stock.scrap_formula ?? null,
      alasim: stock.alasim ?? null,
      tamper: stock.tamper ?? null,
      score: rows[modalRowIndex].selected_score ?? 0
    });
  }
  rows[modalRowIndex].selected_stock_id = stock.stock_id;
  rows[modalRowIndex].selected_score = existing?.score ?? rows[modalRowIndex].selected_score ?? 0;
  syncRowStockAttributes(modalRowIndex, stock);
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
        await api("/profiles/confirm", "POST", {
          extractedDoc,
          approved: failed.length === 0
        });
        if (pendingChatLearning?.plan) {
          const commitResult = await api("/instruction-policies/commit", "POST", {
            rawMessage: pendingChatLearning.rawMessage,
            plan: pendingChatLearning.plan,
            extractedDoc,
            approved: failed.length === 0,
            sourceName: currentSourceName()
          });
          if (failed.length === 0) {
            const activationNote = commitResult.activated ? " Politika aktifleşti." : " Politika aday havuzuna eklendi.";
            appendInstructionMessage("assistant", `Talimat politikası kaydedildi${commitResult.policyId ? ` (#${commitResult.policyId})` : ""}.${activationNote}`);
            pendingChatLearning = null;
          } else {
            appendInstructionMessage("assistant", "Kayıt kısmi tamamlandı. Talimat politikası tam onay için yeniden Seçimleri Kaydet bekliyor.");
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
    const payload = {
      offerId,
      ...offerMeta,
      rows: mapRowsForOfferSave()
    };

    let result;
    try {
      result = await api("/matched-offers/send-erp", "POST", payload);
    } catch (err) {
      if (err.status !== 409 || !err.data?.confirmationRequired) {
        throw err;
      }

      setAnalysisModal(false);
      const confirmed = confirm(`${err.data.warningMessage || err.message}\n\nDevam etmek istiyor musunuz?`);
      if (!confirmed) {
        saveStatusEl.textContent = "ERP gonderimi iptal edildi.";
        return;
      }

      setAnalysisModal(true, "Teklif ERP sistemine gonderiliyor...", "ERP'ye Gonderiliyor...");
      await flushStatusPaint();
      result = await api("/matched-offers/send-erp", "POST", {
        ...payload,
        continueOnUyumWarning: true
      });
    }

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
    nakliyeSekli: offerNakliyeSekliEl?.value?.trim() || "",
    warehouseCode: offerMetaWarehouseEl?.value?.trim() || "",
    paymentPlanDesc: offerMetaPaymentPlanEl?.value?.trim() || "",
    shippingDate: offerMetaDeliveryDateEl?.value?.trim() || "",
    deliveryDate: offerMetaDeliveryDateEl?.value?.trim() || ""
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

refreshRulesBtnEl?.addEventListener("click", async () => {
  try {
    await loadMatchingRules();
    saveStatusEl.textContent = "Kurallar yenilendi.";
  } catch (err) {
    alert(err.message);
  }
});

createRuleBtnEl?.addEventListener("click", async () => {
  try {
    const ruleSetName = ruleSetNameInputEl?.value?.trim() || "";
    const priority = Number(rulePriorityInputEl?.value ?? 100);
    const description = ruleDescriptionInputEl?.value?.trim() || "";
    const ruleType = (ruleTypeInputEl?.value?.trim() === "soft_boost") ? "soft_boost" : "hard_filter";
    const conditionJson = parseJsonInput(ruleConditionInputEl?.value, "Condition JSON");
    const effectJson = parseJsonInput(ruleEffectInputEl?.value, "Effect JSON");
    // 6.2 Scope: ileride scopeTypeInputEl eklendiğinde buradan okunacak
    const scopeType = "global";
    const scopeValue = null;

    if (!ruleSetName || !description) {
      throw new Error("Rule set adı ve açıklama gerekli.");
    }

    // 6.3 Çatışma ön kontrolü: soft_boost için eleme efektleri kullanılamaz
    if (ruleType === "soft_boost") {
      const hardEffectTypes = ["require_prefix", "require_exact_series", "require_non_null", "reject_prefix", "reject_if_missing_dimension"];
      if (hardEffectTypes.includes(effectJson?.type)) {
        throw new Error("soft_boost kural tipi eleme efektleriyle kullanılamaz. add_score veya multiply_score kullanın.");
      }
    }

    const result = await api("/matching-rules", "POST", {
      ruleSetName,
      priority,
      ruleType,
      scopeType,
      scopeValue,
      targetLevel: "pair",
      conditionJson,
      effectJson,
      stopOnMatch: ruleType === "hard_filter", // soft_boost için stop_on_match anlamsız
      description,
      active: true
    });
    await loadMatchingRules();
    saveStatusEl.textContent = `Kural eklendi. Rule Set #${result.ruleSetId}, Rule #${result.ruleId} (${ruleType})`;
  } catch (err) {
    alert(err.message);
  }
});


runRuleTestBtnEl?.addEventListener("click", async () => {
  try {
    const text = String(ruleTestTextInputEl?.value ?? "").trim() || String(orderTextEl?.value ?? "").trim();
    const candidateStockIds = collectRuleTestCandidateIds();
    if (!text) {
      throw new Error("Test metni gerekli.");
    }
    if (candidateStockIds.length === 0) {
      throw new Error("Test için candidate stock id gerekli.");
    }

    const result = await api("/matching-rules/test", "POST", {
      text,
      candidateStockIds
    });
    if (ruleTestResultEl) {
      ruleTestResultEl.textContent = prettyJson(result);
    }
    saveStatusEl.textContent = `Kural testi tamamlandı. Önce: ${result.beforeCount}, Sonra: ${result.afterCount}`;
  } catch (err) {
    alert(err.message);
  }
});

setInstructionDrawerOpen(false);
appendInstructionMessage("assistant", "Eşleştirme talimatınızı yazın. Bu sohbet zorunlu kural eklemez; mevcut satırları talimatınıza göre yeniden analiz eder ve eşleştirir.");
const initialMode = document.querySelector('input[name="sourceMode"]:checked')?.value || "text";
setMode(initialMode);
setFileStatus("Henüz dosya seçilmedi.");
if (offerBelgeTarihiEl && !offerBelgeTarihiEl.value) {
  offerBelgeTarihiEl.value = new Date().toISOString().slice(0, 10);
}

initializeOfferMetaPanel();
bindHeaderCopyControls();
const pageParams = new URLSearchParams(window.location.search);
setMatchedOfferLocked(pageParams.get("readonly") === "1");

const urlRecordId = Number(pageParams.get("recordId"));
if (Number.isFinite(urlRecordId) && urlRecordId > 0) {
  loadMatchedOffer(urlRecordId).catch((err) => {
    saveStatusEl.textContent = `Kayıt yüklenemedi: ${err.message}`;
  });
}

if (ruleListBodyEl) {
  loadMatchingRules().catch((err) => {
    ruleListBodyEl.innerHTML = `<tr><td colspan="6" class="muted center">Kural yüklenemedi: ${escapeHtml(err.message)}</td></tr>`;
  });
}

