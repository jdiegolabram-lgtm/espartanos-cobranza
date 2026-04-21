'use strict'

/**
 * RUTAS DE EXPORTABLES
 *
 *   GET /api/exports/pending            descarga XLSX/CSV/JSON de pendientes del día
 *   GET /api/exports/sin-visita         cuentas sin visita presencial
 *   GET /api/exports/sin-gestion        cuentas sin gestión en la semana
 *
 * Para activar, registrar en server.js:
 *   app.register(require('./src/routes/exports'), { prefix: '/api/exports' })
 */

const { buildExecutiveExport } = require('../modules/exports')

function _enviarArchivo(reply, { buffer, mime, filename }) {
  reply
    .header('Content-Type', mime)
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .send(buffer)
}

module.exports = async function (fastify) {

  /**
   * GET /api/exports/pending
   * Pendientes del día por gestor / zona / segmento.
   */
  fastify.get('/pending', async (request, reply) => {
    try {
      const {
        gestor_id,
        zona,
        segmento,
        formato = 'xlsx',
      } = request.query

      const tipo = segmento
        ? 'PENDIENTES_SEGMENTO'
        : (zona ? 'PENDIENTES_ZONA' : 'PENDIENTES_DIA')

      const out = await buildExecutiveExport({
        tipo,
        formato,
        gestorId: gestor_id || null,
        zona:     zona      || null,
        segmento: segmento  || null,
      })

      return _enviarArchivo(reply, out)
    } catch (err) {
      request.log.error(err)
      return reply.status(500).send({ error: err.message })
    }
  })

  /**
   * GET /api/exports/sin-visita
   * Cuentas sin visita presencial.
   */
  fastify.get('/sin-visita', async (request, reply) => {
    try {
      const { formato = 'xlsx' } = request.query
      const out = await buildExecutiveExport({
        tipo: 'CUENTAS_SIN_VISITA_PRES',
        formato,
      })
      return _enviarArchivo(reply, out)
    } catch (err) {
      request.log.error(err)
      return reply.status(500).send({ error: err.message })
    }
  })

  /**
   * GET /api/exports/sin-gestion
   * Cuentas sin gestión reciente (contexto semanal).
   */
  fastify.get('/sin-gestion', async (request, reply) => {
    try {
      const { semanaISO, formato = 'xlsx' } = request.query
      const out = await buildExecutiveExport({
        tipo:      'CUENTAS_SIN_GESTION',
        formato,
        semanaISO: semanaISO || null,
      })
      return _enviarArchivo(reply, out)
    } catch (err) {
      request.log.error(err)
      return reply.status(500).send({ error: err.message })
    }
  })
}
