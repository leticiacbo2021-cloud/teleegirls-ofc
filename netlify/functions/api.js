const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { getStore } = require("@netlify/blobs");

const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_NAME = "pc_session";
const SESSION_DAYS = 180;

function blobsConfig() { 
  return { siteID: process.env.SITE_ID, token: process.env.BLOBS_TOKEN }; 
} 

function usersStore() { 
  return getStore({ name: "users", consistency: "strong", ...blobsConfig() }); 
} 

function dataStore() { 
  return getStore({ name: "userdata", consistency: "strong", ...blobsConfig() }); 
}

function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...(extraHeaders || {}) },
    body: JSON.stringify(body),
  };
}

function makeCookie(token) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * SESSION_DAYS}`;
}
function clearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
function parseCookies(header) {
  const out = {};
  String(header || "")
    .split(";")
    .forEach((pair) => {
      const idx = pair.indexOf("=");
      if (idx === -1) return;
      out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    });
  return out;
}

async function getEmailFromRequest(event) {
  const cookies = parseCookies(event.headers.cookie || event.headers.Cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload.email || null;
  } catch {
    return null;
  }
}

function emptyData() {
  return {
    days: {},
    settings: {
      typePrices: { adulto: 15, pediatria: 20, one: 20 },
      monthlyGoals: {},
    },
  };
}

// Lê os dados do usuário. Quem tem conta SEMPRE tem dados (criados no cadastro),
// então "null" é uma falha transitória do Blobs — nunca pode virar "dados
// vazios", senão o próximo salvamento sobrescreve tudo com só 1 registro.
async function readUserData(email) {
  for (let i = 0; i < 4; i++) {
    try {
      const data = await dataStore().get(email, { type: "json" });
      if (data && typeof data === "object") return data;
    } catch (e) {
      console.error("readUserData", e);
    }
    await new Promise((r) => setTimeout(r, 250 * (i + 1)));
  }
  const err = new Error("DATA_UNAVAILABLE");
  err.code = "DATA_UNAVAILABLE";
  throw err;
}

// Cópia de segurança diária (1ª gravação do dia), para poder recuperar dados.
async function backupOncePerDay(email, data) {
  try {
    const day = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    const key = `${email}::bak-${day}`;
    const store = dataStore();
    const exists = await store.get(key, { type: "json" });
    if (!exists) await store.setJSON(key, data);
  } catch (e) {
    console.error("backup", e);
  }
}

exports.handler = async (event) => {
  if (!JWT_SECRET) {
    return json(500, {
      message: "Configuração ausente: defina a variável de ambiente JWT_SECRET no Netlify.",
    });
  }

  // Extrai o trecho da rota após "/api" (funciona chamado via /api/... ou
  // diretamente via /.netlify/functions/api/...).
  const parts = String(event.path || "").split("/api");
  const path = parts[parts.length - 1] || "/";
  const method = event.httpMethod;

  let body = {};
  if (event.body) {
    try {
      body = JSON.parse(event.body);
    } catch {
      return json(400, { message: "Corpo da requisição inválido." });
    }
  }

  try {
    if (path === "/auth/register" && method === "POST") {
      const emailKey = normEmail(body.email);
      const password = String(body.password || "");
      if (!emailKey || !emailKey.includes("@")) return json(400, { message: "E-mail inválido." });
      if (password.length < 8) return json(400, { message: "A senha deve ter ao menos 8 caracteres." });

      const store = usersStore();
      const existing = await store.get(emailKey, { type: "json" });
      if (existing) return json(409, { message: "Já existe uma conta com esse e-mail." });

      const passwordHash = await bcrypt.hash(password, 10);
      await store.setJSON(emailKey, { email: emailKey, passwordHash, createdAt: Date.now() });
      await dataStore().setJSON(emailKey, emptyData());
      return json(200, { message: "Cadastro criado. Faça login." });
    }

    if (path === "/auth/login" && method === "POST") {
      const emailKey = normEmail(body.email);
      const password = String(body.password || "");
      const user = await usersStore().get(emailKey, { type: "json" });
      if (!user) return json(401, { message: "E-mail ou senha inválidos." });
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return json(401, { message: "E-mail ou senha inválidos." });

      const data = await readUserData(emailKey);
      const token = jwt.sign({ email: emailKey }, JWT_SECRET, { expiresIn: `${SESSION_DAYS}d` });
      return json(200, { user: { email: emailKey }, data }, { "Set-Cookie": makeCookie(token) });
    }

    if (path === "/auth/logout" && method === "POST") {
      return json(200, { message: "ok" }, { "Set-Cookie": clearCookie() });
    }

    if (path === "/auth/session" && method === "GET") {
      const email = await getEmailFromRequest(event);
      if (!email) return json(401, { message: "Sem sessão ativa." });
      const data = await readUserData(email);
      return json(200, { user: { email }, data });
    }

    if (path === "/auth/change-password" && method === "POST") {
      const email = await getEmailFromRequest(event);
      if (!email) return json(401, { message: "Sem sessão ativa." });
      const newPassword = String(body.newPassword || "");
      if (newPassword.length < 8) return json(400, { message: "A nova senha deve ter ao menos 8 caracteres." });

      const store = usersStore();
      const user = await store.get(email, { type: "json" });
      if (!user) return json(404, { message: "Usuário não encontrado." });
      const ok = await bcrypt.compare(String(body.currentPassword || ""), user.passwordHash);
      if (!ok) return json(401, { message: "Senha atual incorreta." });

      user.passwordHash = await bcrypt.hash(newPassword, 10);
      await store.setJSON(email, user);
      return json(200, { message: "Senha atualizada." });
    }

    if (path === "/data/save" && method === "POST") {
      const email = await getEmailFromRequest(event);
      if (!email) return json(401, { message: "Sem sessão ativa." });

      // Faz merge (leitura + escrita) em vez de sobrescrever o blob inteiro:
      // o cliente manda só os dias/config que ele de fato alterou nesta
      // sessão, então dias registrados por outra aba/dispositivo entre a
      // última leitura e agora nunca são apagados.
      const hasPartialShape =
        body.days !== undefined || body.removedDays !== undefined || body.removedRecords !== undefined || body.settings !== undefined;

      if (!hasPartialShape) {
        // Compatibilidade com clientes antigos que ainda mandam o blob inteiro.
        if (!body.data || typeof body.data !== "object") return json(400, { message: "Dados inválidos." });
        await dataStore().setJSON(email, body.data);
        return json(200, { message: "ok" });
      }

      const store = dataStore();
      const current = await readUserData(email);
      await backupOncePerDay(email, current);
      if (!current.days || typeof current.days !== "object") current.days = {};
      if (!current.settings || typeof current.settings !== "object") current.settings = emptyData().settings;

      // Merge por id de registro: registros que o servidor já tem e o cliente
      // não conhece (outra aba/dispositivo) são preservados. Só some o que foi
      // excluído explicitamente (removedRecords). Remoções vêm antes dos upserts
      // (editar = remover + reinserir o mesmo id).
      const removedIds = new Set(Array.isArray(body.removedRecords) ? body.removedRecords.map(String) : []);
      if (removedIds.size) {
        for (const dayKey of Object.keys(current.days)) {
          const kept = (current.days[dayKey] || []).filter((r) => !removedIds.has(String(r.id)));
          if (kept.length) current.days[dayKey] = kept;
          else delete current.days[dayKey];
        }
      }
      const touched = [];
      if (body.days && typeof body.days === "object") {
        for (const [dayKey, records] of Object.entries(body.days)) {
          if (!Array.isArray(records) || !records.length) continue;
          const incomingIds = new Set(records.map((r) => String(r.id)));
          // Se um registro mudou de dia (edição), tira a cópia antiga de outros dias.
          for (const [otherKey, otherRecs] of Object.entries(current.days)) {
            if (otherKey === dayKey) continue;
            const kept = otherRecs.filter((r) => !incomingIds.has(String(r.id)));
            if (kept.length) current.days[otherKey] = kept;
            else delete current.days[otherKey];
          }
          const byId = new Map((current.days[dayKey] || []).map((r) => [String(r.id), r]));
          for (const r of records) byId.set(String(r.id), r);
          current.days[dayKey] = [...byId.values()].sort((x, y) => x.ts - y.ts);
          touched.push(dayKey);
        }
      }
      if (body.settings && typeof body.settings === "object") {
        current.settings = body.settings;
      }

      await store.setJSON(email, current);
      const days = {};
      for (const k of touched) days[k] = current.days[k];
      return json(200, { message: "ok", days });
    }

    return json(404, { message: "Rota não encontrada." });
  } catch (err) {
    console.error(err);
    if (err && err.code === "DATA_UNAVAILABLE") {
      return json(503, { message: "Dados temporariamente indisponíveis. Tente novamente." });
    }
    return json(500, { message: "Erro interno do servidor." });
  }
};
