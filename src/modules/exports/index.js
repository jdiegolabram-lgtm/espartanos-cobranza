'use strict'

/**
 * MÓDULO DE EXPORTABLES
 *
 * Construye los reportes operativos que usa el equipo de campo:
 *   - PENDIENTES_DIA            pendientes accionables por gestor
 *   - PENDIENTES_ZONA           pendientes por zona
 *   - PENDIENTES_SEGMENTO       pendientes por segmento (1-7 … 91-120)
 *   - CUENTAS_SIN_GESTION       universo no tocado en la semana
 *   - CUENTAS_SIN_VISITA_PRES   faltan visita presencial
 *
 * Formatos soportados: xlsx | csv | json
 *
 * Depende de: src/modules/tracking (ya usa el scoring y la priority).
 */

const XLSX = require('xlsx')
const {
  getPendingAccounts,
  buildWeeklyCoverage,
} = require('../tracking')

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS DE REPORTE
// ─────────────────────────────────────────────────────────────────────────────

const TIPOS_VALIDOS = new Set([
  'PENDIENTES_DIA',
  'PENDIENTES_ZONA',
  'PENDIENTES_SEGMENTO',
  'CUENTAS_SIN_GESTION',
  'CUENTAS_SIN_VISITA_PRES',
])

const FORMATOS_VALIDOS = new Set(['xlsx', 'csv', 'json'])

// ─────────────────────────────────────────────────────────────────────────────
// COLUMNAS DE CADA REPORTE
// ─────────────────────────────────────────────────────────────────────────────

const COLUMNAS_PENDIENTES = [
  'folio', 'nombre_cliente', 'telefono',
  'segmento', 'dias_mora', 'monto_vencido', 'saldo_total',
  'comportamiento_historico',
  'prioridad', 'flags',
]

// ─────────────────────────────────────────────────────────────────────────────
// BUILDERS POR TIPO
// ─────────────────────────────────────────────────────────────────────────────

async function _rowsPendientesDia({ gestorId }) {
  const cuentas = await getPendingAccounts({ gestorId, limit: 1000 })
  return cuentas.map(c => ({
    folio:                    c.folio,
    nombre_cliente:           c.nombre_cliente,
    telefono:                 c.telefono,
    segmento:                 c.segmento,
    dias_mora:                c.dias_mora,
    monto_vencido:            Number(c.monto_vencido || 0),
    saldo_total:              Number(c.saldo_total || 0),
    comportamiento_historico: c.comportamiento_historico,
    prioridad:                c.prioridad,
    flags:                    (c.flags || []).join(' | '),
  }))
}

async function _rowsPendientesSegmento({ segmento }) {
  const cuentas = await getPendingAccounts({ limit: 2000 })
  return cuentas
    .filter(c => !segmento || c.segmento === segmento)
    .map(c => ({
      folio:                    c.folio,
      nombre_cliente:           c.nombre_cliente,
      segmento:                 c.segmento,
      dias_mora:                c.dias_mora,
      monto_vencido:            Number(c.monto_vencido || 0),
      comportamiento_historico: c.comportamiento_historico,
      prioridad:                c.prioridad,
      flags:                    (c.flags || []).join(' | '),
    }))
}

async function _rowsCuentasSinVisitaPresencial() {
  const cuentas = await getPendingAccounts({ limit: 2000 })
  return cuentas
    .filter(c => (c.flags || []).includes('SIN_VISITA_PRESENCIAL'))
    .map(c => ({
      folio:                    c.folio,
      nombre_cliente:           c.nombre_cliente,
      telefono:                 c.telefono,
      segmento:                 c.segmento,
      dias_mora:                c.dias_mora,
      monto_vencido:            Number(c.monto_vencido || 0),
      comportamiento_historico: c.comportamiento_historico,
      prioridad:                c.prioridad,
    }))
}

async function _rowsCuentasSinGestion({ semanaISO }) {
  // Señal: si tras una semana sigue en flag SIN_GESTION_RECIENTE.
  const cuentas = await getPendingAccounts({ limit: 2000 })
  const cobertura = semanaISO ? await buildWeeklyCoverage({ semanaISO }) : null
  return cuentas
    .filter(c => (c.flags || []).includes('SIN_GESTION_RECIENTE'))
    .map(c => ({
      folio:                    c.folio,
      nombre_cliente:           c.nombre_cliente,
      segmento:                 c.segmento,
      dias_mora:                c.dias_mora,
      monto_vencido:            Number(c.monto_vencido || 0),
      dias_sin_gestion:         c.ctx?.diasSinGestion ?? null,
      prioridad:                c.prioridad,
      semana_contexto:          cobertura?.semanaISO ?? null,
    }))
}

// ─────────────────────────────────────────────────────────────────────────────
// SERIALIZACIÓN
// ─────────────────────────────────────────────────────────────────────────────

function _serializar(rows, formato, sheetName = 'Reporte') {
  if (formato === 'json') {
    return {
      buffer: Buffer.from(JSON.stringify(rows, null, 2), 'utf8'),
      mime:   'application/json',
      ext:    'json',
    }
  }

  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)

  if (formato === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(ws)
    return {
      buffer: Buffer.from(csv, 'utf8'),
      mime:   'text/csv',
      ext:    'csv',
    }
  }

  // xlsx
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return {
    buffer,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext:  'xlsx',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// API PÚBLICA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construye un exportable operativo.
 *
 * @param {Object} input
 * @param {'PENDIENTES_DIA'|'PENDIENTES_ZONA'|'PENDIENTES_SEGMENTO'|'CUENTAS_SIN_GESTION'|'CUENTAS_SIN_VISITA_PRES'} input.tipo
 * @param {'xlsx'|'csv'|'json'} [input.formato='xlsx']
 * @param {string} [input.gestorId]
 * @param {string} [input.zona]
 * @param {string} [input.segmento]
 * @param {string} [input.semanaISO]
 *
 * @returns {Promise<{buffer:Buffer, mime:string, ext:string, filename:string}>}
 */
async function buildExecutiveExport({
  tipo,
  formato   = 'xlsx',
  gestorId  = null,
  zona      = null,
  segmento  = null,
  semanaISO = null,
}) {
  if (!TIPOS_VALIDOS.has(tipo))         throw new Error(`Tipo inválido: ${tipo}`)
  if (!FORMATOS_VALIDOS.has(formato))   throw new Error(`Formato inválido: ${formato}`)

  let rows
  switch (tipo) {
    case 'PENDIENTES_DIA':
    case 'PENDIENTES_ZONA':
      rows = await _rowsPendientesDia({ gestorId, zona }); break
    case 'PENDIENTES_SEGMENTO':
      rows = await _rowsPendientesSegmento({ segmento });  break
    case 'CUENTAS_SIN_VISITA_PRES':
      rows = await _rowsCuentasSinVisitaPresencial();       break
    case 'CUENTAS_SIN_GESTION':
      rows = await _rowsCuentasSinGestion({ semanaISO });   break
  }

  const { buffer, mime, ext } = _serializar(rows, formato, tipo)
  const stamp    = new Date().toISOString().slice(0, 10)
  const filename = `${tipo.toLowerCase()}_${stamp}.${ext}`

  return { buffer, mime, ext, filename, rowCount: rows.length }
}

module.exports = {
  buildExecutiveExport,
  TIPOS_VALIDOS:    [...TIPOS_VALIDOS],
  FORMATOS_VALIDOS: [...FORMATOS_VALIDOS],
  COLUMNAS_PENDIENTES,
}
