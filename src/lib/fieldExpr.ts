// /src/lib/fieldExpr.ts
import type { ReportField } from "@/types/report";

/* ───────── Helpers dla formuł ───────── */

export function isFormulaName(name?: string): boolean {
  return !!name && name.trim().startsWith("=");
}

/** Oczekuje formatu: =|etykieta|wyrażenie */
export function parseFormulaName(name: string): { label: string; expr: string } | null {
  const m = name.trim().match(/^=\|(.+?)\|(.*)$/s);
  if (!m) return null;
  const [, label, expr] = m;
  return { label: (label || "").trim(), expr: (expr || "").trim() };
}

/** Czy string wygląda jak liczba (kropka jako separator) */
function isNumericLike(s: string): boolean {
  return /^[-+]?\d+(?:\.\d+)?$/.test(s.trim());
}

function stripQuotesLiteral(s: string): string | null {
  const t = (s ?? "").trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return null;
}

/** Bezpieczny parse liczby:
 *  - usuwa spacje tysięcy
 *  - zamienia przecinek na kropkę
 *  - NaN -> null
 */
function toNumberOrNull(s: string): number | null {
  if (s == null) return null;
  const normalized = String(s)
    .replace(/\s/g, "")   // "24 000,00" -> "24000,00"
    .replace(",", ".")    // "24000,00"  -> "24000.00"
    .trim();

  if (!normalized) return null;

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}


/* ───────── Pobieranie wartości „surowych” ───────── */

export function getRawValue(f: ReportField, pdValues: Record<string, any>): string {
  const meta: any = (f as any).meta_json || {};
  if ((f as any).source === "pipedrive" && (f as any).pipedrive_key) {
    const v = pdValues?.[(f as any).pipedrive_key];
    return v == null ? "" : String(v);
  }
  const v = meta?.value ?? "";
  return v == null ? "" : String(v);
}

/** getRawValue z możliwością nadpisania wartości po id pola (np. live editing w UI) */
function getRawValueWithOverrides(
  f: ReportField,
  pdValues: Record<string, any>,
  overrides?: Record<number, string | undefined>
): string {
  if (overrides) {
    const id = (f as any).id as number | undefined;
    if (id != null && overrides[id] != null) {
      const v = overrides[id];
      return v == null ? "" : String(v);
    }
  }
  return getRawValue(f, pdValues);
}


/* ───────── Tokenizacja z obsługą cudzysłowów ─────────
   Reguły:
   - literał w "..." lub '...' (z escapem \" i \')
   - operatory: + - * /
   - identyfikatory/liczby: pozostałe tokeny rozdzielone spacją lub operatorem
*/
type Token = { kind: "op" | "str" | "id" | "paren"; text: string };

function tokenize(expr: string): Token[] {
  // dodane nawiasy ( ) jako osobne tokeny
  const re = /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|[()+\-*/]|[^()+\-*/\s]+/g;
  const out: Token[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    const t = m[0];
    if (/^[+\-*/]$/.test(t)) {
      out.push({ kind: "op", text: t });
    } else if (t === "(" || t === ")") {
      out.push({ kind: "paren", text: t });
    } else if (
      (t.startsWith('"') && t.endsWith('"')) ||
      (t.startsWith("'") && t.endsWith("'"))
    ) {
      out.push({ kind: "str", text: unquote(t) });
    } else {
      out.push({ kind: "id", text: t });
    }
  }
  return out;
}

function unquote(q: string): string {
  if (q.length < 2) return q;
  const quote = q[0];
  const body = q.slice(1, -1);
  // Zamiana sekwencji ucieczek \" i \' oraz \\ na odpowiedniki
  return body.replace(/\\(["'\\])/g, "$1");
}

/* ───────── Rozwiązywanie zależności między polami ───────── */

function indexByName(fields: ReportField[]): Map<string, ReportField> {
  const map = new Map<string, ReportField>();
  for (const f of fields) {
    const rawName = String((f as any).name || "").trim();
    if (!rawName) continue;

    // 1) Zawsze indeksuj surową nazwę (np. "=|Liczba1|100")
    map.set(rawName, f);

    // 2) Jeśli to formuła, dodaj alias pod etykietą (np. "Liczba1")
    if (isFormulaName(rawName)) {
      const parsed = parseFormulaName(rawName);
      const label = parsed?.label?.trim();
      if (label) {
        map.set(label, f);
      }
    }
  }
  return map;
}


/**
 * Rozwiązuje wartość „zmiennej” odwołującej się do nazwy innego pola:
 * - jeśli pole zwykłe → zwraca getRawValue(...)
 * - jeśli pole formułowe → liczy rekurencyjnie (memoizacja), z detekcją cykli
 */
function makeVarResolver(
  allFields: ReportField[],
  pdValues: Record<string, any>,
  overrides?: Record<number, string | undefined>
) {
  const byName = indexByName(allFields);
  const memo = new Map<string, string>();
  const inStack = new Set<string>();

  // Bezpieczny odczyt z pdValues:
  // - najpierw próba dopasowania dokładnego klucza (case-sensitive),
  // - potem ścieżka kropkowa: a.b.c,
  // - na końcu próby "łagodne": case-insensitive oraz spacje ↔ podkreślenia.
  const readPd = (key: string): string => {
    if (!pdValues) return "";
    if (key in pdValues) return toPdString(pdValues[key]);

    // a.b.c → zejście wg ścieżki
    const byPath = getFromPath(pdValues, key);
    if (byPath !== undefined) return toPdString(byPath);

    // miękkie dopasowanie (np. "Deal Value" == "deal_value")
    const altKeys = buildAltKeys(key);
    for (const k of altKeys) {
      if (k in pdValues) return toPdString(pdValues[k]);
      const val = getFromPath(pdValues, k);
      if (val !== undefined) return toPdString(val);
    }
    return "";
  };

const resolve = (name: string): string => {
    if (!name) return "";
    if (memo.has(name)) return memo.get(name)!;

    const f = byName.get(name);
    if (f) {
      const rawName = String((f as any).name || "");
      if (!isFormulaName(rawName)) {
        const val = getRawValueWithOverrides(f, pdValues, overrides);
        memo.set(name, val ?? "");
        return memo.get(name)!;
      }
      const parsed = parseFormulaName(rawName);
      if (!parsed) {
        memo.set(name, getRawValueWithOverrides(f, pdValues, overrides) ?? "");
        return memo.get(name)!;
      }
      if (inStack.has(name)) return ""; // cykl
      inStack.add(name);
      const value = evalExpressionInternal(parsed.expr, resolve);
      inStack.delete(name);
      memo.set(name, value ?? "");
      return memo.get(name)!;
    }

    // fallback do Pipedrive jak było
    const pdVal = readPd(name);
    memo.set(name, pdVal);
    return pdVal;
  };

  return resolve;
}

// helpers do fallbacku:

function toPdString(v: any): string {
  if (v == null) return "";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return String(v);
}

function getFromPath(obj: any, path: string): any {
  if (!path || typeof obj !== "object") return undefined;
  // jeśli klucz zawiera spacje lub kropki w cudzysłowie, pozwól na "['a b.c']" – ale to wersja prosta: kropki = zejście w głąb
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (Object.prototype.hasOwnProperty.call(cur, p)) {
      cur = cur[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function buildAltKeys(key: string): string[] {
  const k1 = key.replace(/\s+/g, "_");
  const k2 = key.replace(/_/g, " ");
  const cands = new Set<string>([
    key,
    key.toLowerCase(),
    key.toUpperCase(),
    k1,
    k1.toLowerCase(),
    k2,
    k2.toLowerCase(),
  ]);
  return Array.from(cands);
}

/* ───────── Ewaluator: lewo-asocjacyjny + obsługa tekstów ───────── */

// ───────── IF + logika boolowska ─────────

function isTruthyLike(raw: string): boolean {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return false;

  // jawnie fałszywe
  if (s === "no" || s === "nie" || s === "false") return false;
  if (s === "0") return false;

  // jawnie prawdziwe
  if (s === "yes" || s === "tak" || s === "true") return true;
  if (s === "1") return true;

  // liczby: 0 = false, reszta = true
  const n = toNumberOrNull(raw);
  if (n !== null) return n !== 0;

  // dowolny niepusty string → true
  return true;
}

function normalizeNumericStringForCompare(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  return s === "" ? "0" : s;
}

function evalCondition(condExpr: string, resolveVar: (name: string) => string): boolean {
  // pomocniczo – usuwamy zewnętrzne nawiasy otaczające CAŁE wyrażenie
  const stripOuterParens = (s: string): string => {
    let str = s.trim();
    while (str.startsWith("(") && str.endsWith(")")) {
      let depth = 0;
      let ok = true;
      for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (ch === "(") depth++;
        else if (ch === ")") {
          depth--;
          if (depth === 0 && i < str.length - 1) {
            ok = false;
            break;
          }
        }
        if (depth < 0) {
          ok = false;
          break;
        }
      }
      if (ok && depth === 0) {
        str = str.slice(1, -1).trim();
      } else {
        break;
      }
    }
    return str;
  };

  const evalInner = (raw: string): boolean => {
    let inner = stripOuterParens(raw);
    if (!inner) return false;

    // id(pole) -> specjalna logika boolowska (zostawiamy jak było)
    const mId = inner.match(/^id\((.+)\)$/i);
    if (mId) {
      const name = mId[1].trim();
      const val = isNumericLike(name) ? name : resolveVar(name);
      return isTruthyLike(val);
    }

    // 1) TOP-LEVEL OR: expr1 || expr2  (|| ma najniższy priorytet)
    {
      let depth = 0;
      for (let i = 0; i < inner.length - 1; i++) {
        const ch = inner[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (ch === "|" && inner[i + 1] === "|" && depth === 0) {
          const left = inner.slice(0, i);
          const right = inner.slice(i + 2);
          return evalInner(left) || evalInner(right);
        }
      }
    }

    // 2) TOP-LEVEL AND: expr1 && expr2
    {
      let depth = 0;
      for (let i = 0; i < inner.length - 1; i++) {
        const ch = inner[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (ch === "&" && inner[i + 1] === "&" && depth === 0) {
          const left = inner.slice(0, i);
          const right = inner.slice(i + 2);
          return evalInner(left) && evalInner(right);
        }
      }
    }

    // 3) Proste porównania: ==, >, <
    const ops = ["==", ">", "<"] as const;
    for (const op of ops) {
      let depth = 0;
      let idx = -1;
      for (let i = 0; i <= inner.length - op.length; i++) {
        const ch = inner[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        if (depth === 0 && inner.slice(i, i + op.length) === op) {
          idx = i;
          break;
        }
      }

      if (idx > -1) {
        const leftName = inner.slice(0, idx).trim();
        const rightName = inner.slice(idx + op.length).trim();

        // literal w cudzysłowach?
        const leftLit = stripQuotesLiteral(leftName);
        const rightLit = stripQuotesLiteral(rightName);

        const leftVal =
          leftLit !== null
            ? leftLit
            : isNumericLike(leftName)
            ? leftName
            : resolveVar(leftName);

        const rightVal =
          rightLit !== null
            ? rightLit
            : isNumericLike(rightName)
            ? rightName
            : resolveVar(rightName);

        // puste pole w porównaniach liczbowych traktujemy jak "0"
        const lNum = toNumberOrNull(normalizeNumericStringForCompare(leftVal));
        const rNum = toNumberOrNull(normalizeNumericStringForCompare(rightVal));

        if (lNum !== null && rNum !== null) {
          // porównanie liczbowe
          if (op === "==") return lNum === rNum;
          if (op === ">") return lNum > rNum;
          if (op === "<") return lNum < rNum;
        } else {
          // porównanie tekstowe
          if (op === "==") return (leftVal ?? "") === (rightVal ?? "");
          if (op === ">") return (leftVal ?? "") > (rightVal ?? "");
          if (op === "<") return (leftVal ?? "") < (rightVal ?? "");
        }
      }
    }

    // 4) fallback: if(pole) – potraktuj wartość pola jako bool
    const val = isNumericLike(inner) ? inner : resolveVar(inner);
    return isTruthyLike(val);
  };

  return evalInner(condExpr);
}

function evalIfExpression(
  expr: string,
  resolveVar: (name: string) => string
): string | null {
  const s = expr.trim();
  if (!s.toLowerCase().startsWith("if(")) return null;

  const firstParen = s.indexOf("(");
  if (firstParen < 0) return null;

  // znajdź zamykający nawias warunku
  let depth = 0;
  let close = -1;
  for (let i = firstParen; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return null;

  const condStr = s.slice(firstParen + 1, close);
  const rest = s.slice(close + 1).trim(); // to co po ")"

  // szukamy ":" na poziomie zerowym (poza nawiasami) – then:else
  let colonIndex = -1;
  let depth2 = 0;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === "(") depth2++;
    else if (ch === ")") depth2--;
    else if (ch === ":" && depth2 === 0) {
      colonIndex = i;
      break;
    }
  }

  let thenExpr = "";
  let elseExpr = "";
  if (colonIndex === -1) {
    // if(cond)then   – bez else, else = ""
    thenExpr = rest;
    elseExpr = "";
  } else {
    thenExpr = rest.slice(0, colonIndex).trim();
    elseExpr = rest.slice(colonIndex + 1).trim();
  }

  const cond = evalCondition(condStr, resolveVar);
  const branch = cond ? thenExpr : elseExpr;
  if (!branch) return "";

  // pozwalamy w gałęziach na pełne wyrażenia (w tym zagnieżdżone if-y)
  return evalExpressionInternal(branch, resolveVar);
}

// właściwy ewaluator arytmetyki/tekstów (to, co już było – tylko pod nową nazwą)
// właściwy ewaluator arytmetyki/tekstów z priorytetami i nawiasami
function evalExpressionCore(expr: string, resolveVar: (name: string) => string): string {
  const tokens = tokenize(expr);
  if (tokens.length === 0) return "";

  let pos = 0;

  // pobranie wartości tokena (literal / pole)
  function valueOf(tok: Token): string {
    if (tok.kind === "str") return tok.text;
    if (tok.kind === "op" || tok.kind === "paren") return ""; // nie powinno tu trafić
    // id: może być liczba literalna…
    if (isNumericLike(tok.text)) return tok.text;
    // …albo nazwa innego pola
    return resolveVar(tok.text) ?? "";
  }

  function parsePrimary(): string {
    const tok = tokens[pos];
    if (!tok) return "";

    // ( expression )
    if (tok.kind === "paren" && tok.text === "(") {
      pos++;
      const val = parseAddSub();
      const next = tokens[pos];
      if (next && next.kind === "paren" && next.text === ")") {
        pos++;
      }
      return val;
    }

    pos++;
    return valueOf(tok);
  }

  function parseMulDiv(): string {
    let acc = parsePrimary();

    while (true) {
      const tok = tokens[pos];
      if (!tok || tok.kind !== "op" || (tok.text !== "*" && tok.text !== "/")) break;

      pos++;
      const rhs = parsePrimary();

      const aNum = toNumberOrNull(acc);
      const bNum = toNumberOrNull(rhs);
      const bothNumeric = aNum !== null && bNum !== null;

      switch (tok.text) {
        case "*":
          acc = bothNumeric ? String(aNum! * bNum!) : "";
          break;
        case "/":
          if (bothNumeric) {
            acc = bNum === 0 ? "" : String(aNum! / bNum!);
          } else {
            acc = "";
          }
          break;
      }
    }

    return acc;
  }

  function parseAddSub(): string {
    let acc = parseMulDiv();

    while (true) {
      const tok = tokens[pos];
      if (!tok || tok.kind !== "op" || (tok.text !== "+" && tok.text !== "-")) break;

      pos++;
      const rhs = parseMulDiv();

      const a = acc;
      const b = rhs;

      const aNum = toNumberOrNull(a);
      const bNum = toNumberOrNull(b);
      const bothNumeric = aNum !== null && bNum !== null;

      switch (tok.text) {
        case "+":
          if (bothNumeric) {
            acc = String(aNum! + bNum!);
          } else {
            const parts = [a, b].map((s) => s.trim()).filter(Boolean);
            acc = parts.join(" ");
          }
          break;
        case "-":
          acc = bothNumeric ? String(aNum! - bNum!) : "";
          break;
      }
    }

    return acc;
  }

  const result = parseAddSub();
  return result;
}

// wrapper z obsługą IF
function evalExpressionInternal(expr: string, resolveVar: (name: string) => string): string {
  const trimmed = (expr ?? "").trim();
  if (!trimmed) return "";

  // if(...)then:else – nowa składnia
  if (trimmed.toLowerCase().startsWith("if(")) {
    const res = evalIfExpression(trimmed, resolveVar);
    if (res !== null) return res;
  }

  // stary mechanizm, jeśli to nie IF albo parsowanie IF się nie udało
  return evalExpressionCore(trimmed, resolveVar);
}


/** Publiczny eval używany niżej — doklejamy scope przez resolver */
export function evalExpression(expr: string, scope: Map<string, string>): string {
  const resolveFromScope = (name: string) => scope.get(name) ?? "";
  return evalExpressionInternal(expr, resolveFromScope);
}

/* ───────── API publiczne do użycia w komponentach ───────── */

/** Mapa: nazwa_pola (tylko zwykłe) -> wartość (string) */
export function buildFieldValueMap(
  fields: ReportField[],
  pdValues: Record<string, any>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of fields) {
    const name = String((f as any).name || "").trim();
    if (!name) continue;
    if (isFormulaName(name)) continue; // tylko zwykłe
    map.set(name, getRawValue(f, pdValues));
  }
  return map;
}

/**
 * Liczy wartość konkretnego pola (uwzględniając zależności między polami).
 * - dla zwykłych pól zwraca: displayName = nazwa, value = getRawValue(...)
 * - dla formuł: displayName = etykieta z `=|etykieta|...`, value = wyliczenie
 */
export function computeField(
  f: ReportField,
  allFields: ReportField[],
  pdValues: Record<string, any>,
  overrides?: Record<number, string | undefined>
): { displayName: string; value: string } {
  const origName = String((f as any).name || "");

  // pole zwykłe – bierzemy raw z nadpisaniami
  if (!isFormulaName(origName)) {
    return {
      displayName: origName,
      value: String(getRawValueWithOverrides(f, pdValues, overrides) ?? ""),
    };
  }

  const parsed = parseFormulaName(origName);
  if (!parsed) {
    return {
      displayName: origName,
      value: String(getRawValueWithOverrides(f, pdValues, overrides) ?? ""),
    };
  }

  // formuła – resolver zna overrides, więc wszystkie zależności liczone z aktualnych wartości
  const resolveVar = makeVarResolver(allFields, pdValues, overrides);
  const value = evalExpressionInternal(parsed.expr, resolveVar);

  return {
    displayName: parsed.label || origName,
    value: value == null ? "" : String(value),
  };
}
