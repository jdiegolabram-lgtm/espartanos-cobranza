'use strict'

const supabase = require('../config/supabase')

module.exports = async function (fastify) {

  /**
   * POST /api/seguimientos
   * Programa un seguimiento.
   */
  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['cuenta_id', 'fecha_prog'],
        properties: {
          cuenta_id:  { type: 'string' },
          fecha_prog: { type: 'string' },
          motivo:     { type: 'string' },
          canal:      { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { data, error } = await supabase
      .from('seguimientos')
      .insert(request.body)
      .select('id')
      .single()

    if (error) return reply.status(500).send({ error: error.message })
    return { ok: true, id: data.id }
  })

  /**
   * GET /api/seguimientos/pendientes
   * Seguimientos cuya fecha ya llegó y no han sido completados.
   * Usado por el cron diario de n8n.
   */
  fastify.get('/pendientes', async (request, reply) => {
    const hoy = new Date().toISOString().split('T')[0]

    const { data, error } = await supabase
      .from('seguimientos')
      .select(`
        *,
        cuenta:cuentas_cobranza(folio, nombre_cliente, telefono, dias_mora, monto_vencido, comportamiento_historico)
      `)
      .eq('completado', false)
      .lte('fecha_prog', hoy)
      .order('fecha_prog', { ascending: true })

    if (error) return reply.status(500).send({ error: error.message })
    return { seguimientos: data || [], total: data?.length || 0 }
  })

  /**
   * PATCH /api/seguimientos/:id/completar
   */
  fastify.patch('/:id/completar', async (request, reply) => {
    const { id } = request.params

    const { error } = await supabase
      .from('seguimientos')
      .update({ completado: true })
      .eq('id', id)

    if (error) return reply.status(500).send({ error: error.message })
    return { ok: true }
  })

  /**
   * PATCH /api/seguimientos/:id/escalar
   */
  fastify.patch('/:id/escalar', async (request, reply) => {
    const { id } = request.params

    const { error } = await supabase
      .from('seguimientos')
      .update({ escalado: true, completado: true })
      .eq('id', id)

    if (error) return reply.status(500).send({ error: error.message })
    return { ok: true }
  })
}
