// lib/webhook.js
//
// Integración externa con n8n (scope §8).
// Desacopla la lógica de notificación del backend: el backend solo emite
// eventos, n8n decide el canal (email, Slack, Discord, etc.).
//
// Diseño deliberado:
//  - Async no bloqueante: quien llama no debe hacer await. Si el webhook
//    falla o tarda, el usuario no se entera.
//  - Errores en silencio: un fallo de notificación NO debe abortar la
//    operación principal (la OT ya está creada y comprometida en BD).
//  - WEBHOOK_URL vacía => no-op. Permite desarrollo local sin n8n.
//  - Timeout de 5s con AbortController: evita promesas colgadas si n8n
//    acepta conexión pero no responde.

const TIMEOUT_MS = 5000;

export async function notificarWebhook(evento, payload) {
  const url = process.env.WEBHOOK_URL;

  // Modo dev sin n8n: salida silenciosa, no es un error.
  if (!url) return;

  const cuerpo = {
    evento,
    timestamp: new Date().toISOString(),
    datos: payload,
  };

  const controlador = new AbortController();
  const timeoutId = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      signal: controlador.signal,
    });
  } catch {
    // Silencio deliberado: el webhook es best-effort.
    // Si falla, la OT sigue siendo válida y el sistema sigue funcionando.
  } finally {
    clearTimeout(timeoutId);
  }
}
