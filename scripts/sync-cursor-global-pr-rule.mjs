#!/usr/bin/env node
/**
 * Instala la regla pr-review-merge en ~/.cursor/rules para que aplique en todos los proyectos.
 * Fuente: .cursor/rules/pr-review-merge.mdc del repositorio.
 */
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const source = join(repoRoot, ".cursor", "rules", "pr-review-merge.mdc");
const targetDir = join(homedir(), ".cursor", "rules");
const target = join(targetDir, "pr-review-merge.mdc");

if (!existsSync(source)) {
  console.error(`No se encontró la regla fuente: ${source}`);
  process.exit(1);
}

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);
console.log(`Regla global instalada: ${target}`);
console.log("Reinicia o recarga Cursor si la regla no aparece de inmediato en Agent.");
