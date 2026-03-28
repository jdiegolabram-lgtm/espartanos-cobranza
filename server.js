const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

app.get('/', (req, res) => {
  res.send('Sistema de cobranza funcionando 🚀');
});

app.get('/clientes', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .order('fecha_registro', { ascending: false });

    if (error) {
      return res.status(500).json({
        error: error.message,
        details: error,
        supabaseUrlLoaded: !!process.env.SUPABASE_URL,
        supabaseKeyLoaded: !!process.env.SUPABASE_KEY,
        supabaseUrlValue: process.env.SUPABASE_URL || null
      });
    }

    return res.json(data);
  } catch (e) {
    return res.status(500).json({
      error: e.message,
      name: e.name,
      stack: e.stack,
      supabaseUrlLoaded: !!process.env.SUPABASE_URL,
      supabaseKeyLoaded: !!process.env.SUPABASE_KEY,
      supabaseUrlValue: process.env.SUPABASE_URL || null
    });
  }
});

app.post('/clientes', async (req, res) => {
  const { nombre, telefono, direccion, deuda } = req.body;

  const { data, error } = await supabase
    .from('clientes')
    .insert([{ nombre, telefono, direccion, deuda }])
    .select();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
