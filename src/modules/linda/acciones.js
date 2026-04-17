'use strict'

const supabase = require('../../config/supabase')

async function registrarGestion({ cuenta_id, canal, mensaje_in, respuesta, intent, resultado }) {
  const { data, error } = await supabase
    .from('gestiones')
    .insert({
      cuenta_id,
      canal:       canal || 'whatsapp',
      tipo:        canal === 'presencial' ? 'P' : 'T',
      mensaje_in,
      mensaje_out: respuesta,
      intent,
      resultado:   resultado || 'contacto_exitoso',
      agente:      'LINDA',
    })
    .select('id')
    .single()

  if (error) throw new Error(`registrarGestion: ${error.message}`)
  return data.id
}

async function registrarPromesa({ cuenta_id, monto, fecha, canal }) {
  if (!monto || !fecha) return null

  const { data, error } = await supabase
    .from('promesas_pago')
    .insert({
      cuenta_id,
      monto_prometido: monto,
      fecha_promesa:   fecha,
      canal:           canal || 'whatsapp',
    })
    .select('id')
    .single()

  if (error) throw new Error(`registrarPromesa: ${error.message}`)
  return data.id
}

async function programarSeguimiento({ cuenta_id, fecha, motivo, canal }) {
  if (!fecha) return null

  const { data, error } = await supabase
    .from('seguimientos')
    .insert({
      cuenta_id,
      fecha_prog: fecha,
      motivo:     motivo || 'seguimiento_agente',
      canal:      canal  || 'whatsapp',
    })
    .select('id')
    .single()

  if (error) throw new Error(`programarSeguimiento: ${error.message}`)
  return data.id
}

async function escalarCaso(cuenta_id) {
  const { error } = await supabase
    .from('cuentas_cobranza')
    .update({ estado_visita: 'escalada' })
    .eq('id', cuenta_id)

  if (error) throw new Error(`escalarCaso: ${error.message}`)
}

module.exports = { registrarGestion, registrarPromesa, programarSeguimiento, escalarCaso }
