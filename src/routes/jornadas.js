'use strict'

const supabase = require('../config/supabase')

module.exports = async function (fastify) {

  /**
   * POST /api/jornadas
   * Crea una nueva jornada de trabajo para un gestor
   */
  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['gestor_id'],
        properties: {
          gestor_id: { type: 'string' },
          fecha:     { type: 'string' },
        }
      }
    }
  }, async (request, reply) => {
    const { gestor_id, fecha } = request.body

    const { data, error } = await supabase
      .from('jornadas')
      .insert({ gestor_id, fecha: fecha || new Date().toISOString().split('T')[0] })
      .select('*')
      .single()

    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  /**
   * GET /api/jornadas/:id
   * Obtiene el estado completo de una jornada
   */
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params

    const [{ data: jornada, error: err1 }, { data: cuentas, error: err2 }] = await Promise.all([
      supabase.from('jornadas').select('*').eq('id', id).single(),
      supabase.from('cuentas_cobranza').select('*').eq('jornada_id', id).order('score_cuenta', { ascending: false }),
    ])

    if (err1) return reply.status(500).send({ error: err1.message })
    if (err2) return reply.status(500).send({ error: err2.message })

    // Resumen por segmento
    const resumenSegmento = (cuentas || []).reduce((acc, c) => {
      acc[c.segmento] = (acc[c.segmento] || 0) + 1
      return acc
    }, {})

    // Resumen por precisión de geocoding
    const resumenPrecision = (cuentas || []).reduce((acc, c) => {
      const k = `nivel_${c.precision_nivel}`
      acc[k] = (acc[k] || 0) + 1
      return acc
    }, {})

    return {
      jornada,
      resumen: {
        total:           cuentas?.length || 0,
        pendientes:      cuentas?.filter(c => c.estado_visita === 'pendiente').length || 0,
        visitadas:       cuentas?.filter(c => c.estado_visita === 'visitada').length || 0,
        no_localizadas:  cuentas?.filter(c => c.estado_visita === 'no_localizada').length || 0,
        reprogramadas:   cuentas?.filter(c => c.estado_visita === 'reprogramada').length || 0,
        por_segmento:    resumenSegmento,
        por_precision:   resumenPrecision,
      },
      cuentas: cuentas || [],
    }
  })

  /**
   * PATCH /api/jornadas/:id/posicion
   * Actualiza la posición GPS del gestor (se llama periódicamente desde el móvil)
   */
  fastify.patch('/:id/posicion', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['lat', 'lng'],
        properties: {
          lat: { type: 'number' },
          lng: { type: 'number' },
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params
    const { lat, lng } = request.body

    const { error } = await supabase
      .from('jornadas')
      .update({
        posicion_lat:             lat,
        posicion_lng:             lng,
        posicion_actualizada_at:  new Date().toISOString(),
      })
      .eq('id', id)

    if (error) return reply.status(500).send({ error: error.message })
    return { ok: true }
  })

  /**
   * PATCH /api/jornadas/:id/cerrar
   * Cierra una jornada de trabajo
   */
  fastify.patch('/:id/cerrar', async (request, reply) => {
    const { id } = request.params

    const { data, error } = await supabase
      .from('jornadas')
      .update({ estado: 'completada', ended_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single()

    if (error) return reply.status(500).send({ error: error.message })
    return data
  })
}
