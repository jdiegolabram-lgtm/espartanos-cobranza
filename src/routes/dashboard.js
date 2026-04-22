'use strict'

/**
 * RUTAS DEL TABLERO
 *
 * Expone los endpoints que consume el front del tablero:
 *   GET /api/dashboard/daily
 *   GET /api/dashboard/weekly
 *   GET /api/dashboard/pending
 *
 * NOTA: para activarlas, registrar en server.js:
 *   app.register(require('./src/routes/dashboard'), { prefix: '/api/dashboard' })
 */

const {
  buildDailyExecutiveSummary,
  buildWeeklyCoverage,
  getPendingAccounts,
  runLindaTrackingPipeline,
} = require('../modules/tracking')

module.exports = async function (fastify) {

  /**
   * GET /api/dashboard/daily
   * Resumen diario por gestor.
   */
  fastify.get('/daily', {
    schema: {
      querystring: {
        type: 'object',
        required: ['fecha', 'gestor_id'],
        properties: {
          fecha:     { type: 'string', format: 'date' },
          gestor_id: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { fecha, gestor_id } = request.query
      const data = await buildDailyExecutiveSummary({ gestorId: gestor_id, fecha })
      return data
    } catch (err) {
      request.log.error(err)
      return reply.status(500).send({ error: err.message })
    }
  })

  /**
   * GET /api/dashboard/weekly
   * Acumulado semanal con corte jueves.
   */
  fastify.get('/weekly', {
    schema: {
      querystring: {
        type: 'object',
        required: ['semanaISO'],
        properties: {
          semanaISO: { type: 'string', pattern: '^\\d{4}-W\\d{2}$' },
          zona:      { type: 'string' },
          gestor_id: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { semanaISO, zona, gestor_id } = request.query
      const data = await buildWeeklyCoverage({
        semanaISO,
        zona:     zona     || null,
        gestorId: gestor_id || null,
      })
      return data
    } catch (err) {
      request.log.error(err)
      return reply.status(500).send({ error: err.message })
    }
  })

  /**
   * GET /api/dashboard/pending
   * Cuentas pendientes accionables (ya priorizadas).
   */
  fastify.get('/pending', async (request, reply) => {
    try {
      const {
        gestor_id,
        zona,
        incluir_sin_visita     = 'true',
        incluir_promesas_rotas = 'true',
        limit                  = 200,
      } = request.query

      const cuentas = await getPendingAccounts({
        gestorId:             gestor_id || null,
        zona:                 zona      || null,
        incluirSinVisita:     String(incluir_sin_visita)     !== 'false',
        incluirPromesasRotas: String(incluir_promesas_rotas) !== 'false',
        limit:                Math.min(Number(limit) || 200, 1000),
      })

      return { total: cuentas.length, cuentas }
    } catch (err) {
      request.log.error(err)
      return reply.status(500).send({ error: err.message })
    }
  })

  /**
   * GET /api/dashboard/debug-env
   * ENDPOINT TEMPORAL DE DIAGNÓSTICO
   * Devuelve metadata de LINDA_OPENAI_KEY (y fallback OPENAI_API_KEY) sin exponer el valor completo.
   * Uso: diagnosticar por qué OpenAI devuelve 401 a pesar de tener key fresca.
   * ELIMINAR una vez resuelto el 401.
   */
  fastify.get('/debug-env', async () => {
    const meta = (k) => ({
      defined:       k.length > 0,
      length:        k.length,
      startsWith:    k.slice(0, 12),
      endsWith:      k.slice(-4),
      startsProj:    k.startsWith('sk-proj-'),
      hasLeadingWs:  k !== k.trimStart(),
      hasTrailingWs: k !== k.trimEnd(),
      hasInnerWs:    /\s/.test(k.slice(1, -1)),
      sameAfterTrim: k === k.trim(),
    })
    const linda = process.env.LINDA_OPENAI_KEY || ''
    const legacy = process.env.OPENAI_API_KEY || ''
    return {
      LINDA_OPENAI_KEY: meta(linda),
      OPENAI_API_KEY:   meta(legacy),
      usedVariable:     linda.length > 0 ? 'LINDA_OPENAI_KEY' : (legacy.length > 0 ? 'OPENAI_API_KEY' : 'NONE'),
      model:            process.env.OPENAI_MODEL || 'gpt-4o-mini',
    }
  })

  /**
   * POST /api/dashboard/pipeline
   * Ejecuta el pipeline maestro runLindaTrackingPipeline para una fecha.
   */
  fastify.post('/pipeline', {
    schema: {
      body: {
        type: 'object',
        required: ['fecha'],
        properties: {
          fecha: { type: 'string', format: 'date' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { fecha } = request.body
      const out = await runLindaTrackingPipeline({ fecha })
      return out
    } catch (err) {
      request.log.error(err)
      return reply.status(500).send({ error: err.message })
    }
  })
}
