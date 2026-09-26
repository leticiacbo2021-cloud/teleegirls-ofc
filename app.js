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
// Ordem de exibição dos turnos na Escala de plantões (independe da ordem de SHIFT_PRICING).
const SCHEDULE_SHIFT_ORDER = ["m", "t", "reforco", "noturno"];

// Modo combinado M+T: quando os dois turnos estão marcados juntos no seletor
// "Plantão ativo no registro", os atendimentos de M e T do dia compartilham
// um único limite (60) em vez de 30 cada um separadamente.
const MT_COMBO_PRICING = { label: "M+T", threshold: 60, initial: 20, extra: 15 };
// Atendimento de madrugada (00:00–07:00) SEM o turno Noturno marcado manualmente:
// fica em R$ 20 fixo (sem escalonar pra R$ 28), porque a diária de R$ 28 exige
// Noturno marcado. Conta numa faixa própria ("noturno_auto"), separada da faixa
// oficial do Noturno marcado — assim um atendimento não-marcado nunca consome
// o limite de 25 atendimentos da diária de R$ 28.
const AUTO_NOTURNO_PRICING = { label: "Noturno (automático)", threshold: Infinity, initial: 20, extra: 20 };

// ── Emprego 2 (plantões por hora, fora do Painel de Consultas) ──────────────
// Percentuais padrão de desconto, estimados a partir dos extratos de repasse
// analisados: INSS ~20% sobre o bruto e, sobre o restante, um IRRF efetivo
// médio de ~9,7%. Ambos ficam editáveis na interface, pois a alíquota de
// IRRF é progressiva e pode variar conforme a faixa de renda do mês.
const JOB2_DEFAULT_INSS_PERCENT = 20;
const JOB2_DEFAULT_IRRF_PERCENT = 9.7;
// Valor/hora padrão diurno e noturno, calculado a partir da média dos
// extratos de repasse da COAPH analisados (várias linhas "Diurno" e
// "Noturno" já divididas pela própria cooperativa, valor ÷ horas de cada
// linha). Fica editável na interface — ajuste se a tabela da cooperativa
// mudar — mas por padrão o app já calcula sozinho, sem precisar reenviar
// o extrato a cada plantão.
const JOB2_DEFAULT_DAY_RATE = 120.21;
const JOB2_DEFAULT_NIGHT_RATE = 129.47;
const JOB2_CATEGORY_META = { generalista: "Generalista", prep: "Prep" };
function getPricingConfigForGroup(group) {
  if (group === "mt") return MT_COMBO_PRICING;
  if (group === "noturno_auto") return AUTO_NOTURNO_PRICING;
  return SHIFT_PRICING[group];
}
// Decide o turno de exibição (category) e o "grupo de preço" (pricingGroup)
// de um atendimento de plantão, considerando o turno travado manualmente
// no momento do registro (forcedShiftCategory: "m" | "t" | "mt" | "reforco" | "noturno" | null).
function resolvePlantaoAssignment(ts, forcedShiftCategory) {
  const autoCategory = getShiftCategoryForTs(ts);
  const autoGroup = autoCategory === "noturno" ? "noturno_auto" : autoCategory;
  if (!forcedShiftCategory) {
    return { category: autoCategory, pricingGroup: autoGroup, manual: false };
  }
  if (forcedShiftCategory === "mt") {
    if (autoCategory === "m" || autoCategory === "t") {
      return { category: autoCategory, pricingGroup: "mt", manual: true };
    }
    // Fora da janela 07:00–19:00 (ex.: registro manual em outro horário com M+T ainda
    // marcados): ignora a combinação e usa o turno normal pelo horário.
    return { category: autoCategory, pricingGroup: autoGroup, manual: false };
  }
  if (SHIFT_PRICING[forcedShiftCategory]) {
    return { category: forcedShiftCategory, pricingGroup: forcedShiftCategory, manual: true };
  }
  return { category: autoCategory, pricingGroup: autoGroup, manual: false };
}

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
  // Escala de plantões: visão de calendário dedicada aos turnos de Plantão.
  scheduleView: "month", // "month" | "week"
  scheduleCursor: startOfMonth(new Date()),
  scheduleSelectedDayKey: null,
  // Mini-calendário de registro do Emprego 2: mês exibido e dia selecionado
  // para o próximo plantão a registrar.
  job2Cursor: startOfMonth(new Date()),
  job2SelectedDate: toDayKey(new Date()),
  // Plantões reconhecidos automaticamente a partir de uma foto do extrato,
  // pendentes de revisão antes de virarem registros de verdade.
  job2ImportRows: [],
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
      // Planejamento pessoal de plantões futuros: dayKey -> ["m","t",...].
      // É só um lembrete visual na Escala — não afeta preço nem contagem.
      plantaoPlan: {},
      // Emprego 2: plantões de outro trabalho, pagos por hora. Guardado à
      // parte dos atendimentos (days) porque não tem preço escalonado nem
      // tipo — é só data/hora de início e fim. O valor é calculado sozinho
      // a partir do valor/hora diurno e noturno configurado abaixo (não
      // fica salvo em cada plantão, então se a tabela mudar é só ajustar
      // aqui uma vez).
      job2: {
        records: {}, // dayKey -> [{ id, startTs, endTs, category }]
        dayRate: JOB2_DEFAULT_DAY_RATE,
        nightRate: JOB2_DEFAULT_NIGHT_RATE,
        inssPercent: JOB2_DEFAULT_INSS_PERCENT,
        irrfPercent: JOB2_DEFAULT_IRRF_PERCENT,
      },
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
function startOfWeek(date) {
  const offset = (date.getDay() + 6) % 7; // semana começa na segunda
  const start = new Date(date);
  start.setDate(date.getDate() - offset);
  return start;
}
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
  // "mt" é um contador à parte (modo combinado M+T) e "noturno_auto" é a
  // madrugada sem o turno Noturno marcado manualmente (R$ 20 fixo, não entra
  // na faixa oficial de 25 atendimentos a R$ 28 do Noturno marcado).
  const counters = { noturno: 0, noturno_auto: 0, m: 0, t: 0, reforco: 0, mt: 0 };
  for (const record of records) {
    if (record.type !== "plantao") continue;
    const autoCategory = getShiftCategoryForTs(record.ts);
    let category;
    let group;
    if (record.plantaoManual && record.plantaoPricingGroup === "mt") {
      category = autoCategory;
      group = "mt";
    } else if (record.plantaoManual && SHIFT_PRICING[record.plantaoPricingGroup]) {
      category = record.plantaoPricingGroup;
      group = record.plantaoPricingGroup;
    } else {
      category = autoCategory;
      group = autoCategory === "noturno" ? "noturno_auto" : autoCategory;
    }
    counters[group] += 1;
    const cfg = getPricingConfigForGroup(group);
    record.plantaoCategory = category;
    record.plantaoPricingGroup = group;
    record.price = counters[group] <= cfg.threshold ? cfg.initial : cfg.extra;
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
// travado manualmente em "Plantão ativo no registro" (inclusive o modo
// combinado M+T), se houver.
function getPendingPlantaoPrice() {
  const now = Date.now();
  const dayKey = toDayKey(new Date(now));
  const autoCategory = getShiftCategoryForTs(now);
  let category = autoCategory;
  let group = autoCategory === "noturno" ? "noturno_auto" : autoCategory;
  if (state.manualShiftOverride === "mt" && (autoCategory === "m" || autoCategory === "t")) {
    group = "mt";
  } else if (state.manualShiftOverride && SHIFT_PRICING[state.manualShiftOverride]) {
    category = state.manualShiftOverride;
    group = state.manualShiftOverride;
  }
  const cfg = getPricingConfigForGroup(group);
  const countSoFar = getDayRecords(dayKey).filter(
    (r) => r.type === "plantao" && r.plantaoPricingGroup === group
  ).length;
  const nextIndex = countSoFar + 1;
  return { category, group, price: nextIndex <= cfg.threshold ? cfg.initial : cfg.extra };
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
  const assignment = isPlantao ? resolvePlantaoAssignment(ts, forcedShiftCategory) : null;
  const record = {
    id: createId(),
    type,
    ts,
    atestado: atestado === true,
    price: isPlantao ? 0 : prices[type] || 0,
    plantaoCategory: isPlantao ? assignment.category : null,
    plantaoPricingGroup: isPlantao ? assignment.pricingGroup : null,
    plantaoManual: isPlantao ? assignment.manual : false,
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

// Totais de atestado do mês, gerais e por tipo de atendimento (Adulto,
// Pediatria, ONE, Plantão). Usado pelo painel "Atendimentos com e sem
// atestado no mês".
function computeMonthAtestadoSummary(monthKey) {
  const perType = {};
  for (const t of TYPE_KEYS) perType[t] = { com: 0, sem: 0 };
  let totalCom = 0;
  let totalSem = 0;
  for (const [dayKey, records] of Object.entries(state.data.days)) {
    if (!dayKey.startsWith(`${monthKey}-`)) continue;
    for (const r of records) {
      if (r.atestado) { perType[r.type].com += 1; totalCom += 1; }
      else { perType[r.type].sem += 1; totalSem += 1; }
    }
  }
  return { perType, totalCom, totalSem, totalAll: totalCom + totalSem };
}

// Resumo dos atendimentos de Plantão de um dia, agrupados por turno (M/T/Reforço/Noturno).
// Usado pela Escala de plantões — não afeta o cálculo de preço, só exibe o que já está salvo.
function computeDayPlantaoBreakdown(dayKey) {
  const breakdown = {};
  for (const key of Object.keys(SHIFT_PRICING)) breakdown[key] = { count: 0, revenue: 0 };
  const records = getDayRecords(dayKey).filter((r) => r.type === "plantao");
  for (const r of records) {
    const cat = r.plantaoCategory && SHIFT_PRICING[r.plantaoCategory] ? r.plantaoCategory : getShiftCategoryForTs(r.ts);
    breakdown[cat].count += 1;
    breakdown[cat].revenue += getRecordPrice(r);
  }
  const total = records.length;
  const revenue = records.reduce((s, r) => s + getRecordPrice(r), 0);
  return { breakdown, total, revenue };
}

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

// ── Emprego 2 (plantões por hora) ────────────────────────────────────────────
function getJob2Settings() { return state.data.settings.job2; }
function getJob2Records(dayKey) { return state.data.settings.job2.records[dayKey] || []; }

// Converte data + hora de início/fim em timestamps. Se o fim for menor ou
// igual ao início, assume que o plantão passou da meia-noite (dura até o dia
// seguinte).
function job2Timestamps(dayKey, startTime, endTime) {
  const startTs = toTimestampFromDayAndTime(dayKey, startTime);
  let endTs = toTimestampFromDayAndTime(dayKey, endTime);
  if (endTs <= startTs) endTs += 24 * MS_HOUR;
  return { startTs, endTs };
}

// Corte diurno/noturno do Emprego 2: como nos extratos da cooperativa, tudo
// entre 07:00 e 19:00 é "diurno" e o restante (19:00–07:00) é "noturno".
// Um plantão pode cruzar mais de uma fronteira (ex.: 17h–23h tem 2h diurnas
// e 4h noturnas) — por isso soma-se por trechos em vez de olhar só o início.
const JOB2_DAY_START_MIN = 7 * 60; // 07:00
const JOB2_DAY_END_MIN = 19 * 60; // 19:00
function computeDayNightHours(startTs, endTs) {
  let dayMs = 0;
  let nightMs = 0;
  let cursor = startTs;
  let guard = 0;
  while (cursor < endTs && guard < 200) {
    guard += 1;
    const d = new Date(cursor);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const minutesOfDay = (cursor - dayStart) / 60000;
    let isDay;
    let nextBoundaryMin;
    if (minutesOfDay >= JOB2_DAY_START_MIN && minutesOfDay < JOB2_DAY_END_MIN) {
      isDay = true;
      nextBoundaryMin = JOB2_DAY_END_MIN;
    } else if (minutesOfDay >= JOB2_DAY_END_MIN) {
      isDay = false;
      nextBoundaryMin = 24 * 60 + JOB2_DAY_START_MIN;
    } else {
      isDay = false;
      nextBoundaryMin = JOB2_DAY_START_MIN;
    }
    const nextBoundaryTs = dayStart + nextBoundaryMin * 60000;
    const segmentEnd = Math.min(endTs, nextBoundaryTs);
    const segMs = Math.max(0, segmentEnd - cursor);
    if (isDay) dayMs += segMs; else nightMs += segMs;
    cursor = segmentEnd;
  }
  return { dayHours: dayMs / MS_HOUR, nightHours: nightMs / MS_HOUR };
}

function addJob2Record(dayKey, startTs, endTs, category) {
  const job2 = getJob2Settings();
  if (!job2.records[dayKey]) job2.records[dayKey] = [];
  const record = {
    id: createId(),
    startTs,
    endTs,
    category: category === "prep" ? "prep" : "generalista",
  };
  job2.records[dayKey].push(record);
  markSettingsDirty();
  return record;
}

function deleteJob2Record(dayKey, recordId) {
  const job2 = getJob2Settings();
  const records = job2.records[dayKey];
  if (!records) return;
  const idx = records.findIndex((r) => r.id === recordId);
  if (idx === -1) return;
  records.splice(idx, 1);
  if (!records.length) delete job2.records[dayKey];
  markSettingsDirty();
}

function getJob2RecordHours(record) { return Math.max(0, (record.endTs - record.startTs) / MS_HOUR); }
// Valor bruto do plantão: horas diurnas × valor/hora diurno configurado +
// horas noturnas × valor/hora noturno configurado. O valor/hora não fica
// salvo em cada plantão — vem sempre da configuração atual (Emprego 2 →
// "Ajustar valor/hora"), calculada por padrão a partir dos extratos da
// cooperativa. Assim, se a tabela mudar, basta ajustar uma vez.
function getJob2RecordGross(record) {
  const job2 = getJob2Settings();
  const { dayHours, nightHours } = computeDayNightHours(record.startTs, record.endTs);
  return dayHours * (Number(job2.dayRate) || 0) + nightHours * (Number(job2.nightRate) || 0);
}

// Estima o valor líquido a partir do bruto, aplicando primeiro o desconto de
// INSS e, sobre o que sobra, o IRRF efetivo — replicando a ordem de cálculo
// que aparece nos extratos de repasse (Base IRRF = bruto - INSS).
function computeJob2NetFromGross(gross) {
  const job2 = getJob2Settings();
  const inssPct = Number(job2.inssPercent) || 0;
  const irrfPct = Number(job2.irrfPercent) || 0;
  const afterInss = gross * (1 - inssPct / 100);
  return afterInss * (1 - irrfPct / 100);
}

function computeJob2MonthMetrics(monthKey) {
  let hours = 0;
  let gross = 0;
  let shifts = 0;
  const records = getJob2Settings().records;
  for (const [dayKey, dayRecords] of Object.entries(records)) {
    if (!dayKey.startsWith(`${monthKey}-`)) continue;
    for (const r of dayRecords) {
      hours += getJob2RecordHours(r);
      gross += getJob2RecordGross(r);
      shifts += 1;
    }
  }
  return { hours, gross, net: computeJob2NetFromGross(gross), shifts };
}

// Todos os plantões do Emprego 2 de um mês, ordenados cronologicamente, com o
// dayKey embutido em cada item (útil pra listar e excluir).
function getJob2MonthRecordsFlat(monthKey) {
  const out = [];
  const records = getJob2Settings().records;
  for (const [dayKey, dayRecords] of Object.entries(records)) {
    if (!dayKey.startsWith(`${monthKey}-`)) continue;
    for (const r of dayRecords) out.push({ ...r, dayKey });
  }
  out.sort((a, b) => a.startTs - b.startTs);
  return out;
}

// ── Importar plantões do Emprego 2 automaticamente de uma foto ─────────────
// Lê o texto de uma imagem (print da área do cooperado, com colunas "Data
// Entrada" / "Data Saída") via OCR no navegador e tenta reconhecer pares de
// data+hora em sequência. Cada par vira uma linha de prévia editável — nada
// é salvo até o usuário conferir e clicar em "Adicionar plantões selecionados".
function parseJob2ImportText(text) {
  const re = /(\d{2})\/(\d{2})\/(\d{4})\D{0,4}(\d{1,2}):(\d{2})/g;
  const matches = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, dd, mm, yyyy, hh, min] = m;
    const hour = hh.padStart(2, "0");
    if (Number(dd) < 1 || Number(dd) > 31 || Number(mm) < 1 || Number(mm) > 12) continue;
    if (Number(hour) > 23 || Number(min) > 59) continue;
    matches.push({ dayKey: `${yyyy}-${mm}-${dd}`, time: `${hour}:${min}` });
  }
  const rows = [];
  for (let i = 0; i + 1 < matches.length; i += 2) {
    const entrada = matches[i];
    const saida = matches[i + 1];
    rows.push({
      id: createId(),
      dayKey: entrada.dayKey,
      startTime: entrada.time,
      endTime: saida.time,
      include: true,
    });
  }
  return rows;
}

async function processJob2ImportImage(file) {
  const statusEl = document.getElementById("job2-import-status");
  if (!statusEl) return;
  if (!file) { statusEl.textContent = "Selecione uma imagem primeiro."; return; }
  if (typeof Tesseract === "undefined") {
    statusEl.textContent = "Não foi possível carregar o leitor de imagem. Verifique sua conexão e tente de novo.";
    return;
  }
  statusEl.textContent = "Lendo imagem... isso pode levar alguns segundos.";
  state.job2ImportRows = [];
  renderJob2ImportPreview();
  try {
    const { data } = await Tesseract.recognize(file, "por", {
      logger: (m) => {
        if (m.status === "recognizing text" && typeof m.progress === "number") {
          statusEl.textContent = `Lendo imagem... ${Math.round(m.progress * 100)}%`;
        }
      },
    });
    const rows = parseJob2ImportText(data?.text || "");
    state.job2ImportRows = rows;
    renderJob2ImportPreview();
    statusEl.textContent = rows.length
      ? `${rows.length} plantão${rows.length > 1 ? "ões" : ""} encontrados. Confira as datas/horários antes de adicionar — o OCR pode errar em fotos com letra pequena.`
      : "Não consegui reconhecer nenhum par de entrada/saída nessa imagem. Tente uma foto mais nítida, mais próxima da tabela e bem iluminada.";
  } catch (err) {
    statusEl.textContent = "Erro ao ler a imagem. Tente novamente.";
  }
}

function renderJob2ImportPreview() {
  const previewEl = document.getElementById("job2-import-preview");
  if (!previewEl) return;
  previewEl.innerHTML = "";
  if (!state.job2ImportRows.length) return;

  const list = document.createElement("ul");
  list.className = "day-list";
  for (const row of state.job2ImportRows) {
    const li = document.createElement("li");
    const rowDiv = document.createElement("div");
    rowDiv.className = "day-row";
    const main = document.createElement("div");
    main.className = "day-main";
    main.innerHTML = `
      <label class="manual-check">
        <input type="checkbox" class="job2-import-include" data-id="${row.id}" ${row.include ? "checked" : ""} />
        Incluir
      </label>
      <input type="date" class="job2-import-date" data-id="${row.id}" value="${row.dayKey}" />
      <input type="time" class="job2-import-start" data-id="${row.id}" value="${row.startTime}" />
      <span>até</span>
      <input type="time" class="job2-import-end" data-id="${row.id}" value="${row.endTime}" />
    `;
    rowDiv.appendChild(main);
    li.appendChild(rowDiv);
    list.appendChild(li);
  }
  previewEl.appendChild(list);

  previewEl.querySelectorAll(".job2-import-include").forEach((input) => {
    input.addEventListener("change", () => {
      const row = state.job2ImportRows.find((r) => r.id === input.dataset.id);
      if (row) row.include = input.checked;
    });
  });
  previewEl.querySelectorAll(".job2-import-date").forEach((input) => {
    input.addEventListener("change", () => {
      const row = state.job2ImportRows.find((r) => r.id === input.dataset.id);
      if (row) row.dayKey = input.value;
    });
  });
  previewEl.querySelectorAll(".job2-import-start").forEach((input) => {
    input.addEventListener("change", () => {
      const row = state.job2ImportRows.find((r) => r.id === input.dataset.id);
      if (row) row.startTime = input.value;
    });
  });
  previewEl.querySelectorAll(".job2-import-end").forEach((input) => {
    input.addEventListener("change", () => {
      const row = state.job2ImportRows.find((r) => r.id === input.dataset.id);
      if (row) row.endTime = input.value;
    });
  });

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "ghost";
  addBtn.textContent = "Adicionar plantões selecionados";
  addBtn.addEventListener("click", addJob2ImportRows);
  previewEl.appendChild(addBtn);
}

function addJob2ImportRows() {
  const selected = state.job2ImportRows.filter((r) => r.include && r.dayKey && r.startTime && r.endTime);
  if (!selected.length) return;
  for (const row of selected) {
    const { startTs, endTs } = job2Timestamps(row.dayKey, row.startTime, row.endTime);
    addJob2Record(row.dayKey, startTs, endTs, "generalista");
  }
  state.job2ImportRows = [];
  renderJob2ImportPreview();
  const statusEl = document.getElementById("job2-import-status");
  if (statusEl) {
    statusEl.textContent = `${selected.length} plantão${selected.length > 1 ? "ões" : ""} adicionados. O valor já foi calculado automaticamente com o valor/hora diurno e noturno configurado.`;
  }
  const fileInput = document.getElementById("job2-import-file");
  if (fileInput) fileInput.value = "";
  scheduleSave();
  renderAll();
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
      const { category, group, price } = getPendingPlantaoPrice();
      let shiftLabel = SHIFT_PRICING[category].label;
      if (group === "mt") shiftLabel = `M+T (${SHIFT_PRICING[category].label})`;
      else if (group === "noturno_auto") shiftLabel = `${SHIFT_PRICING[category].label} (auto)`;
      header.textContent = `Plantão ${shiftLabel} (+${formatCurrency(price)})`;
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
// M e T podem ficar marcados ao mesmo tempo (modo combinado M+T, com limite
// compartilhado de 60). Reforço e Noturno continuam exclusivos: marcar um
// deles desmarca todos os outros, e marcar M ou T desmarca Reforço/Noturno.
// Desmarcar tudo volta ao modo automático (turno decidido pelo horário).
function setupShiftOverride() {
  const checks = document.querySelectorAll(".shift-override-check");
  checks.forEach((check) => {
    check.addEventListener("change", () => {
      const shift = check.dataset.shift;
      if (check.checked) {
        if (shift === "reforco" || shift === "noturno") {
          checks.forEach((other) => { if (other !== check) other.checked = false; });
        } else {
          checks.forEach((other) => {
            if (other !== check && (other.dataset.shift === "reforco" || other.dataset.shift === "noturno")) {
              other.checked = false;
            }
          });
        }
      }
      const checked = [...checks].filter((c) => c.checked).map((c) => c.dataset.shift);
      if (checked.length === 0) state.manualShiftOverride = null;
      else if (checked.includes("m") && checked.includes("t")) state.manualShiftOverride = "mt";
      else state.manualShiftOverride = checked[0];
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

// Corrige o turno de TODOS os atendimentos de Plantão já registrados no dia
// selecionado, aplicando de uma vez a marcação atual de "Plantão ativo no
// registro" (inclusive M+T combinado, ou nenhuma = volta ao automático).
// Útil quando o turno errado foi marcado e vários atendimentos já foram
// lançados — evita editar um por um.
function applyShiftOverrideToSelectedDay() {
  const dayKey = state.selectedDateKey;
  const records = getDayRecords(dayKey).filter((r) => r.type === "plantao");
  if (!records.length) return;
  const forced = state.manualShiftOverride;
  for (const record of records) {
    const assignment = resolvePlantaoAssignment(record.ts, forced);
    record.plantaoCategory = assignment.category;
    record.plantaoPricingGroup = assignment.pricingGroup;
    record.plantaoManual = assignment.manual;
  }
  recalcPlantaoPricingForDay(dayKey);
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

// ── Planejamento pessoal de plantões futuros (Escala) ───────────────────────
// Guarda só a intenção de trabalhar tal turno em tal dia — não vira
// atendimento nem afeta preço/contagem. Some sozinho da Escala assim que o
// dia tiver atendimentos reais registrados (a exibição prioriza o real).
function getPlantaoPlanForDay(dayKey) {
  const plan = state.data.settings.plantaoPlan || {};
  return Array.isArray(plan[dayKey]) ? plan[dayKey] : [];
}
function togglePlantaoPlanShift(dayKey, shift, checked) {
  if (!state.data.settings.plantaoPlan) state.data.settings.plantaoPlan = {};
  const plan = state.data.settings.plantaoPlan;
  const current = new Set(plan[dayKey] || []);
  if (checked) current.add(shift);
  else current.delete(shift);
  if (current.size) plan[dayKey] = SCHEDULE_SHIFT_ORDER.filter((s) => current.has(s));
  else delete plan[dayKey];
  markSettingsDirty();
  scheduleSave();
  renderScheduleGrid();
}

// ── Escala de plantões (visão dedicada por semana/mês) ──────────────────────
function renderScheduleGrid() {
  const grid = document.getElementById("schedule-grid");
  const titleEl = document.getElementById("schedule-title");
  if (!grid || !titleEl) return;
  grid.innerHTML = "";

  let start;
  let numCells;
  if (state.scheduleView === "week") {
    start = startOfWeek(state.scheduleCursor);
    numCells = 7;
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const fmt = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    titleEl.textContent = `${fmt(start)} – ${fmt(end)}`;
  } else {
    const cursor = state.scheduleCursor;
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    start = startOfWeek(first);
    numCells = 42;
    const title = first.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    titleEl.textContent = title.charAt(0).toUpperCase() + title.slice(1);
  }

  for (let i = 0; i < numCells; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const key = toDayKey(date);
    const { breakdown, total } = computeDayPlantaoBreakdown(key);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "schedule-day-cell";
    if (state.scheduleView === "month" && date.getMonth() !== state.scheduleCursor.getMonth()) btn.classList.add("other-month");
    if (key === toDayKey(new Date())) btn.classList.add("today");
    if (key === state.scheduleSelectedDayKey) btn.classList.add("selected");

    const weekdayLabel = date.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "").toUpperCase();
    let tagsHtml;
    if (total > 0) {
      // Dia com atendimento real registrado: mostra o que de fato aconteceu.
      tagsHtml = SCHEDULE_SHIFT_ORDER
        .filter((cat) => breakdown[cat].count > 0)
        .map((cat) => `<span class="schedule-shift-tag ${cat}">${SHIFT_PRICING[cat].label} ${breakdown[cat].count}</span>`)
        .join("");
    } else {
      // Sem atendimento ainda: mostra o planejamento (turno tracejado), se houver.
      const planned = getPlantaoPlanForDay(key);
      tagsHtml = planned.length
        ? planned.map((cat) => `<span class="schedule-shift-tag planned ${cat}">${SHIFT_PRICING[cat].label}</span>`).join("")
        : `<span class="schedule-empty-label">Sem plantão.</span>`;
    }

    btn.innerHTML = `
      <span class="schedule-day-head">
        <span class="schedule-weekday">${weekdayLabel}</span>
        <span class="schedule-daynum">${date.getDate()}</span>
      </span>
      <span class="schedule-date-sub">${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}</span>
      <span class="schedule-tags">${tagsHtml}</span>
    `;
    btn.addEventListener("click", () => {
      state.scheduleSelectedDayKey = key;
      renderScheduleGrid();
      renderScheduleDetail();
    });
    grid.appendChild(btn);
  }
}

function renderScheduleDetail() {
  const box = document.getElementById("schedule-detail");
  if (!box) return;
  const key = state.scheduleSelectedDayKey;
  if (!key) {
    box.innerHTML = `<p class="metric-hint">Clique em um dia para ver o detalhe da escala.</p>`;
    return;
  }
  const { breakdown, total, revenue } = computeDayPlantaoBreakdown(key);
  let body;
  if (total === 0) {
    body = `<p class="metric-hint">Sem plantões registrados neste dia.</p>`;
  } else {
    const rows = SCHEDULE_SHIFT_ORDER
      .filter((cat) => breakdown[cat].count > 0)
      .map(
        (cat) =>
          `<li><span class="tag plantao">${SHIFT_PRICING[cat].label}</span> ${breakdown[cat].count} atendimento${breakdown[cat].count > 1 ? "s" : ""} · ${formatCurrency(breakdown[cat].revenue)}</li>`
      )
      .join("");
    body = `
      <ul class="schedule-detail-list">${rows}</ul>
      <p class="metric-hint">Total do dia: ${total} plantão${total > 1 ? "ões" : ""} · ${formatCurrency(revenue)}</p>
    `;
  }

  const planned = getPlantaoPlanForDay(key);
  const planChecksHtml = SCHEDULE_SHIFT_ORDER
    .map(
      (cat) =>
        `<label class="schedule-plan-check"><input type="checkbox" class="schedule-plan-shift-check" data-shift="${cat}" ${planned.includes(cat) ? "checked" : ""} /> ${SHIFT_PRICING[cat].label}</label>`
    )
    .join("");

  box.innerHTML = `
    <div class="schedule-detail-head">
      <strong>${formatDateLong(key)}</strong>
      <button id="schedule-goto-day" class="ghost" type="button">Ver/editar este dia</button>
    </div>
    ${body}
    <div class="schedule-plan-box">
      <p class="schedule-plan-title">Planejamento (turnos que pretende trabalhar neste dia)</p>
      <div class="schedule-plan-checks">${planChecksHtml}</div>
      <p class="metric-hint">Só um lembrete visual — não afeta preço nem contagem, e some sozinho quando o dia tiver atendimentos reais.</p>
    </div>
  `;
  const gotoBtn = document.getElementById("schedule-goto-day");
  if (gotoBtn) {
    gotoBtn.addEventListener("click", () => {
      state.selectedDateKey = key;
      state.calendarCursor = startOfMonth(parseDayKey(key));
      renderAll();
      document.querySelector(".actions.card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  document.querySelectorAll(".schedule-plan-shift-check").forEach((cb) => {
    cb.addEventListener("change", () => togglePlantaoPlanShift(key, cb.dataset.shift, cb.checked));
  });
}

function renderSchedule() {
  renderScheduleGrid();
  renderScheduleDetail();
}

function setupScheduleControls() {
  document.getElementById("schedule-prev").addEventListener("click", () => {
    state.scheduleCursor =
      state.scheduleView === "week"
        ? new Date(state.scheduleCursor.getFullYear(), state.scheduleCursor.getMonth(), state.scheduleCursor.getDate() - 7)
        : new Date(state.scheduleCursor.getFullYear(), state.scheduleCursor.getMonth() - 1, 1);
    renderScheduleGrid();
  });
  document.getElementById("schedule-next").addEventListener("click", () => {
    state.scheduleCursor =
      state.scheduleView === "week"
        ? new Date(state.scheduleCursor.getFullYear(), state.scheduleCursor.getMonth(), state.scheduleCursor.getDate() + 7)
        : new Date(state.scheduleCursor.getFullYear(), state.scheduleCursor.getMonth() + 1, 1);
    renderScheduleGrid();
  });
  const weekBtn = document.getElementById("schedule-view-week");
  const monthBtn = document.getElementById("schedule-view-month");
  weekBtn.addEventListener("click", () => {
    state.scheduleView = "week";
    weekBtn.classList.add("active");
    monthBtn.classList.remove("active");
    renderScheduleGrid();
  });
  monthBtn.addEventListener("click", () => {
    state.scheduleView = "month";
    monthBtn.classList.add("active");
    weekBtn.classList.remove("active");
    renderScheduleGrid();
  });
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

function renderAtestadoSummary() {
  const monthKey = monthKeyFromDayKey(toDayKey(state.calendarCursor));
  const { perType, totalCom, totalSem, totalAll } = computeMonthAtestadoSummary(monthKey);

  document.getElementById("atestado-total-com").textContent = String(totalCom);
  document.getElementById("atestado-total-sem").textContent = String(totalSem);
  document.getElementById("atestado-total-com-hint").textContent =
    totalAll > 0 ? `${((totalCom / totalAll) * 100).toFixed(1)}% dos atendimentos do mês` : "Sem base";
  document.getElementById("atestado-total-sem-hint").textContent =
    totalAll > 0 ? `${((totalSem / totalAll) * 100).toFixed(1)}% dos atendimentos do mês` : "Sem base";

  const grid = document.getElementById("atestado-type-grid");
  grid.innerHTML = "";
  for (const type of TYPE_KEYS) {
    const { com, sem } = perType[type];
    const total = com + sem;
    const rate = total > 0 ? (com / total) * 100 : null;
    const card = document.createElement("article");
    card.className = "atestado-type-card";
    card.innerHTML = `
      <p class="atestado-type-title">${TYPE_META[type].label}</p>
      <p class="atestado-type-rate">${rate === null ? "Sem base" : `${rate.toFixed(1)}%`}</p>
      <p class="metric-hint">com atestado</p>
      <div class="atestado-type-divider"></div>
      <div class="atestado-type-row"><span>Com atestado</span><strong>${com}</strong></div>
      <div class="atestado-type-row"><span>Sem atestado</span><strong>${sem}</strong></div>
    `;
    grid.appendChild(card);
  }
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

// Mini-calendário de registro do Emprego 2: navega por mês independente do
// calendário principal e escolhe o dia do próximo plantão a registrar.
function renderJob2Calendar() {
  const grid = document.getElementById("job2-calendar-grid");
  if (!grid) return;
  grid.innerHTML = "";
  const cursor = state.job2Cursor;
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const first = new Date(y, m, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(y, m, 1 - startOffset);
  const title = first.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  document.getElementById("job2-cal-title").textContent = title.charAt(0).toUpperCase() + title.slice(1);

  for (let i = 0; i < 42; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const key = toDayKey(date);
    const dayRecords = getJob2Records(key);
    const dayGross = dayRecords.reduce((s, r) => s + getJob2RecordGross(r), 0);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "day-cell job2-cal-cell";
    if (date.getMonth() !== m) btn.classList.add("other-month");
    if (key === state.job2SelectedDate) btn.classList.add("selected");
    if (key === toDayKey(new Date())) btn.classList.add("today");
    btn.innerHTML = `
      <span class="num">${date.getDate()}</span>
      <span class="mini">${dayRecords.length ? `${dayRecords.length} plantão${dayRecords.length > 1 ? "ões" : ""}` : ""}</span>
      <span class="mini">${dayGross > 0 ? formatCalendarRevenue(dayGross) : ""}</span>
    `;
    btn.addEventListener("click", () => {
      state.job2SelectedDate = key;
      document.getElementById("job2-date").value = key;
      renderJob2Calendar();
    });
    grid.appendChild(btn);
  }
}

function setupJob2Controls() {
  document.getElementById("job2-cal-prev").addEventListener("click", () => {
    state.job2Cursor = new Date(state.job2Cursor.getFullYear(), state.job2Cursor.getMonth() - 1, 1);
    renderJob2Calendar();
  });
  document.getElementById("job2-cal-next").addEventListener("click", () => {
    state.job2Cursor = new Date(state.job2Cursor.getFullYear(), state.job2Cursor.getMonth() + 1, 1);
    renderJob2Calendar();
  });
  document.querySelectorAll(".job2-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("job2-start-time").value = btn.dataset.start;
      document.getElementById("job2-end-time").value = btn.dataset.end;
    });
  });
  const importBtn = document.getElementById("job2-import-process-btn");
  if (importBtn) {
    importBtn.addEventListener("click", () => {
      const fileInput = document.getElementById("job2-import-file");
      const file = fileInput?.files?.[0];
      processJob2ImportImage(file);
    });
  }
}

// Mostra o resumo e a lista de plantões do Emprego 2 para o mesmo mês que o
// calendário principal está exibindo (state.calendarCursor).
function renderJob2() {
  const job2 = getJob2Settings();
  document.getElementById("job2-inss-percent").value = String(job2.inssPercent);
  document.getElementById("job2-irrf-percent").value = String(job2.irrfPercent);
  const netFactor = (1 - job2.inssPercent / 100) * (1 - job2.irrfPercent / 100) * 100;
  document.getElementById("job2-net-factor-hint").textContent = `Com esses percentuais, cerca de ${netFactor.toFixed(1).replace(".", ",")}% do valor bruto vira líquido.`;
  document.getElementById("job2-rate-day-default").value = String(job2.dayRate);
  document.getElementById("job2-rate-night-default").value = String(job2.nightRate);

  const dateInput = document.getElementById("job2-date");
  if (!dateInput.value) dateInput.value = state.job2SelectedDate;
  renderJob2Calendar();

  const monthKey = monthKeyFromDayKey(toDayKey(state.calendarCursor));
  document.getElementById("job2-month-label").textContent = `Resumo de ${formatMonthLong(monthKey)}`;
  const metrics = computeJob2MonthMetrics(monthKey);
  document.getElementById("job2-month-hours").textContent = `${metrics.hours.toFixed(1).replace(".", ",")}h`;
  document.getElementById("job2-month-gross").textContent = formatCurrency(metrics.gross);
  document.getElementById("job2-month-net").textContent = formatCurrency(metrics.net);

  const list = document.getElementById("job2-list");
  list.innerHTML = "";
  const records = getJob2MonthRecordsFlat(monthKey);
  if (!records.length) {
    const li = document.createElement("li");
    li.textContent = "Nenhum plantão registrado neste mês.";
    list.appendChild(li);
    return;
  }
  for (const record of records) {
    const hours = getJob2RecordHours(record);
    const { dayHours, nightHours } = computeDayNightHours(record.startTs, record.endTs);
    const gross = getJob2RecordGross(record);
    const li = document.createElement("li");
    const row = document.createElement("div");
    row.className = "day-row";
    const main = document.createElement("div");
    main.className = "day-main";
    const category = record.category === "prep" ? "prep" : "generalista";
    main.innerHTML = `
      <span>${record.dayKey.split("-").reverse().join("/")}</span>
      <span>${toTimeInputValue(record.startTs)}–${toTimeInputValue(record.endTs)}</span>
      <span class="tag job2-category ${category}">${JOB2_CATEGORY_META[category]}</span>
      <span class="metric-hint">${hours.toFixed(1).replace(".", ",")}h total (${dayHours.toFixed(1).replace(".", ",")}h diurno · ${nightHours.toFixed(1).replace(".", ",")}h noturno)</span>
      <span class="metric-hint">${formatCurrency(gross)}</span>
    `;
    const actions = document.createElement("div");
    actions.className = "day-actions";
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "ghost day-action-btn";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Excluir";
    deleteBtn.addEventListener("click", () => {
      deleteJob2Record(record.dayKey, record.id);
      scheduleSave();
      renderJob2();
    });
    actions.append(deleteBtn);
    row.append(main, actions);
    li.appendChild(row);
    list.appendChild(li);
  }
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
  renderSchedule();
  renderAtestadoSummary();
  renderJob2();
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
    plantaoPricingGroup: newType === "plantao" ? getShiftCategoryForTs(newTs) : null,
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
  base.settings.plantaoPlan = raw.settings?.plantaoPlan && typeof raw.settings.plantaoPlan === "object" ? raw.settings.plantaoPlan : {};
  const rawJob2 = raw.settings?.job2;
  const rawJob2Records = rawJob2?.records && typeof rawJob2.records === "object" ? rawJob2.records : {};
  const normalizedRecords = {};
  for (const [dayKey, dayRecords] of Object.entries(rawJob2Records)) {
    normalizedRecords[dayKey] = Array.isArray(dayRecords) ? dayRecords : [];
  }
  base.settings.job2 = {
    records: normalizedRecords,
    // Registros antigos guardavam valor/hora por plantão; a partir de agora
    // o valor/hora é único e configurado aqui, então plantões antigos passam
    // a usar automaticamente este valor também.
    dayRate: Number.isFinite(Number(rawJob2?.dayRate)) ? Number(rawJob2.dayRate) : JOB2_DEFAULT_DAY_RATE,
    nightRate: Number.isFinite(Number(rawJob2?.nightRate)) ? Number(rawJob2.nightRate) : JOB2_DEFAULT_NIGHT_RATE,
    inssPercent: Number.isFinite(Number(rawJob2?.inssPercent)) ? Number(rawJob2.inssPercent) : JOB2_DEFAULT_INSS_PERCENT,
    irrfPercent: Number.isFinite(Number(rawJob2?.irrfPercent)) ? Number(rawJob2.irrfPercent) : JOB2_DEFAULT_IRRF_PERCENT,
  };
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
  document.getElementById("apply-shift-override-btn").addEventListener("click", applyShiftOverrideToSelectedDay);

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

  document.getElementById("job2-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const dayKey = document.getElementById("job2-date").value || state.job2SelectedDate;
    const startTime = document.getElementById("job2-start-time").value;
    const endTime = document.getElementById("job2-end-time").value;
    const category = document.querySelector('input[name="job2-category"]:checked')?.value;
    if (!dayKey || !startTime || !endTime) return;
    const { startTs, endTs } = job2Timestamps(dayKey, startTime, endTime);
    addJob2Record(dayKey, startTs, endTs, category);
    state.calendarCursor = startOfMonth(parseDayKey(dayKey));
    scheduleSave();
    renderAll();
  });

  const persistJob2Rates = () => {
    const job2 = getJob2Settings();
    const dayRate = Number(document.getElementById("job2-rate-day-default").value);
    const nightRate = Number(document.getElementById("job2-rate-night-default").value);
    if (Number.isFinite(dayRate) && dayRate >= 0) job2.dayRate = dayRate;
    if (Number.isFinite(nightRate) && nightRate >= 0) job2.nightRate = nightRate;
    markSettingsDirty();
    scheduleSave();
    renderAll();
  };
  document.getElementById("job2-rate-day-default").addEventListener("change", persistJob2Rates);
  document.getElementById("job2-rate-night-default").addEventListener("change", persistJob2Rates);

  const persistJob2Discount = () => {
    const job2 = getJob2Settings();
    const inss = Number(document.getElementById("job2-inss-percent").value);
    const irrf = Number(document.getElementById("job2-irrf-percent").value);
    if (Number.isFinite(inss) && inss >= 0) job2.inssPercent = inss;
    if (Number.isFinite(irrf) && irrf >= 0) job2.irrfPercent = irrf;
    markSettingsDirty();
    scheduleSave();
    renderJob2();
  };
  document.getElementById("job2-inss-percent").addEventListener("change", persistJob2Discount);
  document.getElementById("job2-irrf-percent").addEventListener("change", persistJob2Discount);
  document.getElementById("job2-discount-form").addEventListener("submit", (e) => e.preventDefault());
  document.getElementById("job2-rate-form").addEventListener("submit", (e) => e.preventDefault());

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
  setupScheduleControls();
  setupJob2Controls();
  bindEvents();
  if (!(await tryRestoreSession())) showAuthScreen();
}

initApp();
