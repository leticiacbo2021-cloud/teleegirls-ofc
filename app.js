// ── Constantes ──────────────────────────────────────────────────────────────
const MS_HOUR = 60 * 60 * 1000;
const MIN_CONSULTS_FOR_AVERAGE = 2;
const DEFAULT_TYPE_PRICES = { adulto: 15, pediatria: 20, one: 20 };
const TYPE_META = {
  adulto: { label: "Adulto", color: "#d6336c" },
  pediatria: { label: "Pediatria", color: "#f76e9e" },
  one: { label: "One", color: "#9c6ade" },
  plantao: { label: "Plantão", color: "#c2185b" },
};
const TYPE_KEYS = Object.keys(TYPE_META);

// Alguns navegadores não zeram a rolagem horizontal da página quando o
// usuário muda o nível de zoom (Ctrl +/-), o que deixa o conteúdo
// (centralizado via margin:auto) parecendo "puxado" pra um lado. Forçar a
// rolagem horizontal de volta a 0 a cada mudança de tamanho de viewport
// (o que inclui zoom) resolve isso sem depender do navegador se corrigir sozinho.
window.addEventListener("resize", () => {
  if (window.scrollX !== 0) window.scrollTo(0, window.scrollY);
});

// Plantão: preço escalonado por faixa de horário. A contagem de cada faixa
// reinicia a cada dia (primeiros N atendimentos por um valor, depois outro).
const SHIFT_PRICING = {
  noturno: { label: "Noturno", startMin: 0, endMin: 7 * 60, threshold: 25, initial: 28, extra: 15 },
  m: { label: "M", startMin: 7 * 60, endMin: 13 * 60, threshold: 30, initial: 20, extra: 15 },
  t: { label: "T", startMin: 13 * 60, endMin: 19 * 60, threshold: 30, initial: 20, extra: 15 },
  reforco: { label: "Reforço", startMin: 19 * 60, endMin: 24 * 60, threshold: 25, initial: 20, extra: 15 },
};

// ── Estado ──────────────────────────────────────────────────────────────────
const state = {
  user: null,
  data: emptyData(),
  selectedDateKey: toDayKey(new Date()),
  calendarCursor: startOfMonth(new Date()),
  editingRecordId: null,
  // Turno travado manualmente para o registro do Plantão via botão rápido.
  // null = automático, calculado pelo horário atual (getShiftCategoryForTs).
  manualShiftOverride: null,
  charts: { day: null, week: null, month: null },
  saveTimer: null,
  saveInFlight: false,
  saveDirtyAgain: false,
  dirtyDays: new Set(),
  dirtySettings: false,
  yearlySummaryYear: new Date().getFullYear(),
};

// Marca só o(s) dia(s) realmente alterados nesta sessão, para que o
// salvamento envie apenas essas mudanças em vez da árvore de dados inteira —
// isso evita que uma aba com dados desatualizados apague dias que foram
// registrados em outra aba/dispositivo.
function markDayDirty(dayKey) { state.dirtyDays.add(dayKey); }
function markSettingsDirty() { state.dirtySettings = true; }

function emptyData() {
  return {
    days: {},
    settings: {
      typePrices: { ...DEFAULT_TYPE_PRICES },
      monthlyGoals: {},
    },
  };
}

// ── Helpers de data/formatação ─────────────────────────────────────────────
function createId() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function toDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function parseDayKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function monthKeyFromDayKey(dayKey) { return dayKey.slice(0, 7); }
function toTimestampFromDayAndTime(dayKey, hhmm) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const [hours, minutes] = hhmm.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
}
function toTimeInputValue(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function formatCurrency(v) { return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function formatCalendarRevenue(v) {
  if (v <= 0) return "-";
  if (v >= 1000) return `R$ ${(v / 1000).toFixed(1).replace(".", ",")}k`;
  return `R$ ${Math.round(v)}`;
}
function formatDateLong(dayKey) {
  const label = parseDayKey(dayKey).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
function formatMonthLong(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
function formatTime(ts) { return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
function formatRateCurrency(v) { return v === null ? "Sem base" : formatCurrency(v); }
function formatRateNumber(v) { return v === null ? "Sem base" : v.toFixed(2); }
function isToday(dayKey) { return dayKey === toDayKey(new Date()); }

// ── Tema claro/escuro + paleta de cores ────────────────────────────────────
const PALETTES = {
  rosa: {
    light: { verde: "#b5175f", verdeFill: "#b5175f99", teal: "#9c6ade", tealFill: "#9c6ade99", laranja: "#f76e9e" },
    dark: { verde: "#ff8fc4", verdeFill: "#ff8fc499", teal: "#c084fc", tealFill: "#c084fc99", laranja: "#ff9dc7" },
    types: {
      light: { adulto: "#64113f", pediatria: "#a6195d", one: "#d9366f", plantao: "#e9688a" },
      dark: { adulto: "#f0559f", pediatria: "#ff8fb3", one: "#c084fc", plantao: "#e0468a" },
    },
  },
  violeta: {
    light: { verde: "#1a4fa0", verdeFill: "#1a4fa099", teal: "#2f7fe0", tealFill: "#2f7fe099", laranja: "#6fb1f7" },
    dark: { verde: "#7fb0ff", verdeFill: "#7fb0ff99", teal: "#3f7fe0", tealFill: "#3f7fe099", laranja: "#a9d8ff" },
    types: {
      light: { adulto: "#0f2a63", pediatria: "#1a4fa0", one: "#2f7fe0", plantao: "#6fb1f7" },
      dark: { adulto: "#6fb1f7", pediatria: "#7fb0ff", one: "#a9d8ff", plantao: "#2f7fe0" },
    },
  },
};
function getActiveTheme() { return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"; }
function getActivePalette() { return document.documentElement.getAttribute("data-palette") === "violeta" ? "violeta" : "rosa"; }
function chartColor(name) {
  const p = PALETTES[getActivePalette()] || PALETTES.rosa;
  return (p[getActiveTheme()] || p.light)[name];
}
function typeChartColor(type) {
  const p = PALETTES[getActivePalette()] || PALETTES.rosa;
  return (p.types[getActiveTheme()] || p.types.light)[type];
}
function applyChartTheme() {
  if (typeof Chart === "undefined") return;
  const dark = getActiveTheme() === "dark";
  Chart.defaults.color = dark ? "#9bb0a4" : "#4f6255";
  Chart.defaults.borderColor = dark ? "rgba(155,176,164,0.18)" : "rgba(18,33,23,0.1)";
}
function setTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("theme", next); } catch (e) {}
  document.getElementById("theme-toggle-icon").textContent = next === "dark" ? "☀️" : "🌙";
  applyChartTheme();
  if (state.user) renderAll();
}
function setupThemeToggle() {
  applyChartTheme();
  document.getElementById("theme-toggle-icon").textContent = getActiveTheme() === "dark" ? "☀️" : "🌙";
  document.getElementById("theme-toggle").addEventListener("click", () => {
    setTheme(getActiveTheme() === "dark" ? "light" : "dark");
  });
}
function setPalette(palette) {
  const next = palette === "violeta" ? "violeta" : "rosa";
  document.documentElement.setAttribute("data-palette", next);
  try { localStorage.setItem("palette", next); } catch (e) {}
  document.getElementById("palette-toggle-icon").textContent = next === "violeta" ? "💠" : "🎨";
  applyChartTheme();
  if (state.user) renderAll();
}
function setupPaletteToggle() {
  document.getElementById("palette-toggle-icon").textContent = getActivePalette() === "violeta" ? "💠" : "🎨";
  document.getElementById("palette-toggle").addEventListener("click", () => {
    setPalette(getActivePalette() === "violeta" ? "rosa" : "violeta");
  });
}

// ── API ──────────────────────────────────────────────────────────────────────
async function api(path, { method = "GET", body } = {}) {
  const options = { method, credentials: "include", headers: {} };
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, options);
  let payload = null;
  try { payload = await res.json(); } catch (e) {}
  if (!res.ok) {
    const err = new Error(payload?.message || `Erro ${res.status}`);
    throw err;
  }
  return payload || {};
}

function setSyncStatus(tone, text) {
  const el = document.getElementById("sync-status-label");
  if (!el) return;
  el.className = `sync-status ${tone}`;
  el.textContent = text;
}

function scheduleSave() {
  setSyncStatus("saving", "Salvamento: alterações pendentes...");
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(flushSave, 700);
}

async function flushSave() {
  if (!state.user) return;
  if (state.saveInFlight) { state.saveDirtyAgain = true; return; }
  if (!state.dirtyDays.size && !state.dirtySettings) return;
  state.saveInFlight = true;
  setSyncStatus("saving", "Salvamento: enviando...");

  // Envia só os dias e/ou configurações que mudaram nesta sessão — nunca a
  // árvore de dados inteira. Assim, uma aba com dados desatualizados nunca
  // apaga dias registrados em outra aba/dispositivo.
  const daysPayload = {};
  const removedDays = [];
  for (const dayKey of state.dirtyDays) {
    const records = state.data.days[dayKey];
    if (records && records.length) daysPayload[dayKey] = records;
    else removedDays.push(dayKey);
  }
  const body = { days: daysPayload, removedDays };
  if (state.dirtySettings) body.settings = state.data.settings;

  const savedDays = new Set(state.dirtyDays);
  const savedSettings = state.dirtySettings;
  try {
    await api("/data/save", { method: "POST", body });
    for (const dayKey of savedDays) state.dirtyDays.delete(dayKey);
    if (savedSettings) state.dirtySettings = false;
    setSyncStatus("saved", "Salvamento: tudo salvo");
  } catch (err) {
    setSyncStatus("error", "Falha ao salvar. Tentando de novo...");
    state.saveTimer = setTimeout(flushSave, 4000);
  } finally {
    state.saveInFlight = false;
    if (state.saveDirtyAgain) {
      state.saveDirtyAgain = false;
      scheduleSave();
    }
  }
}

// ── Preço do Plantão (escalonado por faixa de horário) ─────────────────────
function getMinutesOfDay(ts) {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}
function getShiftCategoryForTs(ts) {
  const minutes = getMinutesOfDay(ts);
  for (const [key, cfg] of Object.entries(SHIFT_PRICING)) {
    if (minutes >= cfg.startMin && minutes < cfg.endMin) return key;
  }
  return "noturno";
}
// Recalcula o preço de TODOS os registros de plantão de um dia (a contagem da
// faixa depende da ordem cronológica dos atendimentos daquele dia). Registros
// marcados com plantaoManual mantêm o turno travado manualmente em vez de
// recalcular pelo horário — mas ainda entram na contagem daquele turno.
function recalcPlantaoPricingForDay(dayKey) {
  const records = getDayRecords(dayKey);
  if (!records.length) return;
  markDayDirty(dayKey);
  records.sort((a, b) => a.ts - b.ts);
  const counters = { noturno: 0, m: 0, t: 0, reforco: 0 };
  for (const record of records) {
    if (record.type !== "plantao") continue;
    const category =
      record.plantaoManual && SHIFT_PRICING[record.plantaoCategory]
        ? record.plantaoCategory
        : getShiftCategoryForTs(record.ts);
    counters[category] += 1;
    const cfg = SHIFT_PRICING[category];
    record.plantaoCategory = category;
    record.price = counters[category] <= cfg.threshold ? cfg.initial : cfg.extra;
  }
}
function getTypeDisplayLabel(record) {
  const base = TYPE_META[record.type]?.label || "Atendimento";
  if (record.type === "plantao" && record.plantaoCategory) {
    return `${base} ${SHIFT_PRICING[record.plantaoCategory]?.label || ""}`.trim();
  }
  return base;
}
// Preço que o botão de registro mostraria agora, simulando a inclusão do
// próximo atendimento de plantão no dia selecionado. Respeita o turno
// travado manualmente em "Plantão ativo no registro", se houver.
function getPendingPlantaoPrice() {
  const now = Date.now();
  const category = state.manualShiftOverride || getShiftCategoryForTs(now);
  const dayKey = toDayKey(new Date(now));
  const cfg = SHIFT_PRICING[category];
  const countSoFar = getDayRecords(dayKey).filter(
    (r) => r.type === "plantao" && r.plantaoCategory === category
  ).length;
  const nextIndex = countSoFar + 1;
  return { category, price: nextIndex <= cfg.threshold ? cfg.initial : cfg.extra };
}

// ── Preços dos demais tipos ─────────────────────────────────────────────────
function getTypePrices() {
  const raw = state.data.settings.typePrices || {};
  return {
    adulto: Number.isFinite(Number(raw.adulto)) ? Number(raw.adulto) : DEFAULT_TYPE_PRICES.adulto,
    pediatria: Number.isFinite(Number(raw.pediatria)) ? Number(raw.pediatria) : DEFAULT_TYPE_PRICES.pediatria,
    one: Number.isFinite(Number(raw.one)) ? Number(raw.one) : DEFAULT_TYPE_PRICES.one,
  };
}
function getRecordPrice(record) { return Number(record.price) || 0; }

// ── Dados do dia / registros ────────────────────────────────────────────────
function getDayRecords(dayKey) { return state.data.days[dayKey] || []; }

// forcedShiftCategory (opcional): quando informado para um registro de
// Plantão, trava o turno naquele valor (vindo do seletor "Plantão ativo no
// registro") em vez de calculá-lo automaticamente pelo horário.
function addRecord(dayKey, ts, type, atestado, name, forcedShiftCategory) {
  if (!state.data.days[dayKey]) state.data.days[dayKey] = [];
  const prices = getTypePrices();
  const isPlantao = type === "plantao";
  const category = isPlantao ? (forcedShiftCategory || getShiftCategoryForTs(ts)) : null;
  const record = {
    id: createId(),
    type,
    ts,
    atestado: atestado === true,
    price: isPlantao ? 0 : prices[type] || 0,
    plantaoCategory: category,
    plantaoManual: isPlantao ? Boolean(forcedShiftCategory) : false,
    name: typeof name === "string" ? name.trim().slice(0, 80) : "",
  };
  state.data.days[dayKey].push(record);
  markDayDirty(dayKey);
  if (isPlantao) recalcPlantaoPricingForDay(dayKey);
  return record;
}

function deleteRecordById(recordId) {
  for (const [dayKey, records] of Object.entries(state.data.days)) {
    const idx = records.findIndex((r) => r.id === recordId);
    if (idx === -1) continue;
    records.splice(idx, 1);
    if (!records.length) delete state.data.days[dayKey];
    else recalcPlantaoPricingForDay(dayKey);
    markDayDirty(dayKey);
    return dayKey;
  }
  return null;
}

function findRecordLocationById(recordId) {
  for (const [dayKey, records] of Object.entries(state.data.days)) {
    const idx = records.findIndex((r) => r.id === recordId);
    if (idx !== -1) return { dayKey, index: idx, record: records[idx] };
  }
  return null;
}

// ── Métricas ─────────────────────────────────────────────────────────────────
function makeEmptyCounts() { return TYPE_KEYS.reduce((acc, t) => ((acc[t] = 0), acc), {}); }

function computeDayMetrics(dayKey) {
  const records = [...getDayRecords(dayKey)].sort((a, b) => a.ts - b.ts);
  const counts = makeEmptyCounts();
  for (const r of records) counts[r.type] += 1;
  const total = records.length;
  const atestadoCount = records.reduce((s, r) => s + (r.atestado ? 1 : 0), 0);
  const atestadoRate = total > 0 ? atestadoCount / total : null;
  const revenue = records.reduce((s, r) => s + getRecordPrice(r), 0);
  const totalClockHours = total > 1 ? (records[total - 1].ts - records[0].ts) / MS_HOUR : 0;
  const hasSample = total >= MIN_CONSULTS_FOR_AVERAGE;
  return {
    records,
    counts,
    total,
    atestadoCount,
    atestadoRate,
    revenue,
    totalClockHours,
    grossRevenuePerHour: hasSample && totalClockHours > 0 ? revenue / totalClockHours : null,
    grossConsultationsPerHour: hasSample && totalClockHours > 0 ? total / totalClockHours : null,
    avgTicket: total > 0 ? revenue / total : null,
  };
}

function computeMonthMetrics(monthKey) {
  const counts = makeEmptyCounts();
  let total = 0;
  let revenue = 0;
  for (const [dayKey, records] of Object.entries(state.data.days)) {
    if (!dayKey.startsWith(`${monthKey}-`)) continue;
    for (const r of records) {
      counts[r.type] += 1;
      revenue += getRecordPrice(r);
    }
    total += records.length;
  }
  return { counts, total, revenue };
}

function getMonthRevenue(monthKey) { return computeMonthMetrics(monthKey).revenue; }

// Todos os registros de um mês, ordenados cronologicamente.
function getMonthRecords(monthKey) {
  const records = [];
  for (const [dayKey, dayRecords] of Object.entries(state.data.days)) {
    if (!dayKey.startsWith(`${monthKey}-`)) continue;
    for (const r of dayRecords) records.push(r);
  }
  records.sort((a, b) => a.ts - b.ts);
  return records;
}

// Todos os meses (YYYY-MM) que têm ao menos um atendimento registrado.
function getMonthsWithData() {
  const set = new Set();
  for (const dayKey of Object.keys(state.data.days)) {
    if (state.data.days[dayKey]?.length) set.add(monthKeyFromDayKey(dayKey));
  }
  return [...set].sort().reverse();
}

// ── Resumo anual ─────────────────────────────────────────────────────────────
const MONTH_LABELS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function renderYearlySummary() {
  const year = state.yearlySummaryYear;
  document.getElementById("yearly-summary-year-label").textContent = String(year);
  const body = document.getElementById("yearly-summary-body");
  body.innerHTML = "";

  let yearTotal = 0;
  let yearCount = 0;
  for (let m = 1; m <= 12; m += 1) {
    const monthKey = `${year}-${String(m).padStart(2, "0")}`;
    const metrics = computeMonthMetrics(monthKey);
    yearTotal += metrics.revenue;
    yearCount += metrics.total;

    const tr = document.createElement("tr");
    if (!metrics.total) tr.classList.add("is-empty-month");
    tr.innerHTML = `
      <td>${MONTH_LABELS[m - 1]}</td>
      <td>${metrics.total}</td>
      <td>${formatCurrency(metrics.revenue)}</td>
    `;
    body.appendChild(tr);
  }

  document.getElementById("yearly-summary-total-count").textContent = String(yearCount);
  document.getElementById("yearly-summary-total-revenue").textContent = formatCurrency(yearTotal);

  const select = document.getElementById("export-month-select");
  const previousValue = select.value;
  const monthsWithData = getMonthsWithData();
  const currentMonthKey = monthKeyFromDayKey(state.selectedDateKey);
  const options = monthsWithData.length ? monthsWithData : [currentMonthKey];
  select.innerHTML = options.map((mk) => `<option value="${mk}">${formatMonthLong(mk)}</option>`).join("");
  if (options.includes(previousValue)) select.value = previousValue;
  else if (options.includes(currentMonthKey)) select.value = currentMonthKey;
}

function openYearlySummaryModal() {
  state.yearlySummaryYear = parseDayKey(state.selectedDateKey).getFullYear();
  renderYearlySummary();
  const overlay = document.getElementById("yearly-summary-modal");
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
}
function closeYearlySummaryModal() {
  const overlay = document.getElementById("yearly-summary-modal");
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
}

// ── Exportação de atendimentos do mês ───────────────────────────────────────
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(value) {
  const str = String(value ?? "");
  return /[;"\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function exportMonthCSV(monthKey) {
  const records = getMonthRecords(monthKey);
  const rows = [["Data", "Hora", "Nome do paciente", "Tipo", "Atestado", "Valor (R$)"]];
  let total = 0;
  for (const r of records) {
    total += getRecordPrice(r);
    rows.push([
      toDayKey(new Date(r.ts)).split("-").reverse().join("/"),
      toTimeInputValue(r.ts),
      r.name || "",
      getTypeDisplayLabel(r),
      r.atestado ? "Sim" : "Não",
      getRecordPrice(r).toFixed(2).replace(".", ","),
    ]);
  }
  rows.push([]);
  rows.push(["", "", "", "", "Total", total.toFixed(2).replace(".", ",")]);
  const csv = "\uFEFF" + rows.map((row) => row.map(csvEscape).join(";")).join("\r\n");
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `atendimentos-${monthKey}.csv`);
}

function exportMonthPDF(monthKey) {
  if (!window.jspdf?.jsPDF) {
    alert("Não foi possível carregar o gerador de PDF. Verifique sua conexão e tente novamente.");
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const records = getMonthRecords(monthKey);
  const total = records.reduce((s, r) => s + getRecordPrice(r), 0);

  doc.setFontSize(14);
  doc.text(`Atendimentos — ${formatMonthLong(monthKey)}`, 14, 16);
  doc.setFontSize(10);
  doc.text(`${records.length} atendimento${records.length === 1 ? "" : "s"} · Faturamento total: ${formatCurrency(total)}`, 14, 23);

  doc.autoTable({
    startY: 28,
    head: [["Data", "Hora", "Nome do paciente", "Tipo", "Atestado", "Valor"]],
    body: records.map((r) => [
      toDayKey(new Date(r.ts)).split("-").reverse().join("/"),
      toTimeInputValue(r.ts),
      r.name || "—",
      getTypeDisplayLabel(r),
      r.atestado ? "Sim" : "Não",
      formatCurrency(getRecordPrice(r)),
    ]),
    foot: [["", "", "", "", "Total", formatCurrency(total)]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [214, 51, 108] },
    footStyles: { fillColor: [245, 245, 245], textColor: [20, 20, 20] },
  });

  doc.save(`atendimentos-${monthKey}.pdf`);
}

function getMonthlyGoal(monthKey) {
  const value = Number(state.data.settings.monthlyGoals?.[monthKey]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
function setMonthlyGoal(monthKey, value) {
  if (!state.data.settings.monthlyGoals) state.data.settings.monthlyGoals = {};
  if (value === null) delete state.data.settings.monthlyGoals[monthKey];
  else state.data.settings.monthlyGoals[monthKey] = value;
  markSettingsDirty();
}

// ── Renderização ─────────────────────────────────────────────────────────────
function renderConsultTypeButtons() {
  const grid = document.getElementById("consult-type-grid");
  grid.innerHTML = "";
  const prices = getTypePrices();
  for (const type of TYPE_KEYS) {
    const card = document.createElement("div");
    card.className = `type-card ${type}`;

    const header = document.createElement("div");
    header.className = `type-card-header ${type}`;
    if (type === "plantao") {
      const { category, price } = getPendingPlantaoPrice();
      header.textContent = `Plantão ${SHIFT_PRICING[category].label} (+${formatCurrency(price)})`;
    } else {
      header.textContent = `${TYPE_META[type].label} (+${formatCurrency(prices[type])})`;
    }

    const actions = document.createElement("div");
    actions.className = "type-card-actions";
    const semBtn = document.createElement("button");
    semBtn.type = "button";
    semBtn.className = "type-card-btn";
    semBtn.textContent = "Sem atestado";
    semBtn.addEventListener("click", () => registerConsult(type, false));
    const comBtn = document.createElement("button");
    comBtn.type = "button";
    comBtn.className = "type-card-btn";
    comBtn.textContent = "Com atestado";
    comBtn.addEventListener("click", () => registerConsult(type, true));
    actions.append(semBtn, comBtn);

    card.append(header, actions);
    grid.appendChild(card);
  }
}

// ── Seletor manual do turno ativo do Plantão ("Plantão ativo no registro") ──
// Comportamento de grupo único (tipo rádio) usando checkboxes: marcar uma
// desmarca as demais; desmarcar volta ao modo automático (por horário).
function setupShiftOverride() {
  const checks = document.querySelectorAll(".shift-override-check");
  checks.forEach((check) => {
    check.addEventListener("change", () => {
      if (check.checked) {
        checks.forEach((other) => { if (other !== check) other.checked = false; });
        state.manualShiftOverride = check.dataset.shift;
      } else {
        state.manualShiftOverride = null;
      }
      renderConsultTypeButtons();
    });
  });
}

function registerConsult(type, atestado) {
  const dayKey = state.selectedDateKey;
  const now = new Date();
  const [year, month, day] = dayKey.split("-").map(Number);
  const ts = new Date(year, month - 1, day, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds()).getTime();
  const nameInput = document.getElementById("quick-patient-name");
  const name = nameInput ? nameInput.value : "";
  const forcedCategory = type === "plantao" ? state.manualShiftOverride : null;
  addRecord(dayKey, ts, type, atestado === true, name, forcedCategory);
  if (nameInput) nameInput.value = "";
  state.calendarCursor = startOfMonth(parseDayKey(dayKey));
  scheduleSave();
  renderAll();
}

function undoLastFromSelectedDay() {
  const records = getDayRecords(state.selectedDateKey);
  if (!records.length) return;
  let latest = records[0];
  for (const r of records) if (r.ts > latest.ts) latest = r;
  deleteRecordById(latest.id);
  scheduleSave();
  renderAll();
}

function renderMetrics(metrics) {
  document.getElementById("selected-date-label").textContent = formatDateLong(state.selectedDateKey);
  document.getElementById("total-count").textContent = String(metrics.total);
  document.getElementById("total-revenue").textContent = formatCurrency(metrics.revenue);
  document.getElementById("gross-revenue-per-hour").textContent = formatRateCurrency(metrics.grossRevenuePerHour);
  document.getElementById("avg-ticket").textContent = formatRateCurrency(metrics.avgTicket);
  document.getElementById("atestado-rate").textContent =
    metrics.atestadoRate === null ? "Sem base" : `${(metrics.atestadoRate * 100).toFixed(1)}% (${metrics.atestadoCount}/${metrics.total})`;
  document.getElementById("type-breakdown").textContent =
    TYPE_KEYS.map((t) => `${TYPE_META[t].label}: ${metrics.counts[t]}`).join(" | ") + ` | Com atestado: ${metrics.atestadoCount}`;
}

function renderDayList(records) {
  const list = document.getElementById("day-list");
  const countLabel = document.getElementById("day-list-count");
  if (countLabel) {
    countLabel.textContent = records.length
      ? `${records.length} registro${records.length > 1 ? "s" : ""}`
      : "sem registros";
  }
  list.innerHTML = "";
  if (!records.length) {
    const li = document.createElement("li");
    li.textContent = "Nenhum atendimento registrado neste dia.";
    list.appendChild(li);
    return;
  }
  const ordered = [...records].sort((a, b) => b.ts - a.ts);
  for (const record of ordered) {
    const li = document.createElement("li");
    const row = document.createElement("div");
    row.className = "day-row";
    const main = document.createElement("div");
    main.className = "day-main";
    main.innerHTML = `
      <span>${formatTime(record.ts)}</span>
      ${record.name ? `<span class="day-patient-name">${escapeHtml(record.name)}</span>` : ""}
      <span class="tag ${record.type}">${getTypeDisplayLabel(record)}</span>
      <span class="metric-hint">${formatCurrency(getRecordPrice(record))}</span>
      ${record.atestado ? '<span class="tag atestado">Atestado</span>' : ""}
    `;
    const actions = document.createElement("div");
    actions.className = "day-actions";
    const editBtn = document.createElement("button");
    editBtn.className = "ghost day-action-btn";
    editBtn.type = "button";
    editBtn.textContent = "Editar";
    editBtn.addEventListener("click", () => openEditRecordModal(record.id));
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "ghost day-action-btn";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Excluir";
    deleteBtn.addEventListener("click", () => {
      deleteRecordById(record.id);
      scheduleSave();
      renderAll();
    });
    actions.append(editBtn, deleteBtn);
    row.append(main, actions);
    li.appendChild(row);
    list.appendChild(li);
  }
}

function getHeatClass(revenue, maxRevenue) {
  if (revenue <= 0 || maxRevenue <= 0) return "";
  const ratio = revenue / maxRevenue;
  if (ratio > 0.75) return "heat-4";
  if (ratio > 0.5) return "heat-3";
  if (ratio > 0.25) return "heat-2";
  return "heat-1";
}

function renderCalendar() {
  const grid = document.getElementById("calendar-grid");
  grid.innerHTML = "";
  const cursor = state.calendarCursor;
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const first = new Date(y, m, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(y, m, 1 - startOffset);
  const title = first.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  document.getElementById("calendar-title").textContent = title.charAt(0).toUpperCase() + title.slice(1);

  const monthDays = new Date(y, m + 1, 0).getDate();
  const monthRevenues = [];
  for (let d = 1; d <= monthDays; d += 1) monthRevenues.push(computeDayMetrics(toDayKey(new Date(y, m, d))).revenue);
  const maxRevenue = Math.max(...monthRevenues, 0);

  for (let i = 0; i < 42; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const key = toDayKey(date);
    const metrics = computeDayMetrics(key);
    const btn = document.createElement("button");
    btn.className = "day-cell";
    if (date.getMonth() !== m) btn.classList.add("other-month");
    if (key === state.selectedDateKey) btn.classList.add("selected");
    if (key === toDayKey(new Date())) btn.classList.add("today");
    const heat = getHeatClass(metrics.revenue, maxRevenue);
    if (heat) btn.classList.add(heat);
    btn.innerHTML = `
      <span class="num">${date.getDate()}</span>
      <span class="mini">${metrics.total} at.</span>
      <span class="mini">${formatCalendarRevenue(metrics.revenue)}</span>
    `;
    btn.addEventListener("click", () => {
      state.selectedDateKey = key;
      state.calendarCursor = startOfMonth(date);
      renderAll();
    });
    grid.appendChild(btn);
  }
}

// ── Linha do tempo do dia ────────────────────────────────────────────────────
function renderTimeline(records) {
  const track = document.getElementById("timeline-track");
  const emptyLabel = document.getElementById("timeline-empty-label");
  track.innerHTML = "";

  if (!records.length) {
    emptyLabel.textContent = "Sem atendimentos registrados neste dia.";
    track.style.width = "100%";
    return;
  }
  const lastRecord = records.reduce((a, b) => (b.ts > a.ts ? b : a));
  emptyLabel.textContent = `${records.length} atendimento${records.length > 1 ? "s" : ""} · último às ${formatTime(lastRecord.ts)}`;

  const sorted = [...records].sort((a, b) => a.ts - b.ts);
  const PAD_MIN = 30;
  let startMin = getMinutesOfDay(sorted[0].ts) - PAD_MIN;
  let endMin = getMinutesOfDay(sorted[sorted.length - 1].ts) + PAD_MIN;
  startMin = Math.max(0, Math.floor(startMin / 30) * 30);
  endMin = Math.min(24 * 60, Math.ceil(endMin / 30) * 30);
  if (endMin - startMin < 60) endMin = Math.min(24 * 60, startMin + 60);
  const totalMin = endMin - startMin;

  const PX_PER_MIN = 4; // controla o "zoom" horizontal da linha do tempo
  const widthPx = Math.max(totalMin * PX_PER_MIN, 320);
  track.style.width = `${widthPx}px`;

  // Marcações de hora (a cada 30 min)
  for (let m = startMin; m <= endMin; m += 30) {
    const tick = document.createElement("div");
    tick.className = "timeline-tick";
    tick.style.left = `${((m - startMin) / totalMin) * 100}%`;
    const hh = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(m % 60).padStart(2, "0");
    tick.innerHTML = `<span class="timeline-tick-label">${hh}:${mm}</span>`;
    track.appendChild(tick);
  }

  // Bolinhas de cada atendimento
  for (const record of sorted) {
    const minutes = getMinutesOfDay(record.ts);
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = `timeline-dot ${record.type}`;
    dot.style.left = `${((minutes - startMin) / totalMin) * 100}%`;
    dot.title = `${formatTime(record.ts)}${record.name ? " · " + record.name : ""} · ${getTypeDisplayLabel(record)}${record.atestado ? " · Com atestado" : ""}`;
    if (record.atestado) dot.classList.add("has-atestado");
    dot.addEventListener("click", () => openEditRecordModal(record.id));
    track.appendChild(dot);
  }
}

function setupDayListToggle() {
  const toggle = document.getElementById("day-list-toggle");
  const list = document.getElementById("day-list");
  if (!toggle || !list) return;
  let expanded = false;
  try { expanded = localStorage.getItem("dayListExpanded") === "1"; } catch (e) {}
  const apply = () => {
    list.classList.toggle("is-collapsed", !expanded);
    toggle.setAttribute("aria-expanded", String(expanded));
  };
  apply();
  toggle.addEventListener("click", () => {
    expanded = !expanded;
    apply();
    try { localStorage.setItem("dayListExpanded", expanded ? "1" : "0"); } catch (e) {}
  });
}

function setupTimelineNav() {
  const viewport = document.querySelector(".timeline-viewport");
  document.getElementById("timeline-prev").addEventListener("click", () => {
    viewport.scrollBy({ left: -160, behavior: "smooth" });
  });
  document.getElementById("timeline-next").addEventListener("click", () => {
    viewport.scrollBy({ left: 160, behavior: "smooth" });
  });
}

// ── Cronômetro ───────────────────────────────────────────────────────────────
const stopwatchState = { running: false, startedAt: 0, elapsedMs: 0, timer: null };
function formatStopwatch(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}
function updateStopwatchDisplay() {
  const current = stopwatchState.elapsedMs + (stopwatchState.running ? Date.now() - stopwatchState.startedAt : 0);
  document.getElementById("stopwatch-display").textContent = formatStopwatch(current);
}
function setupStopwatch() {
  const toggleBtn = document.getElementById("stopwatch-toggle");
  const resetBtn = document.getElementById("stopwatch-reset");
  toggleBtn.addEventListener("click", () => {
    if (stopwatchState.running) {
      stopwatchState.elapsedMs += Date.now() - stopwatchState.startedAt;
      stopwatchState.running = false;
      clearInterval(stopwatchState.timer);
      toggleBtn.textContent = "▶";
      toggleBtn.setAttribute("aria-label", "Iniciar cronômetro");
    } else {
      stopwatchState.startedAt = Date.now();
      stopwatchState.running = true;
      stopwatchState.timer = setInterval(updateStopwatchDisplay, 500);
      toggleBtn.textContent = "⏸";
      toggleBtn.setAttribute("aria-label", "Pausar cronômetro");
    }
  });
  resetBtn.addEventListener("click", () => {
    stopwatchState.running = false;
    stopwatchState.elapsedMs = 0;
    clearInterval(stopwatchState.timer);
    toggleBtn.textContent = "▶";
    toggleBtn.setAttribute("aria-label", "Iniciar cronômetro");
    updateStopwatchDisplay();
  });
}

function renderMonthGoal() {
  const monthKey = monthKeyFromDayKey(toDayKey(state.calendarCursor));
  const monthLabel = formatMonthLong(monthKey);
  const goal = getMonthlyGoal(monthKey);
  const revenue = getMonthRevenue(monthKey);
  const monthStats = computeMonthMetrics(monthKey);
  document.getElementById("month-total-consults").textContent = String(monthStats.total);
  document.getElementById("month-total-breakdown").textContent =
    monthStats.total > 0
      ? TYPE_KEYS.map((t) => `${TYPE_META[t].label}: ${monthStats.counts[t]}`).join(" | ")
      : "Nenhum atendimento ainda";
  document.getElementById("month-goal-title").textContent = `Meta do mês (${monthLabel})`;
  document.getElementById("month-goal-achieved").textContent = `Acumulado: ${formatCurrency(revenue)}`;
  const goalValueEl = document.getElementById("month-goal-value");
  const remainingEl = document.getElementById("month-goal-remaining");
  const progressEl = document.getElementById("month-goal-progress");
  document.getElementById("monthly-target").value = goal === null ? "" : String(goal);
  if (goal === null) {
    goalValueEl.textContent = "Não definida";
    remainingEl.textContent = "Defina uma meta";
    progressEl.textContent = "";
    return;
  }
  goalValueEl.textContent = formatCurrency(goal);
  const remaining = goal - revenue;
  remainingEl.textContent = remaining > 0 ? formatCurrency(remaining) : `Meta batida (+${formatCurrency(Math.abs(remaining))})`;
  const progress = goal > 0 ? (revenue / goal) * 100 : revenue > 0 ? 100 : 0;
  progressEl.textContent = `Progresso: ${progress.toFixed(1)}%`;
}

function destroyChart(key) {
  if (state.charts[key]) { state.charts[key].destroy(); state.charts[key] = null; }
}

function getWeekSeries(anchorDayKey) {
  const anchor = parseDayKey(anchorDayKey);
  const offset = (anchor.getDay() + 6) % 7;
  const start = new Date(anchor);
  start.setDate(anchor.getDate() - offset);
  const labels = [];
  const totals = [];
  const revenues = [];
  for (let i = 0; i < 7; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const metrics = computeDayMetrics(toDayKey(date));
    labels.push(date.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit" }));
    totals.push(metrics.total);
    revenues.push(metrics.revenue);
  }
  return { labels, totals, revenues };
}

function getMonthSeries(anchorDayKey) {
  const date = parseDayKey(anchorDayKey);
  const y = date.getFullYear();
  const m = date.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const labels = [];
  const totals = [];
  const revenues = [];
  for (let d = 1; d <= daysInMonth; d += 1) {
    const metrics = computeDayMetrics(toDayKey(new Date(y, m, d)));
    labels.push(String(d));
    totals.push(metrics.total);
    revenues.push(metrics.revenue);
  }
  return { labels, totals, revenues };
}

function renderCharts(dayMetrics) {
  destroyChart("day");
  destroyChart("week");
  destroyChart("month");

  state.charts.day = new Chart(document.getElementById("day-chart"), {
    type: "doughnut",
    data: {
      labels: TYPE_KEYS.map((t) => TYPE_META[t].label),
      datasets: [{ data: TYPE_KEYS.map((t) => dayMetrics.counts[t]), backgroundColor: TYPE_KEYS.map((t) => typeChartColor(t)) }],
    },
    options: { plugins: { legend: { position: "bottom" } } },
  });

  const week = getWeekSeries(state.selectedDateKey);
  state.charts.week = new Chart(document.getElementById("week-chart"), {
    data: {
      labels: week.labels,
      datasets: [
        { type: "bar", label: "Faturamento", data: week.revenues, backgroundColor: chartColor("verdeFill"), yAxisID: "y" },
        { type: "line", label: "Atendimentos", data: week.totals, borderColor: chartColor("laranja"), backgroundColor: chartColor("laranja"), tension: 0.25, yAxisID: "y1" },
      ],
    },
    options: {
      plugins: { legend: { position: "bottom" } },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: "R$" } },
        y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "Qtd" } },
      },
    },
  });

  const month = getMonthSeries(state.selectedDateKey);
  state.charts.month = new Chart(document.getElementById("month-chart"), {
    data: {
      labels: month.labels,
      datasets: [
        { type: "bar", label: "Atendimentos", data: month.totals, backgroundColor: chartColor("tealFill"), yAxisID: "y" },
        { type: "line", label: "Faturamento", data: month.revenues, borderColor: chartColor("verde"), backgroundColor: chartColor("verde"), tension: 0.22, yAxisID: "y1" },
      ],
    },
    options: {
      plugins: { legend: { position: "bottom" } },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: "Qtd" } },
        y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "R$" } },
      },
    },
  });
}

function renderAll() {
  if (!state.user) return;
  document.getElementById("session-user-label").textContent = `Logado como: ${state.user.email}`;
  renderConsultTypeButtons();
  const metrics = computeDayMetrics(state.selectedDateKey);
  renderMetrics(metrics);
  renderTimeline(metrics.records);
  renderDayList(metrics.records);
  renderCalendar();
  renderMonthGoal();
  renderCharts(metrics);
  const prices = getTypePrices();
  document.getElementById("price-adulto").value = String(prices.adulto);
  document.getElementById("price-pediatria").value = String(prices.pediatria);
  document.getElementById("price-one").value = String(prices.one);
  document.getElementById("manual-date").value = state.selectedDateKey;
  const manualTime = document.getElementById("manual-time");
  if (!manualTime.value) manualTime.value = toTimeInputValue(Date.now());
}

// ── Modal: editar atendimento ────────────────────────────────────────────────
function openEditRecordModal(recordId) {
  const location = findRecordLocationById(recordId);
  if (!location) return;
  state.editingRecordId = recordId;
  document.getElementById("edit-record-name").value = location.record.name || "";
  document.getElementById("edit-record-date").value = toDayKey(new Date(location.record.ts));
  document.getElementById("edit-record-time").value = toTimeInputValue(location.record.ts);
  document.getElementById("edit-record-type").value = location.record.type;
  document.getElementById("edit-record-atestado").checked = location.record.atestado === true;
  document.getElementById("edit-record-price").value = String(getRecordPrice(location.record));
  const overlay = document.getElementById("edit-record-modal");
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
}
function closeEditRecordModal() {
  state.editingRecordId = null;
  const overlay = document.getElementById("edit-record-modal");
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
}
function saveEditedRecord() {
  if (!state.editingRecordId) return;
  const location = findRecordLocationById(state.editingRecordId);
  if (!location) { closeEditRecordModal(); return; }

  const newName = document.getElementById("edit-record-name").value;
  const newDayKey = document.getElementById("edit-record-date").value;
  const newTime = document.getElementById("edit-record-time").value;
  const newType = document.getElementById("edit-record-type").value;
  const newAtestado = document.getElementById("edit-record-atestado").checked;
  const newPrice = Number(document.getElementById("edit-record-price").value);
  if (!newDayKey || !newTime || !TYPE_META[newType] || !Number.isFinite(newPrice) || newPrice < 0) return;
  const newTs = toTimestampFromDayAndTime(newDayKey, newTime);

  const oldDayKey = location.dayKey;
  deleteRecordById(state.editingRecordId);
  if (!state.data.days[newDayKey]) state.data.days[newDayKey] = [];
  state.data.days[newDayKey].push({
    id: state.editingRecordId,
    type: newType,
    ts: newTs,
    atestado: newAtestado,
    price: newPrice,
    plantaoCategory: newType === "plantao" ? getShiftCategoryForTs(newTs) : null,
    plantaoManual: false,
    name: typeof newName === "string" ? newName.trim().slice(0, 80) : "",
  });
  markDayDirty(newDayKey);
  if (newType === "plantao") recalcPlantaoPricingForDay(newDayKey);
  else if (oldDayKey === newDayKey) recalcPlantaoPricingForDay(newDayKey);
  if (oldDayKey !== newDayKey) recalcPlantaoPricingForDay(oldDayKey);

  state.selectedDateKey = newDayKey;
  state.calendarCursor = startOfMonth(parseDayKey(newDayKey));
  scheduleSave();
  renderAll();
  closeEditRecordModal();
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function showAuthMessage(msg, isError = false) {
  const el = document.getElementById("auth-message");
  el.textContent = msg || "";
  el.style.color = isError ? "var(--danger)" : "var(--muted)";
}
function setAuthMode(mode) {
  document.getElementById("login-form").classList.toggle("hidden", mode !== "login");
  document.getElementById("register-form").classList.toggle("hidden", mode !== "register");
}
function showAuthScreen() {
  document.getElementById("auth-screen").classList.remove("hidden");
  document.getElementById("app-shell").classList.add("hidden");
}
function showAppScreen() {
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app-shell").classList.remove("hidden");
}

async function tryRestoreSession() {
  try {
    const payload = await api("/auth/session");
    state.user = payload.user;
    state.data = normalizeData(payload.data);
    state.dirtyDays.clear();
    state.dirtySettings = false;
    showAppScreen();
    renderAll();
    return true;
  } catch (err) {
    return false;
  }
}
function normalizeData(raw) {
  const base = emptyData();
  if (!raw || typeof raw !== "object") return base;
  base.days = raw.days && typeof raw.days === "object" ? raw.days : {};
  base.settings.typePrices = { ...base.settings.typePrices, ...(raw.settings?.typePrices || {}) };
  base.settings.monthlyGoals = raw.settings?.monthlyGoals && typeof raw.settings.monthlyGoals === "object" ? raw.settings.monthlyGoals : {};
  return base;
}

function bindEvents() {
  document.querySelectorAll(".password-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = btn.previousElementSibling;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.textContent = show ? "🙈" : "👁";
    });
  });

  document.getElementById("show-register-btn").addEventListener("click", () => { setAuthMode("register"); showAuthMessage(""); });
  document.getElementById("show-login-btn").addEventListener("click", () => { setAuthMode("login"); showAuthMessage(""); });

  document.getElementById("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;
    try {
      const payload = await api("/auth/login", { method: "POST", body: { email, password } });
      state.user = payload.user;
      state.data = normalizeData(payload.data);
      state.dirtyDays.clear();
      state.dirtySettings = false;
      showAuthMessage("");
      showAppScreen();
      renderAll();
    } catch (err) {
      showAuthMessage(err.message, true);
    }
  });

  document.getElementById("register-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = document.getElementById("register-email").value;
    const password = document.getElementById("register-password").value;
    try {
      const payload = await api("/auth/register", { method: "POST", body: { email, password } });
      showAuthMessage(payload.message || "Cadastro criado. Faça login.");
      document.getElementById("login-email").value = email.trim().toLowerCase();
      setAuthMode("login");
    } catch (err) {
      showAuthMessage(err.message, true);
    }
  });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await flushSave();
    try { await api("/auth/logout", { method: "POST" }); } catch (e) {}
    state.user = null;
    state.data = emptyData();
    state.dirtyDays.clear();
    state.dirtySettings = false;
    showAuthScreen();
  });

  document.getElementById("undo-btn").addEventListener("click", undoLastFromSelectedDay);

  document.getElementById("prev-month").addEventListener("click", () => {
    state.calendarCursor = new Date(state.calendarCursor.getFullYear(), state.calendarCursor.getMonth() - 1, 1);
    renderAll();
  });
  document.getElementById("next-month").addEventListener("click", () => {
    state.calendarCursor = new Date(state.calendarCursor.getFullYear(), state.calendarCursor.getMonth() + 1, 1);
    renderAll();
  });

  const priceInputs = {
    adulto: document.getElementById("price-adulto"),
    pediatria: document.getElementById("price-pediatria"),
    one: document.getElementById("price-one"),
  };
  const persistPrices = () => {
    const current = getTypePrices();
    const next = { ...current };
    for (const type of Object.keys(priceInputs)) {
      const value = Number(priceInputs[type].value);
      if (!Number.isFinite(value) || value < 0) { priceInputs[type].value = String(current[type]); continue; }
      next[type] = value;
    }
    state.data.settings.typePrices = next;
    markSettingsDirty();
    scheduleSave();
    renderAll();
  };
  Object.values(priceInputs).forEach((input) => input.addEventListener("change", persistPrices));
  document.getElementById("type-prices-form").addEventListener("submit", (e) => { e.preventDefault(); persistPrices(); });

  document.getElementById("monthly-target").addEventListener("change", (event) => {
    const monthKey = monthKeyFromDayKey(toDayKey(state.calendarCursor));
    const raw = String(event.target.value).trim();
    if (raw === "") { setMonthlyGoal(monthKey, null); scheduleSave(); renderAll(); return; }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) { renderAll(); return; }
    setMonthlyGoal(monthKey, value);
    scheduleSave();
    renderAll();
  });

  document.getElementById("manual-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const dayKey = document.getElementById("manual-date").value;
    const time = document.getElementById("manual-time").value;
    const type = document.getElementById("manual-type").value;
    const atestado = document.getElementById("manual-atestado").checked;
    const name = document.getElementById("manual-name").value;
    if (!dayKey || !time || !TYPE_META[type]) return;
    const ts = toTimestampFromDayAndTime(dayKey, time);
    addRecord(dayKey, ts, type, atestado, name);
    state.selectedDateKey = dayKey;
    state.calendarCursor = startOfMonth(parseDayKey(dayKey));
    document.getElementById("manual-atestado").checked = false;
    document.getElementById("manual-name").value = "";
    scheduleSave();
    renderAll();
  });

  const editOverlay = document.getElementById("edit-record-modal");
  document.getElementById("close-edit-record-modal").addEventListener("click", closeEditRecordModal);
  editOverlay.addEventListener("click", (e) => { if (e.target === editOverlay) closeEditRecordModal(); });
  document.getElementById("edit-record-form").addEventListener("submit", (e) => { e.preventDefault(); saveEditedRecord(); });
  document.getElementById("delete-record-btn").addEventListener("click", () => {
    if (!state.editingRecordId) return;
    deleteRecordById(state.editingRecordId);
    scheduleSave();
    renderAll();
    closeEditRecordModal();
  });

  const yearlyOverlay = document.getElementById("yearly-summary-modal");
  document.getElementById("open-yearly-summary-btn").addEventListener("click", openYearlySummaryModal);
  document.getElementById("close-yearly-summary-modal").addEventListener("click", closeYearlySummaryModal);
  yearlyOverlay.addEventListener("click", (e) => { if (e.target === yearlyOverlay) closeYearlySummaryModal(); });
  document.getElementById("yearly-summary-prev").addEventListener("click", () => {
    state.yearlySummaryYear -= 1;
    renderYearlySummary();
  });
  document.getElementById("yearly-summary-next").addEventListener("click", () => {
    state.yearlySummaryYear += 1;
    renderYearlySummary();
  });
  document.getElementById("export-month-csv").addEventListener("click", () => {
    const monthKey = document.getElementById("export-month-select").value;
    if (monthKey) exportMonthCSV(monthKey);
  });
  document.getElementById("export-month-pdf").addEventListener("click", () => {
    const monthKey = document.getElementById("export-month-select").value;
    if (monthKey) exportMonthPDF(monthKey);
  });

  const passwordOverlay = document.getElementById("password-modal");
  document.getElementById("change-password-btn").addEventListener("click", () => {
    document.getElementById("current-password").value = "";
    document.getElementById("new-password").value = "";
    document.getElementById("password-message").textContent = "";
    passwordOverlay.classList.remove("hidden");
    passwordOverlay.setAttribute("aria-hidden", "false");
  });
  document.getElementById("close-password-modal").addEventListener("click", () => {
    passwordOverlay.classList.add("hidden");
    passwordOverlay.setAttribute("aria-hidden", "true");
  });
  passwordOverlay.addEventListener("click", (e) => {
    if (e.target === passwordOverlay) { passwordOverlay.classList.add("hidden"); passwordOverlay.setAttribute("aria-hidden", "true"); }
  });
  document.getElementById("password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const currentPassword = document.getElementById("current-password").value;
    const newPassword = document.getElementById("new-password").value;
    const msgEl = document.getElementById("password-message");
    try {
      const payload = await api("/auth/change-password", { method: "POST", body: { currentPassword, newPassword } });
      msgEl.style.color = "var(--accent)";
      msgEl.textContent = payload.message || "Senha atualizada.";
    } catch (err) {
      msgEl.style.color = "var(--danger)";
      msgEl.textContent = err.message;
    }
  });

  window.addEventListener("beforeunload", () => {
    if (state.saveTimer && (state.dirtyDays.size || state.dirtySettings)) {
      // Melhor esforço: tenta enviar só as mudanças pendentes antes de fechar a aba.
      const daysPayload = {};
      const removedDays = [];
      for (const dayKey of state.dirtyDays) {
        const records = state.data.days[dayKey];
        if (records && records.length) daysPayload[dayKey] = records;
        else removedDays.push(dayKey);
      }
      const body = { days: daysPayload, removedDays };
      if (state.dirtySettings) body.settings = state.data.settings;
      navigator.sendBeacon?.("/api/data/save", new Blob([JSON.stringify(body)], { type: "application/json" }));
    }
  });
}

async function initApp() {
  setupThemeToggle();
  setupPaletteToggle();
  setupStopwatch();
  setupTimelineNav();
  setupDayListToggle();
  setupShiftOverride();
  bindEvents();
  if (!(await tryRestoreSession())) showAuthScreen();
}

initApp();
