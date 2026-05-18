# PAN-42 — Espejo en repo (Linear, cierre)

Espejo de [PAN-42](https://linear.app/pantrux/issue/PAN-42): regla operativa global **variables y secretos** (`.env`, Cloudflare, GitHub Actions).

**Estado:** **Done** (2026-05-18).

---

## Ámbito

- **ia-agent-worker:** regla `.cursor/rules/secrets-and-env-vars.mdc`, entrada en `scripts/sync-cursor-global-rules.mjs`, `.env.example` ampliado.
- **aaas-landing:** misma regla + `.env.example` y `workers/aaas-auth-worker/.env.example`.
- **Global:** `npm run sync:cursor-global-rules` → `~/.cursor/rules/secrets-and-env-vars.mdc`.

---

## Contexto

Convención para que el agente genere secretos, los guarde en `.env` local (gitignored) y documente cada clave con **Para qué / Dónde / Riesgo al rotar**. Evita desalineación de secretos compartidos que rompe smoke WS (`Ticket inválido`).

---

## Fuente documental

| Documento | Rol |
|-----------|-----|
| [PAN-42 (Linear)](https://linear.app/pantrux/issue/PAN-42) | Issue de tracking |
| [secrets-and-env-vars.mdc](../.cursor/rules/secrets-and-env-vars.mdc) | Regla Cursor |
| [PAN-18 runbook (landing)](https://github.com/pantrux/aaas-landing/blob/main/docs/PAN-18-c2-channel-webhooks-design.md) | Resincronización secretos Pages |
| [put-pages-secret.mjs](../scripts/put-pages-secret.mjs) | Subida stdin sin newline (PowerShell) |

### PRs fusionados

| PR | Repo | Merge `main` |
|----|------|--------------|
| [#61](https://github.com/pantrux/ia-agent-worker/pull/61) | ia-agent-worker | `4b8285d` |
| [#50](https://github.com/pantrux/aaas-landing/pull/50) | aaas-landing | `c15769e` |

---

## Criterio de cierre

- [x] Regla global versionada y en `GLOBAL_RULES`
- [x] Plantillas `.env.example` documentadas
- [x] PRs en `main`
- [x] Prod: `WS_TICKET_SECRET` alineado; redeploy Pages; smoke C3 OK

---

## Hallazgos o Mejoras

- Tras `pages secret put`, hace falta **redeploy producción** para que el runtime cargue el secreto (PAN-18).
- Worker prod: `wrangler versions secret put` + `wrangler versions deploy` si `secret put` rechaza por versión activa.
- Primer smoke tras push a `main` puede fallar por carrera con el deploy de Pages; re-ejecutar workflow cuando el deployment esté activo.

---

## Bloqueantes

Ninguno.
