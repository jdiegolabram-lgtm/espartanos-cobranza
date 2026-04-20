'use strict'

/**
 * RUTAS DE LEADS — /api/leads
 *
 * GET  /api/leads          Lista leads desde Supabase (con filtros opcionales)
 * POST /api/leads/upload   Sube Excel → parsea → upsert en Supabase
 */

const XLSX     = require('xlsx')
const supabase = require('../config/supabase')

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de parseo Excel (misma lógica que el tablero HTML)
// ─────────────────────────────────────────────────────────────────────────────

function normHdr(s) {
  return String(s ?? '')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '')
}

function buildFindKey(headerMap) {
  return function findKey(...keywords) {
    for (const kw of keywords) {
      const n = normHdr(kw)
      if (headerMap[n] !== undefined) return headerMap[n]
    }
    for (const kw of keywords) {
      const n = normHdr(kw)
      const found = Object.keys(headerMap).find(h => h.includes(n))
      if (found) return headerMap[found]
    }
    return null
  }
}

function safeNum(v) {
  const n = parseFloat(String(v ?? '').replace(/[,$\s]/g, ''))
  return isNaN(n) ? 0 : n
}

function safeTel(v) {
  const s = String(v ?? '').replace(/\D/g, '').slice(0, 10)
  return s.length >= 7 ? s : null
}

function parseExcelBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' })

  // Elegir la hoja más relevante
  const sheetName =
    wb.SheetNames.find(s => normHdr(s).includes('CIERREQUER')) ||
    wb.SheetNames.find(s => normHdr(s).includes('NORTE'))     ||
    wb.SheetNames.find(s => normHdr(s).includes('QRO'))       ||
    wb.SheetNames.find(s => normHdr(s).includes('CARTERA'))   ||
    wb.SheetNames[0]

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { raw: true, defval: null })
  if (!rows.length) throw new Error(`Hoja "${sheetName}" vacía`)

  // Mapear encabezados
  const sampleKeys = Object.keys(rows[0] || {})
  const hMap = {}
  sampleKeys.forEach(k => { hMap[normHdr(k)] = k })
  const fk = buildFindKey(hMap)

  // Detectar columnas
  const kPlan     = fk('PLAN_PAGOS','PLAN PAGOS','NO CREDITO','CREDITO','FOLIO','PLAN')
  const kNombre   = fk('NOMBRE CLIENTE','NOMBRE DEL CLIENTE','NOMBRE','CLIENTE')
  const kCalle    = fk('DOMICILIO','CALLE','DIRECCION','DIR')
  const kColonia  = fk('COLONIA','COL')
  const kMunicipio= fk('MUNICIPIO','CIUDAD','DELEGACION')
  const kDm       = fk('DIAS MORA','DM','DIAS_MORA','ATRASO','MORA')
  const kTotal    = fk('TOTAL VENCIDO','IMPORTE VENCIDO','MONTO VENCIDO','TOTAL','VENCIDO')
  const kSaldo    = fk('SALDO INSOLUTO','SALDO TOTAL','SALDO')
  const kCuotas   = fk('CUOTA','IMPORTE CUOTA','PAGO QUINCENAL','PAGO')
  const kNoCuotas = fk('CUOTAS VENCIDAS','NO CUOTAS','CUOTAS_VENCIDAS')
  const kTel      = fk('TELEFONO','CELULAR','TEL')
  const kEmail    = fk('EMAIL','CORREO','MAIL')
  const kSeg      = fk('SEGMENTO','BUCKET','RANGO')
  const kComp     = fk('COMPORTAMIENTO','CONDUCTA','HISTORIAL')
  const kEmpresa  = fk('EMPRESA','PATRON','EMPLEADOR')
  const kClabe    = fk('CLABE','CUENTA CLABE','CIE')

  function calcSeg(dm) {
    dm = dm || 0
    if (dm <= 0)  return '0'
    if (dm <= 30) return '1 a 30'
    if (dm <= 60) return '31 a 60'
    if (dm <= 89) return '61 a 89'
    return '90+'
  }

  const leads = []
  for (const r of rows) {
    const plan = String(r[kPlan] ?? '').trim()
    if (!plan) continue

    const dm  = safeNum(r[kDm])
    const seg = kSeg ? String(r[kSeg] ?? '').trim() || calcSeg(dm) : calcSeg(dm)

    // Teléfonos: puede haber una o dos columnas o valores con coma
    const telRaw = String(r[kTel] ?? '').trim()
    const tels   = telRaw.split(/[,;\/]/).map(safeTel).filter(Boolean)

    leads.push({
      plan,
      nombre:        String(r[kNombre] ?? '').trim().toUpperCase(),
      calle:         String(r[kCalle]  ?? '').trim(),
      colonia:       String(r[kColonia] ?? '').trim(),
      municipio:     String(r[kMunicipio] ?? '').trim() || 'Querétaro',
      dm,
      total:         safeNum(r[kTotal]),
      saldo:         safeNum(r[kSaldo]),
      cuotas:        safeNum(r[kCuotas]),
      noCuotas:      parseInt(r[kNoCuotas] ?? 1) || 1,
      tel:           tels,
      email:         String(r[kEmail] ?? '').trim().toLowerCase() || null,
      seg,
      comportamiento: String(r[kComp] ?? 'Regular').trim(),
      empresa:       String(r[kEmpresa] ?? '').trim(),
      clabe:         String(r[kClabe] ?? '').trim().replace(/\D/g,'').slice(0,18) || null,
      regularizada:  false,
    })
  }

  return { leads, sheetName, total: rows.length }
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin Fastify
// ─────────────────────────────────────────────────────────────────────────────

module.exports = async function (fastify) {

  // ── Plugin multipart (solo para esta ruta) ────────────────────────────────
  await fastify.register(require('@fastify/multipart'), {
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB máx
  })

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/leads
  // Devuelve leads desde Supabase con filtros opcionales
  // Query: ?segmento=1+a+30 &colonia=LOMA &estado=pendiente &limit=200
  // ──────────────────────────────────────────────────────────────────────────
  fastify.get('/', async (request, reply) => {
    const { segmento, colonia, estado, limit = 200 } = request.query

    let query = supabase
      .from('cuentas_cobranza')
      .select('*')
      .eq('regularizada', false)
      .order('score_cuenta', { ascending: false })
      .limit(parseInt(limit))

    if (segmento) query = query.eq('seg', segmento)
    if (colonia)  query = query.ilike('colonia', `%${colonia}%`)
    if (estado)   query = query.eq('estado_visita', estado)

    const { data, error } = await query
    if (error) return reply.status(500).send({ error: error.message })

    return {
      ok:    true,
      total: data?.length ?? 0,
      leads: data ?? [],
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/leads/upload
  // Recibe archivo Excel (multipart), parsea y upsert en Supabase
  // ──────────────────────────────────────────────────────────────────────────
  fastify.post('/upload', async (request, reply) => {
    const file = await request.file()
    if (!file) return reply.status(400).send({ error: 'No se recibió archivo' })

    const ext = (file.filename || '').split('.').pop().toLowerCase()
    if (!['xlsx','xls','xlsb','xlsm'].includes(ext)) {
      return reply.status(400).send({ error: `Formato no soportado: .${ext}` })
    }

    const chunks = []
    for await (const chunk of file.file) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)

    let parsed
    try {
      parsed = parseExcelBuffer(buffer)
    } catch (e) {
      return reply.status(422).send({ error: 'Error al leer Excel: ' + e.message })
    }

    // Upsert en Supabase (conflict → plan)
    const BATCH = 100
    let upsertadas = 0
    const errores  = []

    for (let i = 0; i < parsed.leads.length; i += BATCH) {
      const { error } = await supabase
        .from('cuentas_cobranza')
        .upsert(parsed.leads.slice(i, i + BATCH), { onConflict: 'plan' })

      if (error) {
        fastify.log.error(`[Upload] Batch ${i}: ${error.message}`)
        errores.push(error.message)
      } else {
        upsertadas += Math.min(BATCH, parsed.leads.length - i)
      }
    }

    return {
      ok:         true,
      archivo:    file.filename,
      hoja:       parsed.sheetName,
      total_filas: parsed.total,
      upsertadas,
      errores:    errores.length ? errores : null,
    }
  })
}
