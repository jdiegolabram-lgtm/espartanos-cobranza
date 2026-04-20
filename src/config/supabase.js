'use strict'

const { createClient } = require('@supabase/supabase-js')

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.warn('[Supabase] ADVERTENCIA: SUPABASE_URL o SUPABASE_SERVICE_KEY no configuradas — las rutas de base de datos fallarán')
}

const supabase = createClient(
  process.env.SUPABASE_URL         || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || 'placeholder-key'
)

module.exports = supabase
