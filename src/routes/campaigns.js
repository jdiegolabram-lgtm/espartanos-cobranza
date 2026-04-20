'use strict'

/**
 * RUTAS DE CAMPAÑAS — /api/campaigns
 *
 * POST /api/campaigns/preview   Preview de mensajes para un lote de leads
 * POST /api/campaigns/send      Dispara la campaña real (WA → n8n / Email → SMTP)
 */

const nodemailer = require('nodemailer')
const supabase   = require('../config/supabase')

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de montos y templates (espejo del tablero HTML)
// ─────────────────────────────────────────────────────────────────────────────

function r2(n)   { return Math.round((n || 0) * 100) / 100 }
function mxn(n)  { return '$' + (n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

function calcAmounts(lead, seg) {
  const vencido = lead.total  || 0
  const proximo = lead.cuotas || 0
  const saldo   = lead.saldo  || 0

  if (seg === '1 a 30') {
    return { importe_vencido: r2(vencido), proximo_vencer: r2(proximo),
             monto_base: r2(vencido + proximo), saldo_total: r2(saldo) }
  }
  if (seg === '31 a 60') {
    return { importe_vencido: r2(vencido), proximo_vencer: r2(proximo),
             atraso_ajustado: r2(vencido * 1.25), saldo_total_ajustado: r2(saldo * 1.20),
             saldo_total: r2(saldo) }
  }
  // 61-89
  return { saldo_total_ajustado: r2(saldo * 1.25), saldo_total: r2(saldo) }
}

function templateWA(lead, seg) {
  const nombre = (lead.nombre || 'cliente').split(' ').slice(0, 2).join(' ')
  const plan   = lead.plan ? `(crédito ${lead.plan})` : ''
  const a      = calcAmounts(lead, seg)

  if (seg === '1 a 30') {
    return `Estimado(a) ${nombre}, su cuenta ${plan} presenta un importe vencido de *${mxn(a.importe_vencido)}* y un pago próximo a vencer de *${mxn(a.proximo_vencer)}*.\n\nLe invitamos a regularizar para evitar recargos e impacto en su historial crediticio. Realice su pago vía *CLABE interbancaria*. ¿Le orientamos?`
  }
  if (seg === '31 a 60') {
    return `Estimado(a) ${nombre}, su cuenta ${plan} registra un atraso ajustado de *${mxn(a.atraso_ajustado)}*, próximo pago *${mxn(a.proximo_vencer)}* y saldo ajustado de *${mxn(a.saldo_total_ajustado)}*.\n\nEl incumplimiento puede activar el vencimiento anticipado del contrato. Regularice hoy vía *CLABE interbancaria*.`
  }
  return `Estimado(a) ${nombre}, su cuenta ${plan} registra más de tres meses de atraso con saldo ajustado de *${mxn(a.saldo_total_ajustado)}*.\n\nRequiere atención inmediata. Contáctenos para revisar su situación. Pago únicamente vía *CLABE interbancaria*.`
}

function templateSMS(lead, seg) {
  const nombre = (lead.nombre || 'cliente').split(' ')[0]
  const a      = calcAmounts(lead, seg)

  if (seg === '1 a 30') return `Libertad Financiera: ${nombre}, vencido ${mxn(a.importe_vencido)}, prox ${mxn(a.proximo_vencer)}. Evite recargos. Pago via CLABE interbancaria.`
  if (seg === '31 a 60') return `Libertad Financiera: ${nombre}, atraso ajustado ${mxn(a.atraso_ajustado)}, saldo ajustado ${mxn(a.saldo_total_ajustado)}. Regularice ya. Pago via CLABE.`
  return `Libertad Financiera: ${nombre}, adeudo sup. 3 meses. Saldo ajustado ${mxn(a.saldo_total_ajustado)}. Comuniquese de inmediato. Pago via CLABE interbancaria.`
}

function templateEmail(lead, seg) {
  const nombre = (lead.nombre || 'cliente').split(' ').slice(0, 2).join(' ')
  const plan   = lead.plan ? `(crédito ${lead.plan}) ` : ''
  const a      = calcAmounts(lead, seg)
  const firma  = `\n\nAtentamente,\n${seg === '61 a 89' ? 'Área de Prevención, Dictaminación y Recuperación de Cuentas' : 'Jefatura de Cobranza'}\nLibertad Servicios Financieros, S.A. de C.V., S.F.P.\nProl. 18 de Marzo 125, Col. Felipe Carrillo Puerto, Querétaro\nTel: 442 394 5911 / 442 394 5918`

  if (seg === '1 a 30') return {
    asunto: `Aviso preventivo de regularización de crédito ${plan}— Libertad Financiera`,
    cuerpo: `Estimado(a) ${nombre}:\n\nSu crédito ${plan}registra un importe vencido de ${mxn(a.importe_vencido)} y un próximo pago de ${mxn(a.proximo_vencer)}.\n\nLe invitamos a regularizar para evitar recargos, afectación en su Buró de Crédito y cargos por visita de cobranza ($195.50 + IVA). El pago deberá realizarse únicamente vía CLABE interbancaria.${firma}`,
  }
  if (seg === '31 a 60') return {
    asunto: `Requerimiento de regularización de crédito ${plan}— Libertad Financiera`,
    cuerpo: `Estimado(a) ${nombre}:\n\nSu crédito ${plan}registra un atraso ajustado de ${mxn(a.atraso_ajustado)}, próximo pago de ${mxn(a.proximo_vencer)} y saldo ajustado de ${mxn(a.saldo_total_ajustado)}.\n\nEl incumplimiento puede activar cláusulas de vencimiento anticipado. Regularice a la brevedad. Pago únicamente vía CLABE interbancaria.${firma}`,
  }
  return {
    asunto: `Aviso de adeudo superior a tres meses ${plan}— Libertad Financiera`,
    cuerpo: `Estimado(a) ${nombre}:\n\nSu cuenta ${plan}mantiene un adeudo de más de tres meses con saldo ajustado de ${mxn(a.saldo_total_ajustado)}. Su expediente puede ser revisado por el Área de Prevención, Dictaminación y Recuperación de Cuentas.\n\nContáctenos de inmediato. Pago únicamente vía CLABE interbancaria.${firma}`,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Canales de envío
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WhatsApp → n8n webhook → L.I.N.D.A. (OpenAI) → WhatsApp Cloud API
 * El payload que espera el workflow workflow_agentes_cobranza.json
 */
async function sendViaWhatsApp(lead, seg, mensaje) {
  const url = process.env.N8N_WEBHOOK_URL
  if (!url) throw new Error('N8N_WEBHOOK_URL no configurada')

  const tel = (lead.tel?.[0] || '').replace(/\D/g, '')
  if (!tel || tel.length < 7) throw new Error('Sin teléfono válido')

  const payload = {
    cliente_id:     lead.plan,
    nombre_cliente: lead.nombre,
    telefono:       tel,
    pagos_vencidos: lead.noCuotas || 1,
    monto_pago:     lead.total    || 0,
    bucket:         seg,
    fase:           'apertura',
    saldo_total:    lead.saldo    || 0,
    saldo_vencido:  lead.total    || 0,
    segmento:       lead.comportamiento || 'Regular',
    ultima_gestion: 'Campaña masiva tablero',
    canal:          'whatsapp',
    // Mensaje pre-generado (n8n puede usarlo directamente o pasarlo a Gemini)
    mensaje_previo: mensaje,
  }

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`n8n ${res.status}: ${text.slice(0, 120)}`)
  }
  return await res.json()
}

/**
 * Email → SMTP vía nodemailer
 * Soporta Outlook (smtp.office365.com:587) y Gmail (smtp.gmail.com:587)
 */
let _transporter = null
function getTransporter() {
  if (_transporter) return _transporter
  _transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: { rejectUnauthorized: false },
  })
  return _transporter
}

async function sendViaEmail(lead, asunto, cuerpo) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error('SMTP_USER / SMTP_PASS no configurados')
  }
  const email = (lead.email || '').trim()
  if (!email || !email.includes('@')) throw new Error('Sin correo válido')

  await getTransporter().sendMail({
    from:    `"Libertad Financiera Cobranza" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to:      email,
    subject: asunto,
    text:    cuerpo,
  })
}

/**
 * SMS → placeholder (Twilio ready)
 * Cuando agregues Twilio, descomenta y pon las credenciales en .env
 */
async function sendViaSMS(lead, mensaje) {
  // const client = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_TOKEN)
  // await client.messages.create({ from: process.env.TWILIO_FROM, to: '+52'+tel, body: mensaje })
  throw new Error('SMS: integración pendiente — configura Twilio en .env (TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM)')
}

// ─────────────────────────────────────────────────────────────────────────────
// Registro de gestión en Supabase
// ─────────────────────────────────────────────────────────────────────────────

async function registrarGestion(leadPlan, canal, estatus, nota) {
  await supabase.from('gestiones').insert({
    plan:      leadPlan,
    canal,
    estatus,
    nota,
    created_at: new Date().toISOString(),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin Fastify
// ─────────────────────────────────────────────────────────────────────────────

module.exports = async function (fastify) {

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/campaigns/preview
  // Genera preview de mensajes sin enviarlos
  //
  // Body: { leads: [...], canal: 'wa'|'sms'|'mail', segmento: '1 a 30'|... }
  // ──────────────────────────────────────────────────────────────────────────
  fastify.post('/preview', {
    schema: {
      body: {
        type: 'object',
        required: ['leads', 'canal'],
        properties: {
          leads:    { type: 'array', minItems: 1, maxItems: 500 },
          canal:    { type: 'string', enum: ['wa', 'sms', 'mail'] },
          segmento: { type: 'string' },
          subject:  { type: 'string' },
          body:     { type: 'string' },
        }
      }
    }
  }, async (request, reply) => {
    const { leads, canal, segmento, subject: customSubject, body: customBody } = request.body

    const previews = leads.map(lead => {
      const seg = segmento || lead.seg || '1 a 30'
      let mensaje = '', asunto = ''

      try {
        if (customBody) {
          // Mensaje personalizado con interpolación básica
          mensaje = customBody
            .replace(/\{nombre\}/gi, (lead.nombre || '').split(' ').slice(0, 2).join(' '))
            .replace(/\{plan\}/gi, lead.plan || '')
            .replace(/\{total\}/gi, mxn(lead.total))
            .replace(/\{saldo\}/gi, mxn(lead.saldo))
          asunto  = customSubject || ''
        } else if (canal === 'wa') {
          mensaje = templateWA(lead, seg)
        } else if (canal === 'sms') {
          mensaje = templateSMS(lead, seg)
        } else {
          const tpl = templateEmail(lead, seg)
          asunto  = tpl.asunto
          mensaje = tpl.cuerpo
        }
      } catch (e) {
        mensaje = '[Error generando mensaje: ' + e.message + ']'
      }

      const tel   = (lead.tel?.[0] || '').replace(/\D/g, '')
      const email = (lead.email || '').trim()

      return {
        leadId:  lead.id || lead.plan,
        nombre:  lead.nombre,
        canal,
        segmento: seg,
        contacto: canal === 'mail' ? email : tel,
        tiene_contacto: canal === 'mail' ? (email.includes('@')) : (tel.length >= 7),
        asunto,
        mensaje,
      }
    })

    const validos   = previews.filter(p => p.tiene_contacto).length
    const invalidos = previews.length - validos

    return { ok: true, total: previews.length, validos, invalidos, previews }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/campaigns/send
  // Envía la campaña real lead por lead y registra en Supabase
  //
  // Body: { leads: [...], canal: 'wa'|'sms'|'mail', subject?, body?, segmento? }
  // Respuesta: { results: [{ leadId, nombre, canal, estatus, error? }] }
  // ──────────────────────────────────────────────────────────────────────────
  fastify.post('/send', {
    schema: {
      body: {
        type: 'object',
        required: ['leads', 'canal'],
        properties: {
          leads:    { type: 'array', minItems: 1, maxItems: 200 },
          canal:    { type: 'string', enum: ['wa', 'sms', 'mail'] },
          segmento: { type: 'string' },
          subject:  { type: 'string' },
          body:     { type: 'string' },
        }
      }
    },
    // Timeout generoso: n8n + Gemini pueden tardar varios segundos por lead
    config: { rawBody: false },
  }, async (request, reply) => {
    const { leads, canal, segmento, subject: customSubject, body: customBody } = request.body

    fastify.log.info(`[Campaigns/send] Canal: ${canal} · Leads: ${leads.length}`)

    const results = []

    for (const lead of leads) {
      const seg    = segmento || lead.seg || '1 a 30'
      const leadId = lead.id  || lead.plan
      let estatus  = 'enviado'
      let errMsg   = null

      try {
        // Generar mensaje
        let mensaje = '', asunto = ''
        if (customBody) {
          mensaje = customBody
            .replace(/\{nombre\}/gi, (lead.nombre || '').split(' ').slice(0, 2).join(' '))
            .replace(/\{plan\}/gi, lead.plan || '')
            .replace(/\{total\}/gi, mxn(lead.total))
            .replace(/\{saldo\}/gi, mxn(lead.saldo))
          asunto = customSubject || ''
        } else if (canal === 'wa') {
          mensaje = templateWA(lead, seg)
        } else if (canal === 'sms') {
          mensaje = templateSMS(lead, seg)
        } else {
          const tpl = templateEmail(lead, seg)
          asunto  = customSubject || tpl.asunto
          mensaje = tpl.cuerpo
        }

        // Enviar por canal
        if (canal === 'wa') {
          await sendViaWhatsApp(lead, seg, mensaje)
        } else if (canal === 'sms') {
          await sendViaSMS(lead, mensaje)
        } else {
          await sendViaEmail(lead, asunto, mensaje)
        }

        // Registrar gestión exitosa
        await registrarGestion(leadId, canal, 'enviado', `Campaña ${canal} seg. ${seg}`)

      } catch (e) {
        fastify.log.warn(`[Campaigns/send] Lead ${leadId}: ${e.message}`)
        estatus = 'error'
        errMsg  = e.message
        await registrarGestion(leadId, canal, 'error', e.message.slice(0, 200))
      }

      results.push({
        leadId,
        nombre: lead.nombre,
        canal,
        estatus,
        ...(errMsg ? { error: errMsg } : {}),
      })

      // Pausa entre envíos para no saturar n8n ni el SMTP
      if (canal === 'wa') await new Promise(r => setTimeout(r, 300))
    }

    const enviados = results.filter(r => r.estatus === 'enviado').length
    const errores  = results.filter(r => r.estatus === 'error').length

    fastify.log.info(`[Campaigns/send] Completado: ${enviados} enviados · ${errores} errores`)

    return { ok: true, enviados, errores, results }
  })
}
