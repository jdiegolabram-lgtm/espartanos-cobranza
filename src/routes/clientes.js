'use strict'

/**
 * RUTAS DE CLIENTES — /api/clientes
 *
 * GET /api/clientes?telefono=...  Busca un lead por teléfono
 * GET /api/clientes?plan=...      Busca un lead por plan/folio
 *
 * Devuelve: cuenta + última gestión + promesas activas + seguimientos pendientes
 * Usado por L.I.N.D.A. para construir contexto antes de responder
 */

const supabase = require('../config/supabase')

module.exports = async function (fastify) {

  fastify.get('/', async (request, reply) => {
    const { telefono, plan } = request.query

    if (!telefono && !plan) {
      return reply.status(400).send({ error: 'Proporciona ?telefono= o ?plan=' })
    }

    // ── Buscar cuenta ──────────────────────────────────────────────────────
    let query = supabase
      .from('cuentas_cobranza')
      .select('*')
      .eq('regularizada', false)

    if (plan) {
      query = query.eq('plan', plan)
    } else {
      // Normalizar: quitar todo lo que no sea dígito, tomar últimos 10
      const tel = telefono.replace(/\D/g, '').slice(-10)
      query = query.or(`telefono.ilike.%${tel}%,telefonos.ilike.%${tel}%`)
    }

    const { data: cuentas, error } = await query
      .order('dm', { ascending: false })
      .limit(1)

    if (error)         return reply.status(500).send({ error: error.message })
    if (!cuentas?.length) return reply.status(404).send({ error: 'Cliente no encontrado' })

    const cuenta = cuentas[0]
    const folio  = cuenta.plan || cuenta.folio

    // ── Datos relacionados en paralelo ─────────────────────────────────────
    const [
      { data: gestiones },
      { data: promesas  },
      { data: seguimientos },
      { data: conversaciones },
    ] = await Promise.all([
      supabase.from('gestiones')
        .select('canal,estatus,nota,created_at')
        .eq('plan', folio)
        .order('created_at', { ascending: false })
        .limit(5),

      supabase.from('promesas')
        .select('*')
        .eq('plan', folio)
        .eq('estatus', 'pendiente')
        .order('fecha_compromiso', { ascending: true }),

      supabase.from('seguimientos')
        .select('*')
        .eq('plan', folio)
        .eq('estatus', 'pendiente')
        .order('fecha_programada', { ascending: true }),

      supabase.from('conversaciones')
        .select('intent,management_result,created_at')
        .eq('plan', folio)
        .order('created_at', { ascending: false })
        .limit(3),
    ])

    // ── Calcular bucket explícito ──────────────────────────────────────────
    const dm = cuenta.dm || cuenta.dias_mora || 0
    const bucket =
      dm <= 0  ? '0' :
      dm <= 30 ? '1 a 30' :
      dm <= 60 ? '31 a 60' :
      dm <= 89 ? '61 a 89' : '90+'

    return {
      ok: true,
      cliente: {
        // Identificación
        plan:            folio,
        nombre:          cuenta.nombre || cuenta.nombre_cliente,
        telefono:        cuenta.telefono,
        telefonos:       cuenta.telefonos,
        email:           cuenta.email,

        // Crédito
        bucket,
        dm,
        seg:             cuenta.seg || cuenta.segmento || bucket,
        comportamiento:  cuenta.comportamiento || cuenta.comportamiento_historico || 'Regular',
        empresa:         cuenta.empresa,

        // Montos
        importe_vencido: cuenta.total      || cuenta.monto_vencido  || 0,
        proximo_vencer:  cuenta.cuotas     || cuenta.pago_vencido   || 0,
        saldo_total:     cuenta.saldo      || cuenta.saldo_total    || 0,
        pagos_vencidos:  cuenta.noCuotas   || 1,
        clabe:           cuenta.clabe,

        // Historial
        ultima_gestion:       gestiones?.[0]     || null,
        ultimas_gestiones:    gestiones           || [],
        promesas_activas:     promesas            || [],
        seguimientos_pendientes: seguimientos     || [],
        conversaciones_recientes: conversaciones  || [],
      }
    }
  })
}
