// Cliente mínimo para Instagram y Messenger (Messenger Platform de Meta).
// Los dos canales se manejan con el token de la página de Facebook vinculada al Instagram de la quinta.
const API_VERSION = process.env.WHATSAPP_API_VERSION || "v25.0";

function configurado() {
  return Boolean(process.env.META_PAGE_TOKEN);
}

async function llamar(body) {
  const res = await fetch(`https://graph.facebook.com/${API_VERSION}/me/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.META_PAGE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Meta API ${res.status}: ${json.error?.message || ""}`);
  return json;
}

// Instagram y Messenger aceptan hasta 1000 caracteres por mensaje. Devuelve los ids de lo enviado.
async function enviarTexto(destinatario, texto) {
  const partes = [];
  let resto = texto.trim();
  while (resto.length > 950) {
    const corte = resto.lastIndexOf("\n", 950) > 300 ? resto.lastIndexOf("\n", 950) : resto.lastIndexOf(" ", 950);
    partes.push(resto.slice(0, corte > 0 ? corte : 950));
    resto = resto.slice(corte > 0 ? corte : 950).trim();
  }
  if (resto) partes.push(resto);
  const ids = [];
  for (const parte of partes) {
    const r = await llamar({ recipient: { id: destinatario }, messaging_type: "RESPONSE", message: { text: parte } });
    if (r.message_id) ids.push(r.message_id);
  }
  return ids;
}

async function marcarLeido(destinatario) {
  try {
    await llamar({ recipient: { id: destinatario }, sender_action: "mark_seen" });
  } catch (e) {
    console.warn("[bot] no se pudo marcar como visto:", e.message);
  }
}

// Nombre de la persona para mostrar en el panel y en los avisos. Si Meta no lo da, null.
async function obtenerNombre(id, canal) {
  const campos = canal === "instagram" ? "name,username" : "first_name,last_name";
  try {
    const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${encodeURIComponent(id)}?fields=${campos}`, {
      headers: { Authorization: `Bearer ${process.env.META_PAGE_TOKEN}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const p = await res.json();
    const nombre = canal === "instagram" ? p.name || (p.username && "@" + p.username) : [p.first_name, p.last_name].filter(Boolean).join(" ");
    return nombre || null;
  } catch (e) {
    return null;
  }
}

module.exports = { configurado, enviarTexto, marcarLeido, obtenerNombre };
