'use strict'

const supabase = require('../config/supabase')
const { normalizarCuenta, detectarDuplicados } = require('../modules/normalizacion')
const { geocodificarLote }                      = require('../modules/geocodificacion')
const { calcularScoreUrgencia }                 = require('../modules/scoring')

module.exports = async function (fastify) {

  /**
   * POST /api/cuentas/ingestar
   *
   * Recibe array de cuentas crudas, ejecuta el pipeline completo:
   *   normalización → deduplicación → geocodificación → scoring → inserción en Supabase
   */
  fastify.post('/ingestar', {
    schema: {
      body: {
        type: 'object',
        required: ['jornada_id', 'cuentas'],
        properties: {
          jornada_id: { type: 'string' },
          cuentas:    { type: 'array', minItems: 1, maxItems: 500 },
        }
      }
    }
  }, async (request, reply) => {
    const { jornada_id, cuentas } = request.body
    const inicio = Date.now()

    try {
      fastify.log.info(`[Ingestar] Iniciando pipeline: ${cuentas.length} cuentas para jornada ${jornada_id}`)

      // ── PASO 1: Normalización ──
      const normalizadas = cuentas.map(c => normalizarCuenta(c))
      fastify.log.info('[Ingestar] Paso 1 completado: normalización')

      // ── PASO 2: Detección de duplicados ──
      const duplicadosMap = detectarDuplicados(normalizadas)
      fastify.log.info(`[Ingestar] Paso 2 completado: ${duplicadosMap.size} posibles duplicados detectados`)

      // ── PASO 3: Geocodificación en cascada ──
      fastify.log.info('[Ingestar] Paso 3: iniciando geocodificación...')
      const resultadosGeo = await geocodificarLote(
        normalizadas,
        50,  // 50ms entre llamadas
        (procesadas, total) => fastify.log.info(`[Geocoding] ${procesadas}/${total}`)
      )
      fastify.log.info('[Ingestar] Paso 3 completado: geocodificación')

      // ── PASO 4: Scoring crediticio estático ──
      const cuentasListas = normalizadas.map((cuenta, idx) => {
        const geo      = resultadosGeo[idx]
        const segmento = calcularSegmento(cuenta.dias_mora || 0)
        const cuentaConSegmento = { ...cuenta, segmento }
        const scoreUrgencia = calcularScoreUrgencia(cuentaConSegmento)

        return {
          // Identificación
          folio:          cuenta.folio,
          nombre_cliente: cuenta.nombre_cliente,
          telefono:       cuenta.telefono,
          jornada_id,

          // Dirección cruda
          calle_raw:            cuenta.calle_raw,
          numero_exterior_raw:  cuenta.numero_exterior_raw,
          numero_interior_raw:  cuenta.numero_interior_raw,
          colonia_raw:          cuenta.colonia_raw,
          municipio_raw:        cuenta.municipio_raw,
          codigo_postal_raw:    cuenta.codigo_postal_raw,
          estado_raw:           cuenta.estado_raw,

          // Dirección normalizada
          calle_normalizada:      cuenta.calle_normalizada,
          colonia_normalizada:    cuenta.colonia_normalizada,
          municipio_normalizado:  cuenta.municipio_normalizado,
          codigo_postal_validado: cuenta.codigo_postal_validado,
          direccion_canonica:     cuenta.direccion_canonica,

          // Geocodificación
          lat:                geo.lat,
          lng:                geo.lng,
          precision_nivel:    geo.precision_nivel,
          geocoding_score:    geo.geocoding_score,
          fuente_geocoding:   geo.fuente_geocoding,
          geocoding_intentos: geo.geocoding_intentos || 1,

          // Crédito
          dias_mora:               cuenta.dias_mora || 0,
          // segmento se calcula automáticamente por trigger SQL
          comportamiento_historico: cuenta.comportamiento_historico || 'regular',
          monto_vencido:           cuenta.monto_vencido   || 0,
          saldo_total:             cuenta.saldo_total     || 0,
          pago_vencido:            cuenta.pago_vencido    || 0,

          // Scoring (el trigger SQL también lo calcula, esto es para consistencia)
          score_urgencia: scoreUrgencia,
          score_cuenta:   scoreUrgencia,

          // Estado
          estado_visita: 'pendiente',

          // Deduplicación
          similitud_score: duplicadosMap.has(idx)
            ? +(calcularSimilitudApprox()) : null,
        }
      })

      // ── PASO 5: Inserción en Supabase (batches de 100) ──
      const BATCH = 100
      let insertadas = 0
      const errores  = []

      for (let i = 0; i < cuentasListas.length; i += BATCH) {
        const batch = cuentasListas.slice(i, i + BATCH)
        const { data, error } = await supabase
          .from('cuentas_cobranza')
          .insert(batch)
          .select('id')

        if (error) {
          fastify.log.error(`[Ingestar] Error batch ${i}: ${error.message}`)
          errores.push(error.message)
        } else {
          insertadas += data.length
        }
      }

      // Actualizar total de cuentas en la jornada
      await supabase
        .from('jornadas')
        .update({ total_cuentas: insertadas })
        .eq('id', jornada_id)

      const duracionMs = Date.now() - inicio
      fastify.log.info(`[Ingestar] Completado: ${insertadas} cuentas en ${duracionMs}ms`)

      return {
        ok:                   true,
        insertadas,
        total_enviadas:       cuentas.length,
        duplicados_detectados: duplicadosMap.size,
        duracion_ms:          duracionMs,
        errores:              errores.length > 0 ? errores : null,
        resumen: {
          por_segmento:   contarPor(cuentasListas, 'segmento'),
          por_precision:  contarPor(cuentasListas, 'precision_nivel'),
          por_estado_geo: contarPor(cuentasListas, 'fuente_geocoding'),
        },
      }

    } catch (error) {
      fastify.log.error('[Ingestar] Error fatal:', error)
      return reply.status(500).send({ error: error.message })
    }
  })

  /**
   * GET /api/cuentas/pendientes/:jornada_id
   * Retorna cuentas pendientes ordenadas por score (mayor primero)
   */
  fastify.get('/pendientes/:jornada_id', async (request, reply) => {
    const { jornada_id } = request.params
    const { lat, lng }   = request.query

    const { data, error } = await supabase
      .from('cuentas_cobranza')
      .select('*')
      .eq('jornada_id', jornada_id)
      .eq('estado_visita', 'pendiente')
      .order('score_cuenta', { ascending: false })

    if (error) return reply.status(500).send({ error: error.message })

    return {
      cuentas: data || [],
      total:   data?.length || 0,
    }
  })

  /**
   * PATCH /api/cuentas/:id/visita
   * Registra el resultado de una visita y actualiza el estado de la cuenta
   */
  fastify.patch('/:id/visita', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['resultado', 'jornada_id'],
        properties: {
          resultado:     { type: 'string' },
          jornada_id:    { type: 'string' },
          monto_cobrado: { type: 'number' },
          notas:         { type: 'string' },
          lat:           { type: 'number' },
          lng:           { type: 'number' },
          fue_de_paso:   { type: 'boolean' },
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params
    const { resultado, jornada_id, monto_cobrado, notas, lat, lng, fue_de_paso } = request.body

    // Mapeo resultado → estado_visita en la cuenta
    const ESTADO_MAP = {
      contacto_exitoso: 'visitada',
      pago_total:       'visitada',
      pago_parcial:     'visitada',
      promesa_pago:     'visitada',
      no_localizado:    'no_localizada',
      rechazo:          'visitada',
      reprogramada:     'reprogramada',
    }

    const nuevoEstado = ESTADO_MAP[resultado] || 'visitada'

    // Actualizar estado de la cuenta y obtener score actual
    const { data: cuentaActual, error: errGet } = await supabase
      .from('cuentas_cobranza')
      .select('score_cuenta')
      .eq('id', id)
      .single()

    if (errGet) return reply.status(404).send({ error: 'Cuenta no encontrada' })

    const { error: errUpdate } = await supabase
      .from('cuentas_cobranza')
      .update({ estado_visita: nuevoEstado })
      .eq('id', id)

    if (errUpdate) return reply.status(500).send({ error: errUpdate.message })

    // Registrar visita en historial (el trigger actualiza métricas de jornada)
    const { error: errVisita } = await supabase
      .from('visitas')
      .insert({
        cuenta_id:              id,
        jornada_id,
        resultado,
        monto_cobrado:          monto_cobrado || 0,
        notas,
        visita_lat:             lat,
        visita_lng:             lng,
        fue_de_paso:            fue_de_paso || false,
        score_cuenta_al_visitar: cuentaActual?.score_cuenta,
      })

    if (errVisita) return reply.status(500).send({ error: errVisita.message })

    return { ok: true, cuenta_id: id, nuevo_estado: nuevoEstado }
  })

  /**
   * GET /api/cuentas/:id
   * Detalle de una cuenta con historial de visitas
   */
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params

    const [{ data: cuenta, error: err1 }, { data: visitas, error: err2 }] = await Promise.all([
      supabase.from('cuentas_cobranza').select('*').eq('id', id).single(),
      supabase.from('visitas').select('*').eq('cuenta_id', id).order('visitada_at', { ascending: false }),
    ])

    if (err1) return reply.status(404).send({ error: 'Cuenta no encontrada' })

    return { cuenta, visitas: visitas || [] }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS INTERNOS
// ─────────────────────────────────────────────────────────────────────────────

function calcularSegmento(dias) {
  if (dias === 0)         return '0'
  if (dias <= 7)          return '1-7'
  if (dias <= 15)         return '8-15'
  if (dias <= 30)         return '16-30'
  if (dias <= 60)         return '31-60'
  if (dias <= 90)         return '61-90'
  return '91-120'
}

function contarPor(arr, campo) {
  return arr.reduce((acc, item) => {
    const k = String(item[campo] ?? 'desconocido')
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})
}

function calcularSimilitudApprox() {
  // Placeholder — el valor real viene del módulo de normalización
  return 0.90
}
