// Cliente mínimo de la API oficial de WhatsApp (Cloud API de Meta).
const crypto = require("crypto");

const API_VERSION = process.env.WHATSAPP_API_VERSION || "v26.0";

function config() {
  return {
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    appSecret: process.env.WHATSAPP_APP_SECRET,
  };
}

function configurado() {
  const c = config();
  return Boolean(c.token && c.phoneNumberId && c.verifyToken && c.appSecret);
}

// Meta firma cada aviso con HMAC-SHA256 del cuerpo crudo usando el App Secret.
function firmaValida(rawBody, header) {
  const { appSecret } = config();
  if (!appSecret || !rawBody || typeof header !== "string" || !header.startsWith("sha256=")) return false;
  const esperado = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const recibido = header.slice("sha256=".length);
  if (recibido.length !== esperado.length) return false;
  return crypto.timingSafeEqual(Buffer.from(recibido, "utf8"), Buffer.from(esperado, "utf8"));
}

// En Argentina Meta manda el número del cliente como 549 + área + número, pero para
// enviarle hay que sacar el 9 (si no, el número de prueba da "not in allowed list").
function numeroParaEnviar(to) {
  const n = String(to).replace(/\D/g, "");
  return /^549\d{10}$/.test(n) ? "54" + n.slice(3) : n;
}

async function llamar(body) {
  const { token, phoneNumberId } = config();
  const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });
  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new Error(`WhatsApp API ${res.status}: ${detalle.slice(0, 300)}`);
  }
  return res.json();
}

// WhatsApp acepta hasta 4096 caracteres por mensaje de texto.
async function enviarTexto(to, texto) {
  const partes = [];
  let resto = texto.trim();
  while (resto.length > 4000) {
    const corte = resto.lastIndexOf("\n", 4000) > 1000 ? resto.lastIndexOf("\n", 4000) : 4000;
    partes.push(resto.slice(0, corte));
    resto = resto.slice(corte).trim();
  }
  if (resto) partes.push(resto);
  for (const parte of partes) {
    await llamar({ to: numeroParaEnviar(to), type: "text", text: { body: parte, preview_url: true } });
  }
}

// Marca el mensaje como leído (los dos tildes azules).
async function marcarLeido(messageId) {
  try {
    await llamar({ status: "read", message_id: messageId });
  } catch (e) {
    console.warn("[bot] no se pudo marcar como leído:", e.message);
  }
}

async function graph(metodo, ruta, body) {
  const { token } = config();
  const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `HTTP ${res.status}`);
  return json;
}

// Al arrancar: revisa que el token y el número sirvan, y suscribe la app a la cuenta de
// WhatsApp Business (sin esa suscripción Meta no manda los mensajes al webhook).
async function diagnostico() {
  const { phoneNumberId } = config();
  try {
    const n = await graph("GET", `${phoneNumberId}?fields=display_phone_number,verified_name,platform_type`);
    console.log(`[bot] token OK, número ${n.display_phone_number} (${n.verified_name})`);
    // Un número real recién agregado hay que registrarlo en la Cloud API con un PIN de 6 dígitos
    // (WHATSAPP_PIN en Easypanel). Se hace una sola vez: si ya está registrado no se repite.
    if (n.platform_type && n.platform_type !== "CLOUD_API") {
      const pin = process.env.WHATSAPP_PIN;
      if (!/^\d{6}$/.test(pin || "")) {
        console.warn("[bot] el número no está registrado en la Cloud API: cargá WHATSAPP_PIN (6 dígitos) en Easypanel y reiniciá");
      } else {
        try {
          await graph("POST", `${phoneNumberId}/register`, { messaging_product: "whatsapp", pin });
          console.log("[bot] número registrado en la Cloud API");
        } catch (e) {
          console.warn("[bot] no se pudo registrar el número:", e.message);
        }
      }
    }
  } catch (e) {
    console.warn("[bot] el token o el WHATSAPP_PHONE_NUMBER_ID no funcionan:", e.message);
    return;
  }
  const waba = process.env.WHATSAPP_WABA_ID;
  if (!waba) return console.warn("[bot] falta WHATSAPP_WABA_ID: no se puede revisar la suscripción de la app");
  try {
    await graph("POST", `${waba}/subscribed_apps`);
    console.log("[bot] app suscripta a la cuenta de WhatsApp Business: los mensajes deberían llegar");
  } catch (e) {
    console.warn("[bot] no se pudo suscribir la app a la cuenta de WhatsApp Business:", e.message);
  }
}

module.exports = { diagnostico, numeroParaEnviar, configurado, config, firmaValida, enviarTexto, marcarLeido };
