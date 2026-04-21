'use strict'

/**
 * MÓDULO DE PRIORIDAD OPERATIVA
 *
 * Complementa a src/modules/scoring (score crediticio + geográfico) con
 * flags operativas propias de la disciplina Espartanos:
 *
 *   - díasSinGestión
 *   - faltaVisitaPresencial
 *   - promesaIncumplida
 *   - avanceSemanalEjecutivo (penaliza si el gestor ya cumplió meta)
 *
 * La fórmula combina el scoreCuenta existente con estos bonus/penalizaciones
 * para producir el "ranking accionable" que consume el tablero.
 *
 * IMPORTANTE: no reemplaza al scoring geográfico del motor de rutas.
 */

const { calcularScoreCuenta, calcularScoreUrgencia } = require('../scoring')

// ─────────────────────────────────────────────────────────────────────────────
// PESOS OPERATIVOS
// ─────────────────────────────────────────────────────────────────────────────

const PESOS = {
  base:             1.00,   // Peso del scoreCuenta base
  staleGestion:     1.50,   // Puntos por cada día sin gestión (cap a 10 días)
  sinVisitaPres:    8.00,   // Bonus si aún no hay visita presencial
  promesaRota:     12.00,   // Bonus si incumplió promesa de pago
  avanceEjecutivo: 10.00,   // Penalización si el gestor ya está sobre-cubierto (0-1)
}

const STALE_CAP_DIAS = 10

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula días desde la última gestión a partir de un ISO date.
 */
function calcularDiasSinGestion(ultimaGestionAt, hoy = new Date()) {
  if (!ultimaGestionAt) return STALE_CAP_DIAS
  const last = new Date(ultimaGestionAt)
  const diffMs = hoy.getTime() - last.getTime()
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)))
}

// ─────────────────────────────────────────────────────────────────────────────
// CÁLCULO DE PRIORIDAD OPERATIVA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula la prioridad operativa [0-100] de una cuenta.
 *
 * @param {Object} cuenta             Fila de cuentas_cobranza (con segmento, comportamiento_historico, monto_vencido, etc.)
 * @param {Object} ctx                Contexto operativo
 * @param {number} ctx.diasSinGestion
 * @param {boolean} ctx.faltaVisitaPresencial
 * @param {boolean} ctx.promesaIncumplida
 * @param {number} ctx.avanceEjecutivo    0..1, fracción de cobertura semanal ya lograda
 * @param {Object} [ctx.posicionUsuario]  { lat, lng } opcional: si se pasa, usa scoreCuenta completo
 * @param {string} [ctx.clusterActivo]
 */
function calculatePriority(cuenta, ctx = {}) {
  const {
    diasSinGestion        = STALE_CAP_DIAS,
    faltaVisitaPresencial = false,
    promesaIncumplida     = false,
    avanceEjecutivo       = 0,
    posicionUsuario       = null,
    clusterActivo         = null,
  } = ctx

  // Score base: si hay posición, usamos el scoring completo; si no, solo urgencia.
  const scoreBase = posicionUsuario
    ? calcularScoreCuenta(cuenta, posicionUsuario, clusterActivo)
    : calcularScoreUrgencia(cuenta)

  // Bonus por días sin gestión (cap a STALE_CAP_DIAS)
  const staleBonus = Math.min(diasSinGestion, STALE_CAP_DIAS) * PESOS.staleGestion

  // Bonus por falta de visita presencial
  const visitaBonus = faltaVisitaPresencial ? PESOS.sinVisitaPres : 0

  // Bonus por promesa incumplida
  const promesaBonus = promesaIncumplida ? PESOS.promesaRota : 0

  // Penalización: si el gestor ya logró >80% de cobertura, bajamos prioridad
  // de sus cuentas extra para redirigir esfuerzo al gestor atrasado.
  const avancePenalty = avanceEjecutivo > 0.80
    ? (avanceEjecutivo - 0.80) * PESOS.avanceEjecutivo * 5
    : 0

  const score =
    (scoreBase * PESOS.base)
    + staleBonus
    + visitaBonus
    + promesaBonus
    - avancePenalty

  return Math.min(100, Math.max(0, +score.toFixed(2)))
}

/**
 * Toma un arreglo de cuentas ya enriquecidas con contexto operativo y las
 * ordena por prioridad descendente. Devuelve copia ordenada (no muta).
 */
function ordenarPorPrioridad(cuentasConCtx) {
  return [...cuentasConCtx]
    .map(({ cuenta, ctx }) => ({
      ...cuenta,
      prioridad: calculatePriority(cuenta, ctx),
      flags:     flagsDe(cuenta, ctx),
    }))
    .sort((a, b) => b.prioridad - a.prioridad)
}

/**
 * Genera la lista de flags operativas legibles para el tablero.
 */
function flagsDe(cuenta, ctx = {}) {
  const flags = []
  if (ctx.faltaVisitaPresencial)               flags.push('SIN_VISITA_PRESENCIAL')
  if (ctx.promesaIncumplida)                   flags.push('PROMESA_INCUMPLIDA')
  if ((ctx.diasSinGestion ?? 0) >= 5)          flags.push('SIN_GESTION_RECIENTE')
  if (cuenta.segmento === '91-120')            flags.push('CRITICA')
  if (cuenta.segmento === '61-90')             flags.push('RIESGO_ALTO')
  return flags
}

module.exports = {
  calculatePriority,
  calcularDiasSinGestion,
  ordenarPorPrioridad,
  flagsDe,
  PESOS,
  STALE_CAP_DIAS,
}
