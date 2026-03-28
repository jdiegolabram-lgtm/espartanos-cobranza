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
