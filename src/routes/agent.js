'use strict'

const { consultarCuenta, construirContexto } = require('../modules/linda/contexto')
const { llamarLINDA }                        = require('../modules/linda/openai')
const {
  registrarGestion,
  registrarPromesa,
  programarSeguimiento,
  escalarCaso,
} = require('../modules/linda/acciones')

module.exports = async function (fastify) {

  /**
   * POST /agent/process
   * Punto de entrada principal del agente L.I.N.D.A.
   * Recibe el mensaje del cliente, consulta la cuenta,
   * llama a OpenAI y ejecuta todas las acciones necesarias.
   */
  fastify.post('/process', {
    schema: {
      body: {
        type: 'object',
        required: ['telefono', 'mensaje', 'canal'],
        properties: {
          telefono: { type: 'string' },
          mensaje:  { type: 'string' },
          canal:    { type: 'string', enum: ['whatsapp', 'sms', 'email'] },
        },
      },
    },
  }, async (request, reply) => {
    const { telefono, mensaje, canal } = request.body

    // ── 1. Consultar cliente ──────────────────────────────────
    const datos = await consultarCuenta(telefono)

    if (!datos) {
      return reply.status(404).send({
        reply:   'Lo sentimos, no encontramos información asociada a este número. Comunícate al 800 de Libertad Financiera.',
        intent:  'cliente_no_encontrado',
        actions: [],
      })
    }

    const contexto = construirContexto(datos)

    // ── 2. Llamar a L.I.N.D.A. (OpenAI) ─────────────────────
    let agentResponse
    try {
      agentResponse = await llamarLINDA(contexto, mensaje)
    } catch (err) {
      fastify.log.error('[LINDA] Error OpenAI:', err.message)
      return reply.status(500).send({ error: 'Error al procesar con IA', detail: err.message })
    }

    // ── 3. Ejecutar acciones ──────────────────────────────────
    const executed = []

    try {
      await registrarGestion({
        cuenta_id:  contexto.cuenta_id,
        canal,
        mensaje_in: mensaje,
        respuesta:  agentResponse.reply,
        intent:     agentResponse.intent,
        resultado:  agentResponse.management_result,
      })
      executed.push('registrar_gestion')

      if (agentResponse.commitment_amount && agentResponse.commitment_date) {
        await registrarPromesa({
          cuenta_id: contexto.cuenta_id,
          monto:     agentResponse.commitment_amount,
          fecha:     agentResponse.commitment_date,
          canal,
        })
        executed.push('registrar_promesa')
      }

      if (agentResponse.should_schedule_followup && agentResponse.followup_date) {
        await programarSeguimiento({
          cuenta_id: contexto.cuenta_id,
          fecha:     agentResponse.followup_date,
          motivo:    agentResponse.intent,
          canal,
        })
        executed.push('programar_seguimiento')
      }

      if (agentResponse.should_escalate) {
        await escalarCaso(contexto.cuenta_id)
        executed.push('escalar_caso')
      }
    } catch (err) {
      fastify.log.error('[LINDA] Error en acciones:', err.message)
    }

    return {
      reply:                    agentResponse.reply,
      intent:                   agentResponse.intent,
      management_result:        agentResponse.management_result,
      commitment_amount:        agentResponse.commitment_amount  ?? null,
      commitment_date:          agentResponse.commitment_date    ?? null,
      should_schedule_followup: agentResponse.should_schedule_followup ?? false,
      followup_date:            agentResponse.followup_date      ?? null,
      should_escalate:          agentResponse.should_escalate    ?? false,
      actions:                  executed,
    }
  })

  fastify.get('/health', async () => ({
    agente:    'L.I.N.D.A.',
    version:   '1.0.0',
    status:    'activo',
    timestamp: new Date().toISOString(),
  }))
}
