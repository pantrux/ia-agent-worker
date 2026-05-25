import { describe, expect, it } from "vitest";
import { buildAllowList, corsHeaders, resolveAllowOrigin } from "./cors.js";

const PROD_ORIGINS = "https://www.e-scale.cl,https://e-scale.cl,http://localhost:3000";

describe("buildAllowList", () => {
  it("devuelve lista vacía si la cadena está vacía o ausente", () => {
    expect(buildAllowList(undefined)).toEqual([]);
    expect(buildAllowList("")).toEqual([]);
    expect(buildAllowList("   ")).toEqual([]);
  });

  it("recorta espacios y descarta entradas vacías", () => {
    expect(buildAllowList("a, b ,, c")).toEqual(["a", "b", "c"]);
  });

  it("ignora el comodín '*' aunque esté presente (PAN-25)", () => {
    expect(buildAllowList("*,http://localhost:3000")).toEqual(["http://localhost:3000"]);
    expect(buildAllowList("*")).toEqual([]);
    expect(buildAllowList("https://www.e-scale.cl,*,https://e-scale.cl")).toEqual([
      "https://www.e-scale.cl",
      "https://e-scale.cl",
    ]);
  });
});

describe("resolveAllowOrigin", () => {
  it("devuelve el origen si está en la allowlist", () => {
    expect(resolveAllowOrigin("https://www.e-scale.cl", buildAllowList(PROD_ORIGINS))).toBe(
      "https://www.e-scale.cl"
    );
  });

  it("devuelve cadena vacía si el origen no está en la allowlist", () => {
    expect(resolveAllowOrigin("https://evil.example", buildAllowList(PROD_ORIGINS))).toBe("");
  });

  it("nunca acepta '*' aunque venga como Origin literal", () => {
    expect(resolveAllowOrigin("*", buildAllowList(PROD_ORIGINS))).toBe("");
  });

  it("acepta el único origen autorizado cuando la petición no lleva Origin", () => {
    expect(resolveAllowOrigin("", ["https://www.e-scale.cl"])).toBe("https://www.e-scale.cl");
  });

  it("sin Origin y con varios orígenes en la allowlist devuelve cadena vacía", () => {
    expect(resolveAllowOrigin("", buildAllowList(PROD_ORIGINS))).toBe("");
  });

  it("allowlist vacía siempre devuelve cadena vacía", () => {
    expect(resolveAllowOrigin("https://www.e-scale.cl", [])).toBe("");
    expect(resolveAllowOrigin("", [])).toBe("");
  });
});

describe("corsHeaders", () => {
  function reqWithOrigin(origin?: string): Request {
    const headers: Record<string, string> = {};
    if (origin !== undefined) headers.Origin = origin;
    return new Request("http://worker.test/anything", { headers });
  }

  it("emite Access-Control-Allow-Origin solo si el Origin está autorizado", () => {
    const headers = corsHeaders(reqWithOrigin("https://www.e-scale.cl"), {
      ALLOWED_ORIGINS: PROD_ORIGINS,
    });
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://www.e-scale.cl");
    expect(headers["Vary"]).toBe("Origin");
    expect(headers["Access-Control-Allow-Methods"]).toBe("GET,POST,OPTIONS");
  });

  it("rechaza orígenes no autorizados omitiendo la cabecera CORS", () => {
    const headers = corsHeaders(reqWithOrigin("https://evil.example"), {
      ALLOWED_ORIGINS: PROD_ORIGINS,
    });
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(headers["Vary"]).toBeUndefined();
  });

  it("mantiene cerrado el CORS si ALLOWED_ORIGINS sigue conteniendo '*' por error", () => {
    const headers = corsHeaders(reqWithOrigin("https://evil.example"), {
      ALLOWED_ORIGINS: "*,https://www.e-scale.cl",
    });
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("'*' como entrada se ignora aunque el Origin coincida exactamente con '*'", () => {
    const headers = corsHeaders(reqWithOrigin("*"), {
      ALLOWED_ORIGINS: "*",
    });
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("sin Origin y un único origen autorizado, lo refleja (compat caller server-to-server)", () => {
    const headers = corsHeaders(reqWithOrigin(undefined), {
      ALLOWED_ORIGINS: "https://www.e-scale.cl",
    });
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://www.e-scale.cl");
  });

  it("sin Origin y allowlist vacía no añade cabecera CORS", () => {
    const headers = corsHeaders(reqWithOrigin(undefined), { ALLOWED_ORIGINS: "" });
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});
