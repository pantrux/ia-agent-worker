# Checklist A1 — WAF y rate limiting (Cloudflare)

Este entregable se cumple **principalmente en el dashboard de la zona** (o vía Terraform/API). El Worker ya documenta rutas en [ROADMAP-CF-LANGSMITH.md §2.0](./ROADMAP-CF-LANGSMITH.md).

## 1. Inventario y prioridad

- [ ] Confirmar que el subdominio del Worker pasa por **proxy naranja** (DNS en Cloudflare).
- [ ] Revisar **reglas WAF** existentes (Managed Rules OWASP / Cloudflare recommendations) y activar baseline si no está.

## 2. Rate limiting por ruta

- [ ] Crear regla de **rate limit** para `POST /api/chat` (y misma política para `POST /api/chat/resume`) usando la ruta del Worker público.
- [ ] Definir umbral por IP de origen (`CF-Connecting-IP`) acorde al producto (p. ej. ventana + máximo de peticiones por minuto).
- [ ] Excluir o relajar **OPTIONS** para CORS si el WAF lo permite sin abrir abuso masivo.

## 3. Protección adicional

- [ ] Valorar **Bot Fight Mode** / Super Bot Fight según tráfico esperado.
- [ ] Limitar tamaño de body en capa CF si aplica (complemento a límites del Worker).

## 4. Verificación

- [ ] Probar desde IP limpia: chat OK bajo el límite.
- [ ] Forzar superación del límite (script o herramienta) y comprobar **429** o bloqueo WAF documentado.
- [ ] Registrar en el tablero [ROADMAP-IMPLEMENTATION.md](./ROADMAP-IMPLEMENTATION.md) la fila **A1** como **Ejecutado** con enlace a export Terraform o nota de reglas aplicadas.

## 5. Posteriores (fuera de A1 estricto)

- [ ] Endurecer `ALLOWED_ORIGINS` en producción (sin `*`) — alineado con el roadmap §2.0.
