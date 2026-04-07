'use strict'

/**
 * MÓDULO DE GEOCODIFICACIÓN EN CASCADA
 *
 * Estrategia:
 *  1. Buscar en caché de Supabase → gratis, instantáneo
 *  2. Dirección completa → Google Maps API (precisión máxima)
 *  3. Sin número exterior → Google Maps (precisión calle)
 *  4. Colonia + municipio + CP → Google Maps (precisión colonia)
 *  5. CP + municipio → Google Maps (precisión CP)
 *  6. Solo municipio → Google Maps (precisión municipio)
 *
 *  NUNCA excluye una cuenta. Siempre retorna coordenadas con nivel de confianza.
 *
 * Niveles de precisión:
 *  1 = domicilio exacto (rooftop)
 *  2 = calle (range_interpolated)
 *  3 = colonia
 *  4 = código postal
 *  5 = municipio
 */

const { Client } = require('@googlemaps/google-maps-services-js')
const supabase   = require('../../config/supabase')

const gmaps = new Client({})

// Mapeo tipo de resultado Google → nivel de precisión
const LOCATION_TYPE_A_NIVEL = {
  ROOFTOP:              1,
  RANGE_INTERPOLATED:   2,
  GEOMETRIC_CENTER:     2,
  APPROXIMATE:          3,
}

// Score de confianza base según tipo de resultado de Google
const LOCATION_TYPE_SCORE = {
  ROOFTOP:              1.00,
  RANGE_INTERPOLATED:   0.85,
  GEOMETRIC_CENTER:     0.70,
  APPROXIMATE:          0.50,
}

// Coordenadas de municipios de Querétaro como último fallback
const CENTROIDES_MUNICIPIO = {
  'queretaro':       { lat: 20.5888, lng: -100.3899 },
  'corregidora':     { lat: 20.5072, lng: -100.4396 },
  'el marques':      { lat: 20.6036, lng: -100.1997 },
  'san juan del rio': { lat: 20.3878, lng: -99.9958 },
  'tequisquiapan':   { lat: 20.5191, lng: -99.8921 },
}

// ─────────────────────────────────────────────────────────────────────────────
// CACHÉ
// ─────────────────────────────────────────────────────────────────────────────

async function buscarEnCache(direccionCanonica) {
  try {
    const { data, error } = await supabase
      .from('geocoding_cache')
      .select('lat, lng, precision_nivel, geocoding_score, fuente, hits, id')
      .eq('direccion_canonica', direccionCanonica)
      .single()

    if (error || !data) return null

    // Actualizar contador de hits de forma no bloqueante
    supabase
      .from('geocoding_cache')
      .update({ hits: data.hits + 1, last_used_at: new Date().toISOString() })
      .eq('id', data.id)
      .then(() => {})

    return {
      lat:              data.lat,
      lng:              data.lng,
      precision_nivel:  data.precision_nivel,
      geocoding_score:  data.geocoding_score,
      fuente_geocoding: 'cache',
      desde_cache:      true,
    }
  } catch {
    return null
  }
}

async function guardarEnCache(clave, resultado, respuestaRaw = null) {
  try {
    await supabase
      .from('geocoding_cache')
      .upsert({
        direccion_canonica: clave,
        lat:                resultado.lat,
        lng:                resultado.lng,
        precision_nivel:    resultado.precision_nivel,
        geocoding_score:    resultado.geocoding_score,
        fuente:             resultado.fuente_geocoding,
        respuesta_raw:      respuestaRaw,
      }, { onConflict: 'direccion_canonica' })
  } catch (e) {
    // No romper el flujo si el caché falla
    console.error('[Geocoding] Error guardando en caché:', e.message)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LLAMADA A GOOGLE MAPS
// ─────────────────────────────────────────────────────────────────────────────

async function llamarGoogleMaps(address) {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    throw new Error('GOOGLE_MAPS_API_KEY no configurada')
  }

  const response = await gmaps.geocode({
    params: {
      address,
      language: 'es',
      region:   'MX',
      key:      process.env.GOOGLE_MAPS_API_KEY,
    },
    timeout: 5000,
  })

  if (response.data.status !== 'OK' || !response.data.results.length) {
    return null
  }

  const resultado    = response.data.results[0]
  const ubicacion    = resultado.geometry.location
  const tipoGeom     = resultado.geometry.location_type

  return {
    lat:              ubicacion.lat,
    lng:              ubicacion.lng,
    precision_nivel:  LOCATION_TYPE_A_NIVEL[tipoGeom] || 3,
    geocoding_score:  LOCATION_TYPE_SCORE[tipoGeom]   || 0.40,
    fuente_geocoding: 'google',
    _raw:             resultado,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GEOCODIFICACIÓN EN CASCADA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Geocodifica una cuenta usando la estrategia en cascada.
 * Nunca falla — siempre retorna coordenadas con nivel de confianza.
 *
 * @param {Object} cuenta - Cuenta normalizada con campos _normalizada
 * @returns {Object} { lat, lng, precision_nivel, geocoding_score, fuente_geocoding, geocoding_intentos }
 */
async function geocodificarCuenta(cuenta) {
  const {
    calle_normalizada,
    numero_exterior_raw,
    colonia_normalizada,
    municipio_normalizado,
    codigo_postal_validado,
    estado_raw,
    direccion_canonica,
  } = cuenta

  // Paso 0: Buscar en caché
  const cached = await buscarEnCache(direccion_canonica)
  if (cached) {
    return { ...cached, geocoding_intentos: 0 }
  }

  let resultado = null
  let intentos  = 0

  // Paso 1: Dirección completa (calle + número + colonia + municipio + CP)
  if (calle_normalizada && numero_exterior_raw) {
    intentos++
    const q = `${calle_normalizada} ${numero_exterior_raw}, ${colonia_normalizada}, ${municipio_normalizado}, ${codigo_postal_validado}, ${estado_raw}, Mexico`
    try {
      resultado = await llamarGoogleMaps(q)
      if (resultado && resultado.precision_nivel <= 2) {
        await guardarEnCache(direccion_canonica, resultado, resultado._raw)
        return { ...resultado, geocoding_intentos: intentos, _raw: undefined }
      }
    } catch (e) {
      console.error('[Geocoding] Intento 1 falló:', e.message)
    }
  }

  // Paso 2: Calle + colonia + municipio (sin número)
  if (calle_normalizada && colonia_normalizada) {
    intentos++
    const q = `${calle_normalizada}, ${colonia_normalizada}, ${municipio_normalizado}, ${codigo_postal_validado}, Mexico`
    try {
      resultado = await llamarGoogleMaps(q)
      if (resultado) {
        resultado.precision_nivel = Math.max(resultado.precision_nivel, 2)
        resultado.geocoding_score = +(resultado.geocoding_score * 0.85).toFixed(2)
        await guardarEnCache(direccion_canonica, resultado, resultado._raw)
        return { ...resultado, geocoding_intentos: intentos, _raw: undefined }
      }
    } catch (e) {
      console.error('[Geocoding] Intento 2 falló:', e.message)
    }
  }

  // Paso 3: Colonia + municipio + CP
  if (colonia_normalizada && municipio_normalizado) {
    intentos++
    const q = `${colonia_normalizada}, ${municipio_normalizado}, ${codigo_postal_validado}, ${estado_raw}, Mexico`
    const cacheKey = `colonia:${colonia_normalizada}:${municipio_normalizado}:${codigo_postal_validado}`
    const cachedColonia = await buscarEnCache(cacheKey)
    if (cachedColonia) {
      return { ...cachedColonia, geocoding_intentos: intentos }
    }
    try {
      resultado = await llamarGoogleMaps(q)
      if (resultado) {
        resultado.precision_nivel = 3
        resultado.geocoding_score = 0.45
        await guardarEnCache(cacheKey, resultado, resultado._raw)
        return { ...resultado, geocoding_intentos: intentos, _raw: undefined }
      }
    } catch (e) {
      console.error('[Geocoding] Intento 3 falló:', e.message)
    }
  }

  // Paso 4: CP + municipio
  if (codigo_postal_validado && municipio_normalizado) {
    intentos++
    const q = `${codigo_postal_validado}, ${municipio_normalizado}, ${estado_raw}, Mexico`
    try {
      resultado = await llamarGoogleMaps(q)
      if (resultado) {
        resultado.precision_nivel = 4
        resultado.geocoding_score = 0.30
        return { ...resultado, geocoding_intentos: intentos, _raw: undefined }
      }
    } catch (e) {
      console.error('[Geocoding] Intento 4 falló:', e.message)
    }
  }

  // Paso 5: Solo municipio
  if (municipio_normalizado) {
    intentos++
    const q = `${municipio_normalizado}, ${estado_raw}, Mexico`
    try {
      resultado = await llamarGoogleMaps(q)
      if (resultado) {
        resultado.precision_nivel = 5
        resultado.geocoding_score = 0.15
        return { ...resultado, geocoding_intentos: intentos, _raw: undefined }
      }
    } catch (e) {
      console.error('[Geocoding] Intento 5 falló:', e.message)
    }
  }

  // Paso 6: Centroide local hardcodeado (nunca falla)
  intentos++
  const mun = (municipio_normalizado || '').toLowerCase()
  const centroide = CENTROIDES_MUNICIPIO[mun] || CENTROIDES_MUNICIPIO['queretaro']
  return {
    lat:              centroide.lat,
    lng:              centroide.lng,
    precision_nivel:  5,
    geocoding_score:  0.05,
    fuente_geocoding: 'centroide_local',
    geocoding_intentos: intentos,
  }
}

/**
 * Geocodifica un array de cuentas respetando rate limits de Google.
 * 50ms entre llamadas = 20 req/s (muy por debajo del límite de 50 req/s).
 *
 * @param {Array}  cuentas   - Cuentas normalizadas
 * @param {number} delayMs   - Delay entre llamadas en ms
 * @param {Function} onProgress - Callback opcional de progreso
 */
async function geocodificarLote(cuentas, delayMs = 50, onProgress = null) {
  const resultados = []

  for (let i = 0; i < cuentas.length; i++) {
    try {
      const geo = await geocodificarCuenta(cuentas[i])
      resultados.push({ index: i, ...geo, error: null })
    } catch (error) {
      // Nunca romper el lote — registrar error y continuar
      console.error(`[Geocoding] Error en cuenta ${i}:`, error.message)
      resultados.push({
        index:            i,
        lat:              null,
        lng:              null,
        precision_nivel:  5,
        geocoding_score:  0,
        fuente_geocoding: 'error',
        geocoding_intentos: 0,
        error:            error.message,
      })
    }

    // Rate limiting
    if (delayMs > 0 && i < cuentas.length - 1 && !resultados[i].desde_cache) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }

    // Progreso cada 10 cuentas
    if (onProgress && (i + 1) % 10 === 0) {
      onProgress(i + 1, cuentas.length)
    }
  }

  return resultados
}

/**
 * Calcula distancia en km entre dos puntos (fórmula Haversine)
 */
function haversine(lat1, lng1, lat2, lng2) {
  const R  = 6371
  const dL = ((lat2 - lat1) * Math.PI) / 180
  const dl  = ((lng2 - lng1) * Math.PI) / 180
  const a  =
    Math.sin(dL / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dl / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

module.exports = {
  geocodificarCuenta,
  geocodificarLote,
  buscarEnCache,
  haversine,
}
