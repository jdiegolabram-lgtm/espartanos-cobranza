'use strict'

const nodemailer = require('nodemailer')

let transporter

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  }
  return transporter
}

module.exports = async function (fastify) {

  /**
   * POST /api/email/send
   * Envía un correo de cobranza al cliente.
   * Llamado por n8n cuando el agente determina que aplica.
   */
  fastify.post('/send', {
    schema: {
      body: {
        type: 'object',
        required: ['to', 'subject', 'body'],
        properties: {
          to:      { type: 'string' },
          subject: { type: 'string' },
          body:    { type: 'string' },
          from:    { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
      return reply.status(503).send({ error: 'Servicio de email no configurado' })
    }

    const { to, subject, body, from } = request.body

    try {
      await getTransporter().sendMail({
        from:    from || process.env.SMTP_FROM || process.env.SMTP_USER,
        to,
        subject,
        text:    body,
        html:    `<p style="font-family:sans-serif">${body.replace(/\n/g, '<br>')}</p>`,
      })
      return { ok: true, enviado_a: to }
    } catch (err) {
      fastify.log.error('[Email]', err.message)
      return reply.status(500).send({ error: err.message })
    }
  })
}
