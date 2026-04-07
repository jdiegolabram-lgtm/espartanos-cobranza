'use strict'

/**
 * MÓDULO DE NORMALIZACIÓN Y HOMOLOGACIÓN DE DIRECCIONES
 *
 * Responsabilidades:
 *  - Limpiar texto de direcciones (acentos, dobles espacios, caracteres raros)
 *  - Expandir abreviaturas a su forma canónica
 *  - Generar una dirección canónica para geocodificación y caché
 *  - Calcular similitud entre dos direcciones (Jaro-Winkler)
 *  - Detectar registros duplicados o equivalentes
 */

// ─────────────────────────────────────────────────────────────────────────────
// DICCIONARIOS
// ─────────────────────────────────────────────────────────────────────────────

const ABREVIATURAS = {
  // Tipos de vía
  'c.':    'calle',
  'cll.':  'calle',
  'cll ':  'calle ',
  'av.':   'avenida',
  'av ':   'avenida ',
  'avda.': 'avenida',
  'blvd.': 'boulevard',
  'blvd ': 'boulevard ',
  'blv.':  'boulevard',
  'calz.': 'calzada',
  'calz ': 'calzada ',
  'carr.': 'carretera',
  'carr ': 'carretera ',
  'priv.': 'privada',
  'priv ': 'privada ',
  'prol.': 'prolongacion',
  'prol ': 'prolongacion ',
  'and.':  'andador',
  'and ':  'andador ',
  'cto.':  'circuito',
  'cto ':  'circuito ',
  'ret.':  'retorno',
  'ret ':  'retorno ',
  'fracc.': 'fraccionamiento',
  'fracc ': 'fraccionamiento ',
  'frac.':  'fraccionamiento',
  'res.':   'residencial',
  'res ':   'residencial ',
  // Prefijos de colonia
  'col.':  'colonia',
  'col ':  'colonia ',
  // Ubicación dentro del predio
  'int.':  'interior',
  'int ':  'interior ',
  'ext.':  'exterior',
  'mz.':   'manzana',
  'mza.':  'manzana',
  'mz ':   'manzana ',
  'lt.':   'lote',
  'lt ':   'lote ',
  'esq.':  'esquina',
  'esq ':  'esquina ',
  // Sin número
  's/n':   'sin numero',
  's.n.':  'sin numero',
  // Puntos cardinales
  'nte.':  'norte',
  'nte ':  'norte ',
  'ote.':  'oriente',
  'ote ':  'oriente ',
  'pte.':  'poniente',
  'pte ':  'poniente ',
  // Unidad habitacional
  'u.h.':  'unidad habitacional',
  'u.h ':  'unidad habitacional ',
  'uh ':   'unidad habitacional ',
}

// Prefijos de colonia a eliminar en clave de comparación
const PREFIJOS_COLONIA = [
  'fraccionamiento', 'residencial', 'colonia', 'barrio',
  'unidad habitacional', 'privada', 'condominio', 'conjunto',
  'hacienda', 'rancho', 'ejido',
]

// ─────────────────────────────────────────────────────────────────────────────
// FUNCIONES BASE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Elimina acentos y diacríticos de un texto
 */
function eliminarAcentos(texto) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Limpieza base: lowercase, sin acentos, sin dobles espacios
 */
function limpiarTexto(texto) {
  if (!texto || typeof texto !== 'string') return ''
  return eliminarAcentos(texto)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s\-\/]/g, ' ')  // conservar alfanuméricos, guión y diagonal
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Expande abreviaturas usando el diccionario.
 * Ordena por longitud descendente para evitar sustituciones parciales.
 */
function expandirAbreviaturas(texto) {
  let resultado = ' ' + texto + ' '
  const entradas = Object.entries(ABREVIATURAS)
    .sort((a, b) => b[0].length - a[0].length)
  for (const [abrev, expansion] of entradas) {
    resultado = resultado.split(abrev).join(expansion)
  }
  return resultado.trim().replace(/\s+/g, ' ')
}

// ─────────────────────────────────────────────────────────────────────────────
// DIRECCIÓN CANÓNICA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Genera el texto canónico de una colonia para comparación.
 * Elimina prefijos como "colonia", "fraccionamiento", etc.
 */
function canonizarColonia(colonia) {
  let c = limpiarTexto(expandirAbreviaturas(colonia || ''))
  for (const prefijo of PREFIJOS_COLONIA) {
    if (c.startsWith(prefijo + ' ')) {
      c = c.slice(prefijo.length).trim()
      break
    }
  }
  return c
}

/**
 * Genera la dirección canónica completa de una cuenta.
 * Se usa como clave de caché para geocodificación.
 */
function generarDireccionCanonica(cuenta) {
  const partes = []

  const calle   = limpiarTexto(expandirAbreviaturas(cuenta.calle_raw || ''))
  const num_ext = limpiarTexto(cuenta.numero_exterior_raw || '')
  const num_int = limpiarTexto(cuenta.numero_interior_raw || '')
  const colonia = canonizarColonia(cuenta.colonia_raw || '')
  const mun     = limpiarTexto(cuenta.municipio_raw || '')
  const cp      = (cuenta.codigo_postal_raw || '').toString().replace(/\D/g, '')
  const estado  = limpiarTexto(cuenta.estado_raw || '')

  if (calle)                            partes.push(calle)
  if (num_ext && num_ext !== 'sin numero') partes.push(num_ext)
  if (num_int)                          partes.push(`interior ${num_int}`)
  if (colonia)                          partes.push(colonia)
  if (mun)                              partes.push(mun)
  if (cp)                               partes.push(cp)
  if (estado)                           partes.push(estado)
  partes.push('mexico')

  return partes.join(', ')
}

/**
 * Normaliza todos los campos de dirección de una cuenta.
 * Retorna la cuenta con campos _normalizada añadidos.
 */
function normalizarCuenta(cuenta) {
  const cp = (cuenta.codigo_postal_raw || '').toString().replace(/\D/g, '').padStart(5, '0').slice(0, 5)
  return {
    ...cuenta,
    calle_normalizada:      limpiarTexto(expandirAbreviaturas(cuenta.calle_raw || '')),
    colonia_normalizada:    canonizarColonia(cuenta.colonia_raw || ''),
    municipio_normalizado:  limpiarTexto(cuenta.municipio_raw || ''),
    codigo_postal_validado: cp,
    direccion_canonica:     generarDireccionCanonica(cuenta),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SIMILITUD DE DIRECCIONES — JARO-WINKLER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula la distancia Jaro-Winkler entre dos strings.
 * Retorna un valor entre 0 (sin similitud) y 1 (idénticos).
 */
function jaroWinkler(s1, s2) {
  if (s1 === s2) return 1
  if (!s1 || !s2) return 0

  const len1 = s1.length
  const len2 = s2.length
  const matchDist = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0)

  const s1Match = new Array(len1).fill(false)
  const s2Match = new Array(len2).fill(false)
  let matches = 0
  let transpositions = 0

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDist)
    const end   = Math.min(i + matchDist + 1, len2)
    for (let j = start; j < end; j++) {
      if (s2Match[j] || s1[i] !== s2[j]) continue
      s1Match[i] = true
      s2Match[j] = true
      matches++
      break
    }
  }

  if (matches === 0) return 0

  let k = 0
  for (let i = 0; i < len1; i++) {
    if (!s1Match[i]) continue
    while (!s2Match[k]) k++
    if (s1[i] !== s2[k]) transpositions++
    k++
  }

  const jaro = (
    matches / len1 +
    matches / len2 +
    (matches - transpositions / 2) / matches
  ) / 3

  // Bonus Winkler: prefijo común de hasta 4 caracteres
  let prefijo = 0
  for (let i = 0; i < Math.min(4, len1, len2); i++) {
    if (s1[i] === s2[i]) prefijo++
    else break
  }

  return jaro + prefijo * 0.1 * (1 - jaro)
}

/**
 * Calcula similitud entre dos strings de dirección.
 * Combina Jaro-Winkler con comparación de tokens (token set ratio).
 */
function calcularSimilitudDireccion(dir1, dir2) {
  const a = limpiarTexto(dir1)
  const b = limpiarTexto(dir2)

  if (a === b) return 1
  if (!a || !b) return 0

  // Jaro-Winkler sobre el texto completo
  const jw = jaroWinkler(a, b)

  // Token set ratio: intersección de tokens de longitud > 2
  const tokA = new Set(a.split(' ').filter(t => t.length > 2))
  const tokB = new Set(b.split(' ').filter(t => t.length > 2))
  const interseccion = [...tokA].filter(t => tokB.has(t)).length
  const union = new Set([...tokA, ...tokB]).size
  const tokenRatio = union > 0 ? interseccion / union : 0

  // Score final ponderado
  return (jw * 0.6) + (tokenRatio * 0.4)
}

// ─────────────────────────────────────────────────────────────────────────────
// DETECCIÓN DE DUPLICADOS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detecta registros duplicados o equivalentes dentro de un array de cuentas.
 *
 * Retorna un mapa: { cuenta_id_duplicado → cuenta_id_maestro }
 * El maestro es el primer registro encontrado del grupo.
 *
 * @param {Array} cuentas - Array de cuentas normalizadas
 * @param {number} umbral - Similitud mínima para considerar duplicado (0-1)
 */
function detectarDuplicados(cuentas, umbral = 0.88) {
  const procesadas = new Set()
  const duplicadosMap = new Map()  // idx_duplicado → idx_maestro

  for (let i = 0; i < cuentas.length; i++) {
    if (procesadas.has(i)) continue
    const canonicaI = cuentas[i].direccion_canonica || generarDireccionCanonica(cuentas[i])

    for (let j = i + 1; j < cuentas.length; j++) {
      if (procesadas.has(j)) continue
      const canonicaJ = cuentas[j].direccion_canonica || generarDireccionCanonica(cuentas[j])

      const similitud = calcularSimilitudDireccion(canonicaI, canonicaJ)
      if (similitud >= umbral) {
        duplicadosMap.set(j, i)
        procesadas.add(j)
      }
    }
  }

  return duplicadosMap
}

module.exports = {
  limpiarTexto,
  eliminarAcentos,
  expandirAbreviaturas,
  canonizarColonia,
  generarDireccionCanonica,
  normalizarCuenta,
  jaroWinkler,
  calcularSimilitudDireccion,
  detectarDuplicados,
}
