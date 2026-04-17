'use strict'

const supabase = require('../../config/supabase')

/**
 * Consulta cliente por teléfono y sus últimas gestiones/promesas.
 * Devuelve { cuenta, gestiones, promesas } o null si no existe.
 */
async function consultarCuenta(telefono) {
  const tel10 = String(telefono).replace(/\D/g, '').slice(-10)

  const { data: cuenta, error } = await supabase
    .from('cuentas_cobranza')
    .select('*')
    .or(`telefono.eq.${tel10},telefono.eq.52${tel10},telefono.eq.+52${tel10}`)
    .order('score_cuenta', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !cuenta) return null

  const [{ data: gestiones }, { data: promesas }] = await Promise.all([
    supabase
      .from('gestiones')
      .select('canal, resultado, intent, created_at')
      .eq('cuenta_id', cuenta.id)
      .order('created_at', { ascending: false })
      .limit(3),
    supabase
      .from('promesas_pago')
      .select('monto_prometido, fecha_promesa, cumplida')
      .eq('cuenta_id', cuenta.id)
      .eq('cumplida', false)
      .order('fecha_promesa', { ascending: true })
      .limit(2),
  ])

  return { cuenta, gestiones: gestiones || [], promesas: promesas || [] }
}

/**
 * Clasifica los días de mora en el bucket de negocio.
 */
function obtenerBucket(dias) {
  if (dias <= 30)  return '1-30'
  if (dias <= 60)  return '31-60'
  return '61-90'
}

/**
 * Construye el objeto de contexto listo para enviar al agente IA.
 */
function construirContexto({ cuenta, gestiones, promesas }) {
  const bucket = obtenerBucket(cuenta.dias_mora || 0)

  const ultimaGestion = gestiones[0]
    ? `${gestiones[0].canal} / ${gestiones[0].resultado} (${new Date(gestiones[0].created_at).toLocaleDateString('es-MX')})`
    : 'Sin gestiones previas'

  const promesaActiva = promesas[0]
    ? `$${promesas[0].monto_prometido} para el ${promesas[0].fecha_promesa}`
    : 'Sin promesas activas'

  return {
    cuenta_id:       cuenta.id,
    folio:           cuenta.folio,
    nombre_cliente:  cuenta.nombre_cliente,
    telefono:        cuenta.telefono,
    correo:          cuenta.correo || null,
    bucket,
    dias_mora:       cuenta.dias_mora            || 0,
    comportamiento:  cuenta.comportamiento_historico || 'regular',
    importe_vencido: cuenta.monto_vencido        || 0,
    pago_vencido:    cuenta.pago_vencido         || 0,
    saldo_total:     cuenta.saldo_total          || 0,
    ultima_gestion:  ultimaGestion,
    promesa_activa:  promesaActiva,
  }
}

module.exports = { consultarCuenta, construirContexto }
