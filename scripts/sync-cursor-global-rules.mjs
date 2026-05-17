#!/usr/bin/env node
/**
 * Instala reglas y skills globales de Cursor desde este repositorio.
 * Destino reglas: ~/.cursor/rules/
 * Destino skills:  ~/.agents/skills/
 */
import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const GLOBAL_RULES = [
  "pr-review-merge.mdc",
  "ci-cd-documentation.mdc",
];

const GLOBAL_SKILLS = ["ci-cd-documentation-standard"];

const rulesSourceDir = join(repoRoot, ".cursor", "rules");
const rulesTargetDir = join(homedir(), ".cursor", "rules");
const skillsSourceDir = join(repoRoot, ".cursor", "skills");
const skillsTargetDir = join(homedir(), ".agents", "skills");

mkdirSync(rulesTargetDir, { recursive: true });
mkdirSync(skillsTargetDir, { recursive: true });

for (const file of GLOBAL_RULES) {
  const source = join(rulesSourceDir, file);
  const target = join(rulesTargetDir, file);
  if (!existsSync(source)) {
    console.error(`No se encontró la regla fuente: ${source}`);
    process.exit(1);
  }
  if (existsSync(target)) {
    console.warn(`Aviso: se sobreescribirá la regla global: ${target}`);
  }
  copyFileSync(source, target);
  console.log(`Regla global instalada: ${target}`);
}

for (const skillName of GLOBAL_SKILLS) {
  const source = join(skillsSourceDir, skillName);
  const target = join(skillsTargetDir, skillName);
  if (!existsSync(source)) {
    console.error(`No se encontró la skill fuente: ${source}`);
    process.exit(1);
  }
  if (existsSync(target)) {
    console.warn(`Aviso: se sobreescribirá la skill global: ${target}`);
  }
  cpSync(source, target, { recursive: true });
  console.log(`Skill global instalada: ${target}`);
}

console.log("\nListo. Reglas activas en todos los proyectos vía ~/.cursor/rules/.");
console.log("Reinicia o recarga Cursor si no ves los cambios de inmediato en Agent.");
