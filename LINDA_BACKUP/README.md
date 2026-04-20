# LINDA_BACKUP — Respaldo Estructurado del Proyecto Espartanos

## Qué contiene

```
/LINDA_BACKUP
  /CONSOLIDADO     → candidatos principales (1 por familia, el más reciente/completo)
  /HISTORICO       → versiones anteriores (referencia, no borrar)
  /N8N             → workflows n8n exportables
  /SQL             → schema Supabase
  /PROMPTS         → prompts IA por modelo
  inventario.json  → inventario máquina-legible
  inventario.md    → inventario humano-legible
  resumen_versiones.md → árbol de versiones por familia
```

## Archivos originales

Los archivos HTML originales están en `C:\\Users\\8\\Downloads\\`.
El ZIP con los 8 candidatos principales fue generado en:
`C:\\Users\\8\\Downloads\\LINDA_RESPALDO_HTML.zip` (606 KB)

## Cómo seguir iterando

1. Cuando generes una nueva versión de un HTML, súbela a Downloads
2. El nombre debe seguir el patrón: `Espartanos_[Familia]_v[N]_[FECHA].html`
3. Actualiza `inventario.md` manualmente o pídele a Claude que re-escanee
4. El CONSOLIDADO siempre tiene la única versión activa por familia

## Cómo cargar archivos manualmente

Si Claude Code no tiene acceso a ciertos archivos:
1. Arrástralos a la carpeta `Downloads`
2. Dile a Claude: *"Escanea Downloads y actualiza el inventario"*
3. O súbelos directo a este repo en la carpeta `/LINDA_BACKUP/ORIGINALES/`
