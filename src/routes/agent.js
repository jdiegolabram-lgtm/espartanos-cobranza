'use strict'

const OpenAI = require('openai')

/**
 * AGENTE L.I.N.D.A.
 * Líder Inteligente de Negociación y Decisiones Autónomas
 *
 * POST /agent/process
 *   Recibe mensaje de WhatsApp, consulta la cuenta, genera respuesta
 *   con IA (OpenAI), ejecuta acciones y retorna respuesta estructurada.
 *
 * El frontend o n8n envía:
 *   { telefono, mensaje, canal? }
 *
 * L.I.N.D.A. responde:
 *   { reply, intent, management_result, commitment_*, followup_*, actions }
 */

const supabase = require('../config/supabase')

// ─────────────────────────────────────────────────────────────────────────────
// SISTEMA DE PROMPT — L.I.N.D.A.
// ─────────────────────────────────────────────────────────────────────────────
const LINDA_SYSTEM_PROMPT = `Eres L.I.N.D.A. (Líder Inteligente de Negociación y Decisiones Autónomas), agente de cobranza de Libertad Servicios Financieros, S.A. de C.V., S.F.P.

OBJETIVO PRINCIPAL:
Recuperar cartera vencida mediante negociación inteligente, empática y profesional.
Prioridad: (1) pago total → (2) mínimo 2 cuotas → (3) promesa con fecha exacta → (4) contener cuenta

REGLAS ABSOLUTAS:
- Sé profesional, claro y persuasivo. Sin amenazas, sin humillar al cliente.
- No inventes información legal ni menciones instituciones externas.
- No menciones servicios descontinuados ni bancos específicos.
- El pago SIEMPRE debe realizarse vía CLABE interbancaria. No menciones otros medios.
- Máximo 4 líneas por mensaje. Sin asteriscos ni markdown. Español mexicano natural.
- Si el cliente insulta o agrede, mantén la calma y redirige a solución.
- Si el cliente dice que ya pagó, regístralo y pide número de operación.
- Nunca prometas quitas o condonaciones sin autorización.

SEGMENTACIÓN POR BUCKET:
- 1–30 días (preventivo): Tono empático. Enfatizar recargos, afectación historial Buró. Buscar pago inmediato hoy.
- 31–60 días (firme): Tono serio. Mencionar vencimiento anticipado del pagaré. Buscar regularización urgente.
- 61–90 días (institucional): Tono institucional. Área de Prevención y Recuperación. Urgencia máxima. Pago o acuerdo hoy.

INTENCIONES DEL CLIENTE (elige exactamente una):
- quiere_pagar: tiene intención clara de pagar hoy o mañana
- solicita_tiempo: pide plazo, prórroga o fecha futura
- niega_deuda: no reconoce el adeudo
- sin_dinero: argumenta falta de recursos económicos
- quiere_negociar: propone pago parcial o arreglo alternativo
- amenaza_legal: menciona abogados, demandas o derechos del consumidor
- sin_intencion: no muestra ningún interés en pagar
- agresivo: lenguaje hostil, insultos o amenazas personales
- confirmacion_pago: dice haber depositado o pagado ya

MANAGEMENT_RESULT (elige exactamente uno):
- promesa_pago: el cliente se comprometió con monto y fecha
- sin_contacto: no hubo respuesta real
- rechazo: el cliente se negó definitivamente a pagar
- pago_realizado: el cliente confirma pago realizado
- negociacion: en proceso de acuerdo, sin promesa formal aún
- en_proceso: conversación en curso, aún sin definición

ACCIONES (incluye solo las que aplican en este turno):
- registrar_gestion: siempre incluir
- registrar_promesa: solo si commitment_date NO es null
- programar_seguimiento: solo si should_schedule_followup es true
- escalar_caso: solo si should_escalate es true
- enviar_correo: si el cliente no tiene teléfono válido o solicita confirmación escrita

ESCALACIÓN: Escala si el cliente lleva 3+ intercambios sin intención, si niega la deuda, o si es agresivo.

RESPONDE ÚNICAMENTE con JSON válido. Sin texto adicional, sin markdown, sin explicaciones fuera del JSON.
La estructura es EXACTAMENTE esta:
{
  "reply": "mensaje para enviar al cliente por WhatsApp (máx 4 líneas, español mexicano)",
  "intent": "una_de_las_intenciones_listadas",
  "management_result": "uno_de_los_resultados_listados",
  "commitment_amount": null,
  "commitment_date": null,
  "should_schedule_followup": false,
  "followup_date": null,
  "should_escalate": false,
  "actions": ["registrar_gestion"]
}`

// ─────────────────────────────────────────────────────────────────────────────
// Construir contexto de cuenta para L.I.N.D.A.
// ─────────────────────────────────────────────────────────────────────────────
function buildContext(cuenta, ultimaGestion, promesasActivas) {
  const dm = cuenta.dm || cuenta.dias_mora || 0
  const bucket =
    dm <= 0  ? '0 días (al corriente)' :
    dm <= 30 ? `${dm} días — bucket 1-30 (preventivo)` :
    dm <= 60 ? `${dm} días — bucket 31-60 (firme)` :
    dm <= 89 ? `${dm} días — bucket 61-90 (institucional)` :
               `${dm} días — bucket 90+ (juridico)`

  const fmt = n => `$${(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`

  const lineas = [
    '=== INFORMACIÓN DE LA CUENTA ===',
    `Nombre: ${cuenta.nombre || cuenta.nombre_cliente || 'No registrado'}`,
    `Plan/Folio: ${cuenta.plan || cuenta.folio || 'N/D'}`,
    `Mora: ${bucket}`,
    `Comportamiento histórico: ${cuenta.comportamiento || cuenta.comportamiento_historico || 'Regular'}`,
    `Empresa/Patrón: ${cuenta.empresa || 'No registrada'}`,
    '',
    '=== MONTOS ===',
    `Importe vencido: ${fmt(cuenta.total || cuenta.monto_vencido)}`,
    `Próximo a vencer: ${fmt(cuenta.cuotas || cuenta.pago_vencido)}`,
    `Saldo insoluto total: ${fmt(cuenta.saldo || cuenta.saldo_total)}`,
    `Pagos vencidos: ${cuenta.noCuotas || 1}`,
    '',
    '=== GESTIÓN ===',
    `Última gestión: ${
      ultimaGestion
        ? `${ultimaGestion.canal} el ${new Date(ultimaGestion.created_at).toLocaleDateString('es-MX')} — ${ultimaGestion.nota || ultimaGestion.estatus}`
        : 'Sin gestión previa registrada'
    }`,
    `Promesas activas: ${
      promesasActivas?.length
        ? promesasActivas.map(p => `${fmt(p.monto)} para ${p.fecha_compromiso}`).join(' | ')
        : 'Ninguna'
    }`,
  ]

  return lineas.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Llamada a OpenAI con output JSON forzado
// ─────────────────────────────────────────────────────────────────────────────
async function callLINDA(contexto, mensajeCliente, historial = []) {
  const apiKey = process.env.LINDA_OPENAI_KEY || process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('LINDA_OPENAI_KEY no configurada en variables de entorno')

  const client = new OpenAI({ apiKey })
  const model  = process.env.OPENAI_MODEL || 'gpt-4o-mini'

  const messages = [
    { role: 'system', content: LINDA_SYSTEM_PROMPT },
  ]

  // Hasta 3 turnos anteriores para continuidad conversacional
  for (const turno of historial.slice(-3)) {
    messages.push({ role: 'user',      content: turno.cliente })
    messages.push({ role: 'assistant', content: turno.linda   })
  }

  // Turno actual: contexto de cuenta + mensaje del cliente
  messages.push({
    role: 'user',
    content: `${contexto}\n\n=== MENSAJE DEL CLIENTE ===\n"${mensajeCliente}"\n\nResponde en JSON:`,
  })

  const completion = await client.chat.completions.create(
    {
      model,
      messages,
      temperature:     0.35,
      max_tokens:      512,
      response_format: { type: 'json_object' },
    },
    { timeout: 20_000 }
  )

  const raw = completion.choices[0]?.message?.content || '{}'

  let parsed = {}
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Fallback: extraer JSON del texto si hay caracteres extra
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) {
      try { parsed = JSON.parse(match[0]) } catch { /* usa defaults */ }
    }
  }

  // Defaults defensivos — nunca romper el flujo por respuesta malformada
  return {
    reply:                    String(parsed.reply                    || 'Gracias por comunicarse. En breve un asesor le contacta.'),
    intent:                   String(parsed.intent                   || 'en_proceso'),
    management_result:        String(parsed.management_result        || 'en_proceso'),
    commitment_amount:        parsed.commitment_amount != null ? Number(parsed.commitment_amount) : null,
    commitment_date:          parsed.commitment_date          || null,
    should_schedule_followup: Boolean(parsed.should_schedule_followup),
    followup_date:            parsed.followup_date            || null,
    should_escalate:          Boolean(parsed.should_escalate),
    actions:                  Array.isArray(parsed.actions) ? parsed.actions : ['registrar_gestion'],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Acciones sobre Supabase (todas silenciosas — no rompen el flujo)
// ─────────────────────────────────────────────────────────────────────────────
async function registrarGestion(folio, canal, linda) {
  try {
    await supabase.from('gestiones').insert({
      plan:    folio,
      canal,
      estatus: 'enviado',
      nota:    `L.I.N.D.A. · intent:${linda.intent} · resultado:${linda.management_result}${linda.should_escalate ? ' · ESCALADO' : ''}`,
    })
  } catch (e) { /* silencioso */ }
}

async function registrarPromesa(folio, telefono, linda) {
  if (!linda.commitment_date) return
  try {
    await supabase.from('promesas').insert({
      plan:             folio,
      telefono,
      canal:            'whatsapp',
      monto:            linda.commitment_amount,
      fecha_compromiso: linda.commitment_date,
      estatus:          'pendiente',
      nota:             `Capturada por L.I.N.D.A. · intent:${linda.intent}`,
    })
  } catch (e) { /* silencioso */ }
}

async function programarSeguimiento(folio, telefono, linda) {
  if (!linda.should_schedule_followup || !linda.followup_date) return
  try {
    await supabase.from('seguimientos').insert({
      plan:             folio,
      telefono,
      canal:            'whatsapp',
      fecha_programada: linda.followup_date,
      motivo:           `Seguimiento L.I.N.D.A. · ${linda.intent} · ${linda.management_result}`,
      estatus:          'pendiente',
    })
  } catch (e) { /* silencioso */ }
}

async function guardarConversacion(folio, telefono, mensajeCliente, linda) {
  try {
    await supabase.from('conversaciones').insert({
      plan:             folio,
      telefono,
      mensaje_cliente:  mensajeCliente,
      respuesta_linda:  linda.reply,
      intent:           linda.intent,
      management_result: linda.management_result,
      should_escalate:  linda.should_escalate,
      raw_response:     linda,
    })
  } catch (e) { /* silencioso */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// PLUGIN FASTIFY — POST /agent/process
// ─────────────────────────────────────────────────────────────────────────────
module.exports = async function (fastify) {

  fastify.post('/process', {
    schema: {
      body: {
        type: 'object',
        required: ['telefono', 'mensaje'],
        properties: {
          telefono: { type: 'string', minLength: 7 },
          mensaje:  { type: 'string', minLength: 1, maxLength: 2000 },
          canal:    { type: 'string', default: 'whatsapp' },
        }
      }
    },
    // Sin timeout de Fastify — OpenAI puede tardar hasta 20s
    config: { rawBody: false },
  }, async (request, reply) => {

    const { telefono, mensaje, canal = 'whatsapp' } = request.body
    const tel   = telefono.replace(/\D/g, '').slice(-10)
    const inicio = Date.now()

    fastify.log.info(`[L.I.N.D.A.][OpenAI] ← ${tel}: "${mensaje.slice(0, 80)}"`)

    try {
      // ── 1. Buscar cuenta del cliente ────────────────────────────────────
      const { data: cuentas } = await supabase
        .from('cuentas_cobranza')
        .select('*')
        .or(`telefono.ilike.%${tel}%,telefonos.ilike.%${tel}%`)
        .eq('regularizada', false)
        .order('dm', { ascending: false })
        .limit(1)

      // ── 2. Cuenta encontrada o valores por defecto ───────────────────────
      const cuentaEncontrada = !!(cuentas?.length)
      const cuenta = cuentaEncontrada ? cuentas[0] : {
        nombre:              'Cliente no identificado',
        plan:                null,
        folio:               null,
        dm:                  0,
        total:               0,
        cuotas:              0,
        saldo:               0,
        noCuotas:            0,
        comportamiento:      'Desconocido',
        empresa:             'No registrada',
        telefono:            tel,
      }

      const folio       = cuenta.plan || cuenta.folio || null
      const telefCuenta = cuenta.telefono || tel

      if (!cuentaEncontrada) {
        fastify.log.warn(`[L.I.N.D.A.] Sin cuenta para ${tel} — usando contexto genérico`)
      }

      // ── 3. Cargar datos relacionados (solo si hay folio) ─────────────────
      let gestiones = [], promesas = [], historial = []

      if (folio) {
        const [
          { data: g },
          { data: p },
          { data: h },
        ] = await Promise.all([
          supabase.from('gestiones')
            .select('canal,estatus,nota,created_at')
            .eq('plan', folio)
            .order('created_at', { ascending: false })
            .limit(1),

          supabase.from('promesas')
            .select('monto,fecha_compromiso,estatus')
            .eq('plan', folio)
            .eq('estatus', 'pendiente')
            .order('fecha_compromiso', { ascending: true }),

          supabase.from('conversaciones')
            .select('mensaje_cliente,respuesta_linda')
            .eq('plan', folio)
            .order('created_at', { ascending: false })
            .limit(3),
        ])
        gestiones = g || []
        promesas  = p || []
        historial = (h || []).reverse().map(c => ({ cliente: c.mensaje_cliente, linda: c.respuesta_linda }))
      }

      // ── 4. Construir contexto ────────────────────────────────────────────
      const contexto = buildContext(cuenta, gestiones[0] || null, promesas)

      // ── 5. Invocar L.I.N.D.A. (siempre) ─────────────────────────────────
      const linda = await callLINDA(contexto, mensaje, historial)

      fastify.log.info(
        `[L.I.N.D.A.] → intent=${linda.intent} | resultado=${linda.management_result}` +
        `${linda.should_escalate ? ' | ⚠️ ESCALAR' : ''}` +
        ` | ${Date.now() - inicio}ms`
      )

      // ── 6. Ejecutar acciones en paralelo (sin bloquear respuesta) ────────
      await Promise.allSettled([
        registrarGestion(folio || tel, canal, linda),
        registrarPromesa(folio || tel, telefCuenta, linda),
        programarSeguimiento(folio || tel, telefCuenta, linda),
        guardarConversacion(folio || tel, telefCuenta, mensaje, linda),
      ])

      // ── 7. Respuesta final ───────────────────────────────────────────────
      return {
        ok:                     cuentaEncontrada,
        plan:                   folio,
        nombre:                 cuenta.nombre || cuenta.nombre_cliente || null,
        reply:                  linda.reply,
        intent:                 linda.intent,
        management_result:      linda.management_result,
        commitment_amount:      linda.commitment_amount,
        commitment_date:        linda.commitment_date,
        should_schedule_followup: linda.should_schedule_followup,
        followup_date:          linda.followup_date,
        should_escalate:        linda.should_escalate,
        actions:                linda.actions,
        duracion_ms:            Date.now() - inicio,
      }

    } catch (err) {
      fastify.log.error(`[L.I.N.D.A.] Error fatal: ${err.message}`)
      return reply.status(500).send({
        ok:     false,
        error:  err.message,
        reply:  'En este momento no podemos atenderle. Por favor llame al 442 394 5911.',
        intent: 'sin_intencion',
        actions: ['escalar_caso'],
      })
    }
  })
}
