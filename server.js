try { require("dotenv").config(); } catch (e) { /* dotenv opcional */ }
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { calcularDisponibilidad } = require("./lib/precios");
const bot = require("./bot");
const { crearPanelRouter } = require("./bot/panel");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const DATA_FILE = path.join(__dirname, "data", "occupied.json");

// Sin clave configurada no arrancamos: nunca usar una clave por defecto
if (!ADMIN_PASSWORD) {
  console.error("Falta la variable de entorno ADMIN_PASSWORD. Configurala antes de arrancar.");
  process.exit(1);
}

// Easypanel pone un proxy adelante: confiar en él para obtener la IP real del visitante
app.set("trust proxy", 1);
// Guardamos el cuerpo crudo: el webhook de WhatsApp lo necesita para verificar la firma de Meta
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

// Seguridad: forzar HTTPS en el navegador (HSTS solo para este host, sin subdominios)
app.use((req, res, next) => {
  res.setHeader("Strict-Transport-Security", "max-age=31536000");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// El panel muestra charlas de clientes: solo scripts propios, sin poder meterlo en un iframe y sin cache.
app.use(["/admin.html", "/admin.js", "/admin-chats.js"], (req, res, next) => {
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; " +
    "frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use(express.static(path.join(__dirname, "public")));

// --- Helpers ---
function readOccupied() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : data.occupied || [];
  } catch (e) {
    return [];
  }
}

function writeOccupied(list) {
  const clean = [...new Set(list)]
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify({ occupied: clean }, null, 2));
  return clean;
}

// Compara en tiempo constante para no filtrar info de la clave por timing
function passwordMatches(input) {
  if (typeof input !== "string" || !input) return false;
  const a = crypto.createHash("sha256").update(input).digest();
  const b = crypto.createHash("sha256").update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

// Límite de intentos fallidos por IP: 5 cada 15 minutos
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const fails = new Map(); // ip -> { count, resetAt }

function isBlocked(ip) {
  const entry = fails.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    fails.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILS;
}

function registerFail(ip) {
  const entry = fails.get(ip);
  if (!entry || Date.now() > entry.resetAt) {
    fails.set(ip, { count: 1, resetAt: Date.now() + WINDOW_MS });
  } else {
    entry.count++;
  }
}

function tooManyAttempts(res) {
  return res.status(429).json({ ok: false, error: "Demasiados intentos. Probá de nuevo en 15 minutos." });
}

// Sesiones del panel: al entrar se crea un token al azar que viaja en una cookie HttpOnly (el navegador
// no lo deja leer por JavaScript) y SameSite=Strict (otra web no puede usarla). La contraseña no se guarda
// en el navegador. Las sesiones viven en memoria: un redeploy obliga a entrar de nuevo.
const SESION_COOKIE = "qlp_sesion";
const SESION_MS = 12 * 60 * 60 * 1000;
const sesiones = new Map(); // hash del token → vence (ms)

const hashToken = (t) => crypto.createHash("sha256").update(t).digest("hex");

function leerCookie(req, nombre) {
  for (const parte of (req.headers.cookie || "").split(";")) {
    const i = parte.indexOf("=");
    if (i > 0 && parte.slice(0, i).trim() === nombre) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}

function crearSesion(req, res) {
  for (const [h, vence] of sesiones) if (vence < Date.now()) sesiones.delete(h);
  const token = crypto.randomBytes(32).toString("base64url");
  sesiones.set(hashToken(token), Date.now() + SESION_MS);
  res.setHeader("Set-Cookie", `${SESION_COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${SESION_MS / 1000}` +
    (req.secure ? "; Secure" : ""));
}

function sesionValida(req) {
  const token = leerCookie(req, SESION_COOKIE);
  if (!token) return false;
  const h = hashToken(token);
  const vence = sesiones.get(h);
  if (!vence) return false;
  if (vence < Date.now()) {
    sesiones.delete(h);
    return false;
  }
  return true;
}

// Además de SameSite: los cambios solo se aceptan si vienen de esta misma web.
function mismoOrigen(req) {
  const origen = req.headers.origin;
  if (!origen) return true;
  try {
    return new URL(origen).host === req.headers.host;
  } catch (e) {
    return false;
  }
}

function checkAuth(req, res, next) {
  if (req.method !== "GET" && !mismoOrigen(req)) return res.status(403).json({ ok: false, error: "Origen no permitido" });
  if (sesionValida(req)) return next();
  return res.status(401).json({ ok: false, error: "No autorizado" });
}

// --- API pública ---
app.get("/api/occupied", (req, res) => {
  res.json({ occupied: readOccupied() });
});

// Disponibilidad y precio por día (lo usa también el bot de WhatsApp). Reglas en lib/precios.js.
// GET /api/disponibilidad?desde=2026-11-14&hasta=2026-11-16&personas=18&pernocte=si[&duermen=16][&menores3=1]
app.get("/api/disponibilidad", (req, res) => {
  const r = calcularDisponibilidad({
    desde: req.query.desde,
    hasta: req.query.hasta,
    personas: req.query.personas,
    duermen: req.query.duermen,
    menores3: req.query.menores3,
    pernocte: /^(si|sí|true|1)$/i.test(String(req.query.pernocte || "")),
    ocupadas: readOccupied(),
  });
  res.status(r.ok ? 200 : 400).json(r);
});

// --- Bot de WhatsApp (API oficial de Meta) ---
app.use(bot.crearRouter({ leerOcupadas: readOccupied }));

// --- API admin ---
app.post("/api/login", (req, res) => {
  if (isBlocked(req.ip)) return tooManyAttempts(res);
  const { password } = req.body || {};
  if (passwordMatches(password)) {
    fails.delete(req.ip);
    crearSesion(req, res);
    return res.json({ ok: true });
  }
  registerFail(req.ip);
  return res.status(401).json({ ok: false, error: "Contraseña incorrecta" });
});

app.get("/api/sesion", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(sesionValida(req) ? 200 : 401).json({ ok: sesionValida(req) });
});

app.post("/api/logout", (req, res) => {
  const token = leerCookie(req, SESION_COOKIE);
  if (token) sesiones.delete(hashToken(token));
  res.setHeader("Set-Cookie", `${SESION_COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0`);
  res.json({ ok: true });
});

// --- Panel de conversaciones del bot ---
app.use(crearPanelRouter(checkAuth));

app.post("/api/occupied", checkAuth, (req, res) => {
  const { occupied } = req.body || {};
  if (!Array.isArray(occupied)) {
    return res.status(400).json({ ok: false, error: "Formato inválido" });
  }
  const saved = writeOccupied(occupied);
  res.json({ ok: true, occupied: saved });
});

app.listen(PORT, () => {
  console.log(`Quinta La Poro escuchando en http://localhost:${PORT}`);
  console.log(bot.botActivo() ? "Bot de WhatsApp: activo" : "Bot de WhatsApp: inactivo (faltan variables de entorno o BOT_ACTIVO=no)");
  if (require("./bot/whatsapp").configurado()) require("./bot/whatsapp").diagnostico();
  console.log(bot.metaActivo() ? "Bot de Instagram/Messenger: activo" : "Bot de Instagram/Messenger: inactivo (falta META_PAGE_TOKEN)");
});
