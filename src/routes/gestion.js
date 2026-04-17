'use strict'

const supabase = require('../config/supabase')

module.exports = async function (fastify) {

  /**
   * POST /api/gestion
   * Registra una gestión manualmente (complementa al agente).
   */
  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['cuenta_id', 'canal', 'resultado'],
        properties: {
          cuenta_id:   { type: 'string' },
          canal:       { type: 'string' },
          tipo:        { type: 'string' },
          mensaje_in:  { type: 'string' },
          mensaje_out: { type: 'string' },
          intent:      { type: 'string' },
          resultado:   { type: 'string' },
          agente:      { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { data, error } = await supabase
      .from('gestiones')
      .insert(request.body)
      .select('id')
      .single()

    if (error) return reply.status(500).send({ error: error.message })
    return { ok: true, id: data.id }
  })

  /**
   * GET /api/gestion/cuenta/:cuenta_id
   * Historial de gestiones de una cuenta.
   */
  fastify.get('/cuenta/:cuenta_id', async (request, reply) => {
    const { cuenta_id } = request.params
    const limit  = Math.min(Number(request.query.limit  ?? 20), 100)
    const offset = Number(request.query.offset ?? 0)

    const { data, error } = await supabase
      .from('gestiones')
      .select('*')
      .eq('cuenta_id', cuenta_id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) return reply.status(500).send({ error: error.message })
    return { gestiones: data || [], total: data?.length || 0 }
  })
}
