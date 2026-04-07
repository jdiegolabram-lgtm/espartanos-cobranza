'use strict'

const { createClient } = require('@supabase/supabase-js')

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  throw new Error('Faltan variables de entorno: SUPABASE_URL y SUPABASE_SERVICE_KEY son requeridas')
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // Service key para el backend (nunca exponer al cliente)
)

module.exports = supabase
