try { require("dotenv").config(); } catch (e) { /* dotenv opcional */ }
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Tatata1208";
const DATA_FILE = path.join(__dirname, "data", "occupied.json");

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

function checkAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (token && token === ADMIN_PASSWORD) return next();
  return res.status(401).json({ ok: false, error: "No autorizado" });
}

// --- API pública ---
app.get("/api/occupied", (req, res) => {
  res.json({ occupied: readOccupied() });
});

// --- API admin ---
app.post("/api/login", (req, res) => {
  const { password } = req.body || {};
  if (password && password === ADMIN_PASSWORD) return res.json({ ok: true });
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
