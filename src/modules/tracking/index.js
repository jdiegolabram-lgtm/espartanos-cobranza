'use strict'

/**
 * MÓDULO DE TRACKING L.I.N.D.A.
 *
 * Pipeline operativo de seguimiento diario/semanal que alimenta al tablero
 * y a los exportables.
 *
 * Funciones expuestas:
 *   - getBucket(diasMora)                   → segmento oficial del sistema
 *   - buildDailyExecutiveSummary({...})     → KPIs del día por gestor
 *   - buildWeeklyCoverage({...})            → acumulado semanal (corte jueves)
 *   - getPendingAccounts({...})             → cuentas accionables priorizadas
 *   - runLindaTrackingPipeline({fecha})     → pipeline maestro
 *
 * IMPORTANTE: respeta el esquema existente (cuentas_cobranza, gestiones,
 * promesas_pago, seguimientos, visitas, jornadas, gestores).
 */

const supabase = require('../../config/supabase')
const {
  calculatePriority,
  calcularDiasSinGestion,
  flagsDe,
} = require('../priority')

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────────────────────

const SEGMENTOS_TEMPRANOS = ['0', '1-7', '8-15', '16-30']
const SEGMENTOS_MEDIOS    = ['31-60']
const SEGMENTOS_CRITICOS  = ['61-90', '91-120']

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS DE FECHA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Segmentación oficial del sistema. Espeja calcular_segmento(dias) en SQL.
 */
function getBucket(diasMora) {
  const d = Number(diasMora ?? 0)
  if (d === 0)                 return '0'
  if (d >= 1   && d <= 7)      return '1-7'
  if (d >= 8   && d <= 15)     return '8-15'
  if (d >= 16  && d <= 30)     return '16-30'
  if (d >= 31  && d <= 60)     return '31-60'
  if (d >= 61  && d <= 90)     return '61-90'
  return '91-120'
}

/**
 * Rango [inicio, fin) de una semana ISO (lunes 00:00 → lunes siguiente).
 */
function rangoSemanaISO(semanaISO) {
  const [yearStr, weekStr] = semanaISO.split('-W')
  const year = Number(yearStr)
  const week = Number(weekStr)
  // 4 de enero siempre está en la semana 1 ISO
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Dow = jan4.getUTCDay() || 7          // 1..7 (lunes..domingo)
  const mondayWeek1 = new Date(jan4)
  mondayWeek1.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1))
  const inicio = new Date(mondayWeek1)
  inicio.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7)
  const fin = new Date(inicio)
  fin.setUTCDate(inicio.getUTCDate() + 7)
  return { inicio, fin }
}

function rangoDia(fecha) {
  const inicio = new Date(`${fecha}T00:00:00.000Z`)
  const fin    = new Date(`${fecha}T23:59:59.999Z`)
  return { inicio, fin }
}

// ─────────────────────────────────────────────────────────────────────────────
// RESUMEN DIARIO POR GESTOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * KPIs del día para un gestor: visitas, promesas, pagos y cobertura.
 *
 * @param {Object} input
 * @param {string} input.gestorId  UUID del gestor
 * @param {string} input.fecha     'YYYY-MM-DD'
 */
async function buildDailyExecutiveSummary({ gestorId, fecha }) {
  const { inicio, fin } = rangoDia(fecha)

  // 1. Visitas del día (tabla visitas existente)
  const { data: visitas, error: errV } = await supabase
    .from('visitas')
    .select('id, resultado, monto_cobrado, cuenta_id')
    .eq('gestor_id', gestorId)
    .gte('visitada_at', inicio.toISOString())
    .lte('visitada_at', fin.toISOString())

  if (errV) throw new Error(`buildDailyExecutiveSummary.visitas: ${errV.message}`)

  // 2. Jornada del día (para calcular cobertura)
  const { data: jornada } = await supabase
    .from('jornadas')
    .select('id, total_cuentas, cuentas_visitadas')
    .eq('gestor_id', gestorId)
    .eq('fecha', fecha)
    .maybeSingle()

  const totales = {
    visitas:          visitas?.length ?? 0,
    promesas:         visitas?.filter(v => v.resultado === 'promesa_pago').length ?? 0,
    pagos_recibidos:  visitas?.filter(v => ['pago_total','pago_parcial'].includes(v.resultado)).length ?? 0,
    monto_recuperado: visitas?.reduce((acc, v) => acc + Number(v.monto_cobrado || 0), 0) ?? 0,
  }

  const coberturaDia = jornada?.total_cuentas
    ? +(jornada.cuentas_visitadas / jornada.total_cuentas).toFixed(2)
    : 0

  return {
    fecha,
    gestor_id:  gestorId,
    ...totales,
    cobertura_dia: coberturaDia,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COBERTURA SEMANAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Acumulado semanal con corte jueves.
 *
 * @param {Object} input
 * @param {string} input.semanaISO  'YYYY-Www' (ej. '2026-W16')
 * @param {string} [input.zona]     Filtro opcional por zona
 * @param {string} [input.gestorId] Filtro opcional por gestor
 */
async function buildWeeklyCoverage({ semanaISO, zona = null, gestorId = null }) {
  const { inicio, fin } = rangoSemanaISO(semanaISO)

  let q = supabase
    .from('visitas')
    .select('id, resultado, monto_cobrado, gestor_id, jornada_id, cuenta_id, visitada_at')
    .gte('visitada_at', inicio.toISOString())
    .lt('visitada_at',  fin.toISOString())

  if (gestorId) q = q.eq('gestor_id', gestorId)

  const { data: visitas, error } = await q
  if (error) throw new Error(`buildWeeklyCoverage: ${error.message}`)

  const visitasFiltradas = visitas || []

  // Cobertura: visitas únicas / cuentas asignadas
  const cuentasUnicasVisitadas = new Set(visitasFiltradas.map(v => v.cuenta_id)).size

  return {
    semanaISO,
    zona,
    gestor_id:              gestorId,
    rango:                  { inicio: inicio.toISOString(), fin: fin.toISOString() },
    visitas_totales:        visitasFiltradas.length,
    cuentas_unicas_visitadas: cuentasUnicasVisitadas,
    promesas:               visitasFiltradas.filter(v => v.resultado === 'promesa_pago').length,
    pagos:                  visitasFiltradas.filter(v => ['pago_total','pago_parcial'].includes(v.resultado)).length,
    monto_recuperado:       visitasFiltradas.reduce((acc, v) => acc + Number(v.monto_cobrado || 0), 0),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CUENTAS PENDIENTES ACCIONABLES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Devuelve cuentas pendientes enriquecidas con prioridad operativa y flags.
 *
 * @param {Object}  input
 * @param {string}  [input.gestorId]
 * @param {string}  [input.zona]
 * @param {boolean} [input.incluirSinVisita=true]
 * @param {boolean} [input.incluirPromesasRotas=true]
 * @param {number}  [input.limit=200]
 */
async function getPendingAccounts({
  gestorId              = null,
  zona                  = null,       // eslint-disable-line no-unused-vars
  incluirSinVisita      = true,       // eslint-disable-line no-unused-vars
  incluirPromesasRotas  = true,       // eslint-disable-line no-unused-vars
  limit                 = 200,
} = {}) {

  // 1. Cuentas pendientes (estado_visita='pendiente')
  let q = supabase
    .from('cuentas_cobranza')
    .select(`
      id, folio, nombre_cliente, telefono,
      segmento, dias_mora, monto_vencido, saldo_total,
      comportamiento_historico, estado_visita,
      score_cuenta, score_urgencia,
      lat, lng, cluster_id, precision_nivel, jornada_id
    `)
    .eq('estado_visita', 'pendiente')
    .limit(limit)

  const { data: cuentas, error } = await q
  if (error) throw new Error(`getPendingAccounts.cuentas: ${error.message}`)

  const ids = (cuentas || []).map(c => c.id)
  if (ids.length === 0) return []

  // 2. Última gestión por cuenta (para díasSinGestión)
  const { data: gestiones } = await supabase
    .from('gestiones')
    .select('cuenta_id, created_at, tipo')
    .in('cuenta_id', ids)
    .order('created_at', { ascending: false })

  const ultimaGestionPorCuenta = new Map()
  const tuvoVisitaPresencial   = new Map()
  ;(gestiones || []).forEach(g => {
    if (!ultimaGestionPorCuenta.has(g.cuenta_id)) {
      ultimaGestionPorCuenta.set(g.cuenta_id, g.created_at)
    }
    if (g.tipo === 'P') tuvoVisitaPresencial.set(g.cuenta_id, true)
  })

  // 3. Promesas incumplidas vigentes
  const hoyISO = new Date().toISOString().slice(0, 10)
  const { data: promesas } = await supabase
    .from('promesas_pago')
    .select('cuenta_id, fecha_promesa, cumplida')
    .in('cuenta_id', ids)
    .lt('fecha_promesa', hoyISO)
    .eq('cumplida', false)

  const promesaRotaPorCuenta = new Set((promesas || []).map(p => p.cuenta_id))

  // 4. Enriquecer + priorizar
  const enriquecidas = (cuentas || []).map(c => {
    const ctx = {
      diasSinGestion:        calcularDiasSinGestion(ultimaGestionPorCuenta.get(c.id)),
      faltaVisitaPresencial: !tuvoVisitaPresencial.get(c.id),
      promesaIncumplida:     promesaRotaPorCuenta.has(c.id),
      avanceEjecutivo:       0,   // TODO: resolver con jornada activa del gestor
    }
    return {
      ...c,
      prioridad: calculatePriority(c, ctx),
      flags:     flagsDe(c, ctx),
      ctx,
    }
  })

  return enriquecidas.sort((a, b) => b.prioridad - a.prioridad)
}

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE MAESTRO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pipeline maestro de L.I.N.D.A. para una fecha dada.
 * Encadena: pendientes → priorización → resumen por gestor activo.
 *
 * @param {Object} input
 * @param {string} input.fecha 'YYYY-MM-DD'
 */
async function runLindaTrackingPipeline({ fecha }) {
  const { data: gestoresActivos, error } = await supabase
    .from('gestores')
    .select('id, nombre')
    .eq('activo', true)

  if (error) throw new Error(`runLindaTrackingPipeline.gestores: ${error.message}`)

  const resumenes = []
  for (const g of (gestoresActivos || [])) {
    const daily = await buildDailyExecutiveSummary({ gestorId: g.id, fecha })
    resumenes.push({ gestor: g.nombre, ...daily })
  }

  const pendientes = await getPendingAccounts({ limit: 500 })

  return {
    fecha,
    ejecutado_en:     new Date().toISOString(),
    resumenes_dia:    resumenes,
    pendientes_count: pendientes.length,
    pendientes_top20: pendientes.slice(0, 20),
  }
}

module.exports = {
  getBucket,
  buildDailyExecutiveSummary,
  buildWeeklyCoverage,
  getPendingAccounts,
  runLindaTrackingPipeline,
  // helpers exportados para tests
  rangoSemanaISO,
  rangoDia,
  SEGMENTOS_TEMPRANOS,
  SEGMENTOS_MEDIOS,
  SEGMENTOS_CRITICOS,
}
