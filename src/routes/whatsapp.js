'use strict'

/**
 * Webhook Meta WhatsApp
 * GET  /webhook/whatsapp  → verificación de Meta (handshake)
 * POST /webhook/whatsapp  → recibe mensajes entrantes → reenvía a n8n
 */

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'https://d1360.app.n8n.cloud/webhook/ai-cobranza'

async function whatsappRoutes(app) {
  // ── Verificación de Meta (se llama una sola vez al configurar el webhook) ──
  app.get('/', async (request, reply) => {
    const mode      = request.query['hub.mode']
    const token     = request.query['hub.verify_token']
    const challenge = request.query['hub.challenge']

    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      app.log.info('Webhook de WhatsApp verificado por Meta')
      return reply.code(200).send(challenge)
    }

    app.log.warn('Verificación de webhook fallida — token incorrecto')
    return reply.code(403).send({ error: 'Forbidden' })
  })

  // ── Recepción de mensajes entrantes ──
  app.post('/', async (request, reply) => {
    const body = request.body

    // Meta siempre envía object: 'whatsapp_business_account'
    if (body?.object !== 'whatsapp_business_account') {
      return reply.code(200).send({ status: 'ignored' })
    }

    try {
      const entry   = body.entry?.[0]
      const change  = entry?.changes?.[0]?.value
      const message = change?.messages?.[0]

      // Solo procesar mensajes de texto (ignorar estados de entrega, etc.)
      if (!message || message.type !== 'text') {
        return reply.code(200).send({ status: 'no_text_message' })
      }

      const payload = {
        telefono:        message.from,                         // ej: 521XXXXXXXXXX
        nombre_cliente:  change.contacts?.[0]?.profile?.name ?? 'Desconocido',
        mensaje_cliente: message.text.body,
        mensaje_id:      message.id,
        timestamp:       message.timestamp,
        canal:           'whatsapp',
      }

      app.log.info({ payload }, 'Mensaje WhatsApp recibido → enviando a n8n')

      // Reenviar a n8n de forma no bloqueante
      fetch(N8N_WEBHOOK_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      }).catch(err => app.log.error({ err }, 'Error al reenviar a n8n'))

      // Meta requiere respuesta 200 inmediata (< 20 seg)
      return reply.code(200).send({ status: 'received' })
    } catch (err) {
      app.log.error({ err }, 'Error procesando webhook de WhatsApp')
      // Siempre 200 para que Meta no reintente
      return reply.code(200).send({ status: 'error_interno' })
    }
  })
}

module.exports = whatsappRoutes
