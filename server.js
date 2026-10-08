try { require("dotenv").config(); } catch (e) { /* dotenv opcional */ }
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

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
app.use(express.json());

// Seguridad: forzar HTTPS en el navegador (HSTS solo para este host, sin subdominios)
app.use((req, res, next) => {
  res.setHeader("Strict-Transport-Security", "max-age=31536000");
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

function checkAuth(req, res, next) {
  if (isBlocked(req.ip)) return tooManyAttempts(res);
  const header = req.headers.authorization || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (passwordMatches(token)) return next();
  registerFail(req.ip);
  return res.status(401).json({ ok: false, error: "No autorizado" });
}

// --- API pública ---
app.get("/api/occupied", (req, res) => {
  res.json({ occupied: readOccupied() });
});

// Disponibilidad y precio por día, pensado para el bot de WhatsApp/Instagram.
// GET /api/disponibilidad?desde=2026-11-14&hasta=2026-11-16  (hasta es opcional, máx. 62 días)
const PRECIOS = { semana: 350000, finde: 400000 };
const MAX_DIAS = 62;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseFecha(str) {
  if (!FECHA_RE.test(str || "")) return null;
  const d = new Date(str + "T00:00:00Z");
  return isNaN(d) || d.toISOString().slice(0, 10) !== str ? null : d;
}

app.get("/api/disponibilidad", (req, res) => {
  const desde = parseFecha(req.query.desde);
  const hasta = req.query.hasta ? parseFecha(req.query.hasta) : desde;
  if (!desde || !hasta) {
    return res.status(400).json({ ok: false, error: "Usá desde=AAAA-MM-DD y opcionalmente hasta=AAAA-MM-DD" });
  }
  const dias = Math.round((hasta - desde) / 86400000) + 1;
  if (dias < 1 || dias > MAX_DIAS) {
    return res.status(400).json({ ok: false, error: `El rango tiene que ser de 1 a ${MAX_DIAS} días` });
  }

  const ocupadas = new Set(readOccupied());
  const resultado = [];
  for (let i = 0; i < dias; i++) {
    const d = new Date(desde.getTime() + i * 86400000);
    const fecha = d.toISOString().slice(0, 10);
    const finde = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    resultado.push({
      fecha,
      disponible: !ocupadas.has(fecha),
      tipo: finde ? "fin de semana" : "día de semana",
      precio: finde ? PRECIOS.finde : PRECIOS.semana,
    });
  }
  res.json({
    ok: true,
    dias: resultado,
    nota: "Precio por día o pernocte, hasta 15 personas. Feriados: precio a consultar.",
  });
});

// --- API admin ---
app.post("/api/login", (req, res) => {
  if (isBlocked(req.ip)) return tooManyAttempts(res);
  const { password } = req.body || {};
  if (passwordMatches(password)) {
    fails.delete(req.ip);
    return res.json({ ok: true });
  }
  registerFail(req.ip);
  return res.status(401).json({ ok: false, error: "Contraseña incorrecta" });
});

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
});
