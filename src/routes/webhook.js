'use strict'

const VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || 'espartanos2026'
const N8N_URL      = process.env.N8N_WEBHOOK_URL  || ''

module.exports = async function (fastify) {

  /**
   * GET /webhook/whatsapp
   * Meta llama este endpoint para verificar el webhook.
   * Responde con hub.challenge si el token es correcto.
   */
  fastify.get('/whatsapp', async (request, reply) => {
    const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = request.query

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      fastify.log.info('[Webhook] Meta verificó el webhook correctamente')
      return reply.status(200).type('text/plain').send(challenge)
    }

    fastify.log.warn('[Webhook] Verificación fallida — token incorrecto')
    return reply.status(403).send('Forbidden')
  })

  /**
   * POST /webhook/whatsapp
   * Meta envía aquí los mensajes entrantes de WhatsApp.
   * Los reenvía a n8n para que L.I.N.D.A. los procese.
   */
  fastify.post('/whatsapp', async (request, reply) => {
    // Responder 200 a Meta inmediatamente (requerido en < 5 seg)
    reply.status(200).send({ ok: true })

    if (!N8N_URL) {
      fastify.log.error('[Webhook] N8N_WEBHOOK_URL no configurada')
      return
    }

    // Reenviar payload a n8n en background
    try {
      const res = await fetch(N8N_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(request.body),
      })
      fastify.log.info(`[Webhook] Reenviado a n8n — status: ${res.status}`)
    } catch (err) {
      fastify.log.error('[Webhook] Error al reenviar a n8n:', err.message)
    }
  })
}
