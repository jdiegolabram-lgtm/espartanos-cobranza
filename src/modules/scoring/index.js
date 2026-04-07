'use strict'

/**
 * MÓDULO DE SCORING
 *
 * Calcula dos tipos de score:
 *  1. Score de Cuenta (0-100) — qué tan urgente es visitar esta cuenta
 *  2. Score de Zona (0-100)   — qué tan conveniente es ir a esta zona
 *
 * El Score de Cuenta tiene dos componentes:
 *  - Estático (crediticio): segmento + comportamiento + monto → no cambia
 *  - Dinámico (geográfico): distancia al usuario → recalcula en cada movimiento
 *
 * Reglas de negocio hard-coded:
 *  - Segmentos 1-7, 8-15, 16-30: COMPORTAMIENTO es el criterio principal
 *  - Segmento 31-60: comportamiento primero, luego monto vencido
 *  - Segmentos 61-90, 91-120: el segmento domina sobre todo lo demás
 */

const { haversine } = require('../geocodificacion')

// ─────────────────────────────────────────────────────────────────────────────
// TABLAS DE PESOS
// ─────────────────────────────────────────────────────────────────────────────

const PESO_SEGMENTO = {
  '91-120': 40,
  '61-90':  33,
  '31-60':  24,
  '16-30':  15,
  '8-15':   9,
  '1-7':    4,
  '0':      1,
}

const PESO_COMPORTAMIENTO = {
  malo:    25,
  regular: 15,
  bueno:   7,
}

// Monto de referencia para normalización del score de monto
const MONTO_REFERENCIA = 50000

// ─────────────────────────────────────────────────────────────────────────────
// SCORE DE CUENTA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula el score estático de urgencia crediticia de una cuenta.
 * No depende de la posición del usuario.
 *
 * Ponderaciones por tipo de segmento:
 *  - Segmentos tempranos (1-30): comportamiento pesa 50%, segmento 25%, monto 10%, bonus 15%
 *  - Segmentos críticos (31-120): segmento pesa 45%, comportamiento 30%, monto 15%, bonus 10%
 */
function calcularScoreUrgencia(cuenta) {
  const segmento        = cuenta.segmento || '0'
  const comportamiento  = cuenta.comportamiento_historico || 'regular'
  const montoVencido    = cuenta.monto_vencido || 0

  const A = PESO_SEGMENTO[segmento] || 1
  const B = PESO_COMPORTAMIENTO[comportamiento] || 15
  const C = Math.min(15, (montoVencido / MONTO_REFERENCIA) * 15)

  // En segmentos tempranos: el comportamiento es el criterio principal
  const esSegmentoTemprano = ['0', '1-7', '8-15', '16-30'].includes(segmento)

  let score
  if (esSegmentoTemprano) {
    score = (A * 0.25) + (B * 0.55) + (C * 0.10) + (A === 1 ? 0 : 10 * 0.10)
  } else {
    score = (A * 0.45) + (B * 0.30) + (C * 0.15) + 5 * 0.10
  }

  return Math.min(100, Math.max(0, +score.toFixed(2)))
}

/**
 * Calcula el score completo de una cuenta incluyendo el componente geográfico.
 * Este score es dinámico y debe recalcularse cuando el usuario se mueve.
 *
 * @param {Object} cuenta          - Cuenta normalizada con lat/lng
 * @param {Object} posicionUsuario - { lat, lng } posición actual del gestor
 * @param {string} clusterActivo   - ID del cluster que se está trabajando actualmente
 */
function calcularScoreCuenta(cuenta, posicionUsuario, clusterActivo = null) {
  const urgencia = calcularScoreUrgencia(cuenta)

  // Componente geográfico: inversamente proporcional a la distancia
  let scoreGeo = 0
  if (posicionUsuario && cuenta.lat && cuenta.lng) {
    const distKm = haversine(posicionUsuario.lat, posicionUsuario.lng, cuenta.lat, cuenta.lng)
    if      (distKm <= 0.1) scoreGeo = 20
    else if (distKm <= 0.3) scoreGeo = 17
    else if (distKm <= 0.6) scoreGeo = 13
    else if (distKm <= 1.0) scoreGeo = 9
    else if (distKm <= 2.0) scoreGeo = 5
    else if (distKm <= 5.0) scoreGeo = 2
    else                    scoreGeo = 0
  }

  // Bonus contextuales
  let bonus = 0
  if (cuenta.es_cuenta_de_paso)                  bonus += 10  // estaba en el camino
  if (cuenta.cluster_id === clusterActivo)        bonus += 15  // en la zona activa
  if (cuenta.precision_nivel <= 2)               bonus += 3   // dirección confiable
  if (cuenta.segmento === '91-120')              bonus += 5   // cuenta crítica

  const scoreFinal = (urgencia * 0.65) + (scoreGeo * 0.25) + (bonus * 0.10)
  return Math.min(100, Math.max(0, +scoreFinal.toFixed(2)))
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORE DE ZONA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula el score de una zona (cluster) considerando:
 *  - Peso crediticio agregado de las cuentas pendientes
 *  - Densidad y volumen de cuentas
 *  - Cercanía al usuario
 *  - Compactación territorial
 *  - Presencia de cuentas 91-120 (bonus crítico)
 *
 * @param {Object}   cluster          - Objeto de cluster con resumen
 * @param {Object}   posicionUsuario  - { lat, lng }
 * @param {string[]} cuentasPendientes - IDs de cuentas aún por visitar
 * @param {Function} getCuenta        - Función para obtener cuenta por ID
 */
function calcularScoreZona(cluster, posicionUsuario, cuentasPendientes, getCuenta) {
  const pendientesEnZona = (cluster.cuentas || [])
    .filter(id => cuentasPendientes.includes(id))
    .map(id => getCuenta(id))
    .filter(Boolean)

  if (pendientesEnZona.length === 0) return 0

  // A: Peso crediticio agregado (normalizado)
  const pesoCrediticioTotal = pendientesEnZona.reduce((acc, c) => {
    const ps = PESO_SEGMENTO[c.segmento] || 1
    const pc = PESO_COMPORTAMIENTO[c.comportamiento_historico] || 15
    return acc + (ps + pc)
  }, 0)
  const pesoCrediticioMax = (40 + 25) * pendientesEnZona.length
  const A = (pesoCrediticioTotal / pesoCrediticioMax) * 100

  // B: Volumen de cuentas pendientes (normalizado contra referencia de 30)
  const B = Math.min(100, (pendientesEnZona.length / 30) * 100)

  // C: Cercanía al usuario
  const distKm = haversine(
    posicionUsuario.lat, posicionUsuario.lng,
    cluster.centroide_lat, cluster.centroide_lng
  )
  let C
  if      (distKm <= 0.5) C = 100
  else if (distKm <= 1.0) C = 85
  else if (distKm <= 2.0) C = 65
  else if (distKm <= 4.0) C = 45
  else if (distKm <= 8.0) C = 25
  else if (distKm <= 15)  C = 10
  else                    C = 2

  // D: Compactación (0-1 ya está normalizado)
  const D = (cluster.compactacion || 0.5) * 100

  // Bonus: presencia de cuentas críticas 91-120
  const tieneCriticas = pendientesEnZona.some(c => c.segmento === '91-120')
  const bonus = tieneCriticas ? 20 : 0

  // Penalización: zona parcialmente trabajada pero no terminada
  const completadas = (cluster.cuentas || []).length - pendientesEnZona.length
  const pctCompletado = cluster.cuentas?.length > 0
    ? completadas / cluster.cuentas.length
    : 0
  const penalizacion = (pctCompletado > 0 && pctCompletado < 1) ? -15 : 0

  const score = (A * 0.35) + (B * 0.20) + (C * 0.25) + (D * 0.10) + (bonus * 0.10) + penalizacion
  return Math.min(100, Math.max(0, +score.toFixed(2)))
}

module.exports = {
  calcularScoreUrgencia,
  calcularScoreCuenta,
  calcularScoreZona,
  PESO_SEGMENTO,
  PESO_COMPORTAMIENTO,
}
