'use strict'

const supabase = require('../config/supabase')

module.exports = async function (fastify) {

  /**
   * POST /api/promesa
   * Registra una promesa de pago.
   */
  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['cuenta_id', 'monto_prometido', 'fecha_promesa'],
        properties: {
          cuenta_id:       { type: 'string' },
          monto_prometido: { type: 'number' },
          fecha_promesa:   { type: 'string' },
          canal:           { type: 'string' },
          notas:           { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { data, error } = await supabase
      .from('promesas_pago')
      .insert(request.body)
      .select('id')
      .single()

    if (error) return reply.status(500).send({ error: error.message })
    return { ok: true, id: data.id }
  })

  /**
   * GET /api/promesa/cuenta/:cuenta_id
   */
  fastify.get('/cuenta/:cuenta_id', async (request, reply) => {
    const { cuenta_id } = request.params

    const { data, error } = await supabase
      .from('promesas_pago')
      .select('*')
      .eq('cuenta_id', cuenta_id)
      .order('fecha_promesa', { ascending: true })

    if (error) return reply.status(500).send({ error: error.message })
    return { promesas: data || [] }
  })

  /**
   * PATCH /api/promesa/:id/cumplir
   * Marca una promesa como cumplida.
   */
  fastify.patch('/:id/cumplir', async (request, reply) => {
    const { id } = request.params

    const { error } = await supabase
      .from('promesas_pago')
      .update({ cumplida: true })
      .eq('id', id)

    if (error) return reply.status(500).send({ error: error.message })
    return { ok: true }
  })

  /**
   * GET /api/promesa/vencidas
   * Promesas no cumplidas con fecha ya pasada (para cron de seguimientos).
   */
  fastify.get('/vencidas', async (request, reply) => {
    const hoy = new Date().toISOString().split('T')[0]

    const { data, error } = await supabase
      .from('promesas_pago')
      .select(`
        *,
        cuenta:cuentas_cobranza(folio, nombre_cliente, telefono, dias_mora)
      `)
      .eq('cumplida', false)
      .lt('fecha_promesa', hoy)
      .order('fecha_promesa', { ascending: true })

    if (error) return reply.status(500).send({ error: error.message })
    return { promesas_vencidas: data || [], total: data?.length || 0 }
  })
}
