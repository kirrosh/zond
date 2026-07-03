import type { EndpointInfo } from "../../generator/types.ts";
import { classify as classifyRecommendedAction } from "../../classifier/recommended-action.ts";
import type {
  SecurityClass,
  SecurityFieldHit,
  SecurityFinding,
} from "./types.ts";

/** ARV-56: route through the single classifier. */
function stampAction(f: SecurityFinding): SecurityFinding {
  const action = classifyRecommendedAction({
    finding_class: "probe:security",
    severity: f.severity as Parameters<typeof classifyRecommendedAction>[0]["severity"],
  });
  if (action) f.recommended_action = action;
  return f;
}

export interface ClassifyResp {
  status: number;
  body?: unknown;
  body_parsed?: unknown;
  headers?: Record<string, string>;
}

export function classify(
  hit: SecurityFieldHit,
  payload: string,
  resp: ClassifyResp,
  ctx: { endpoint?: EndpointInfo } = {},
): SecurityFinding {
  return stampAction(classifyInner(hit, payload, resp, ctx));
}

/**
 * ARV-254: detect whether an endpoint declares delivery semantics for
 * a URL field — i.e. the server is documented to actually hit the URL
 * (webhook receiver, push subscription, callback).
 *
 * Without OOB infrastructure (interactsh / Burp Collaborator —
 * deferred to ARV-177 post-pivot), zond can't prove the server fetched
 * the URL. So SSRF "accept" lands as LOW by default. But if the spec
 * declares delivery, we know the URL gets fetched on some schedule,
 * which raises the stakes — surface as MEDIUM with an explicit
 * disclaimer that OOB verification is still required for HIGH.
 *
 * Heuristic: path or tag contains "webhook" / "callback" / "subscription"
 * (case-insensitive). When ARV-189 lands, this also reads
 * `x-zond-delivery: true` from the spec.
 */
function endpointDeclaresDelivery(ep: EndpointInfo | undefined): boolean {
  if (!ep) return false;
  const haystacks: string[] = [ep.path.toLowerCase()];
  if (Array.isArray(ep.tags)) {
    for (const t of ep.tags) haystacks.push(String(t).toLowerCase());
  }
  return haystacks.some((h) => /webhook|callback|subscription/.test(h));
}

/**
 * Check whether the CRLF payload reflects into any response header
 * value. ARV-253: header reflection is the smoking gun for CRLF —
 * response splitting / header injection becomes exploitable as soon as
 * the server emits attacker-controlled bytes in headers.
 *
 * We check raw payload AND its URL-decoded form so encodings like
 * `%0d%0a` survive the comparison.
 */
function reflectsInHeaders(payload: string, headers: Record<string, string> | undefined): string | null {
  if (!headers || !payload) return null;
  const decoded = safeDecodeURI(payload);
  const variants = [payload, decoded].filter((v) => v && v.length >= 3);
  for (const [name, value] of Object.entries(headers)) {
    for (const v of variants) {
      if (value.includes(v)) return name;
    }
  }
  return null;
}

function isHtmlContentType(headers: Record<string, string> | undefined): boolean {
  const ct = headers?.["content-type"] ?? headers?.["Content-Type"] ?? "";
  return /text\/html|application\/xhtml/i.test(ct);
}

function classifyInner(
  hit: SecurityFieldHit,
  payload: string,
  resp: ClassifyResp,
  ctx: { endpoint?: EndpointInfo } = {},
): SecurityFinding {
  const status = resp.status;
  const echo = classifyEcho(resp.body_parsed ?? resp.body, payload, hit.class);
  const echoed = echo.matched;

  if (status >= 500) {
    // ARV-250: 5xx on attack payload is a reliability signal, not a
    // proven security issue. Single-signal proof (one crashed response)
    // caps severity at LOW per the m-21 severity matrix. ARV-251
    // relocates this signal to the reliability category; the existing
    // `not_a_server_error` check already tracks 5xx on positive input,
    // so the security probe here is a secondary signal at best.
    return {
      field: hit.field,
      class: hit.class,
      payload,
      status,
      echoed,
      severity: "low",
      reason: `5xx unhandled — server crashed on ${hit.class} payload (reliability signal; see also not_a_server_error check)`,
    };
  }
  if (status >= 200 && status < 300) {
    // ARV-253: CRLF severity now keyed on reflection context, not on
    // raw echo. The pivot principle: HIGH requires evidence the stored
    // payload reaches a dangerous rendering context (header value /
    // unescaped HTML). Echo in a JSON body alone is single_signal —
    // storage is real, exploit pathway is not. Caps at LOW.
    if (hit.class === "crlf") {
      const headerName = reflectsInHeaders(payload, resp.headers);
      if (headerName) {
        return {
          field: hit.field,
          class: hit.class,
          payload,
          status,
          echoed: true,
          severity: "high",
          reason: `payload reflected in response header \`${headerName}\` — response-splitting / header-injection candidate (evidence_chain)`,
        };
      }
      if (echoed && isHtmlContentType(resp.headers)) {
        return {
          field: hit.field,
          class: hit.class,
          payload,
          status,
          echoed,
          severity: "high",
          reason: `payload echoed (${echo.kind}) in text/html response — unescaped reflection candidate (evidence_chain)`,
        };
      }
      if (echoed) {
        return {
          field: hit.field,
          class: hit.class,
          payload,
          status,
          echoed,
          severity: "low",
          reason: `payload echoed (${echo.kind}) in JSON body — storage observed, no dangerous-context reflection. Manual follow-up: check whether the stored value reaches a downstream renderer (HTML page, RSS, custom header).`,
        };
      }
      return {
        field: hit.field,
        class: hit.class,
        payload,
        status,
        echoed: false,
        severity: "info",
        reason: `${status} accepted ${hit.class} payload but no reflection observed — sanitization may be missing but no exploit pathway proven`,
      };
    }
    // ARV-254: SSRF / open-redirect severity rebalance.
    //
    // Without an out-of-band (OOB) channel zond can't prove the server
    // actually fetched the injected URL. "API accepted 169.254" is
    // single_signal proof — caps at LOW per the m-21 matrix.
    //
    // Stake-raising signal: when the spec declares delivery semantics
    // (path/tag mentions webhook / callback / subscription), the server
    // is documented to fetch the URL — surface MEDIUM. Full HIGH is
    // gated on OOB confirmation which lands with ARV-177 (deferred-
    // post-pivot, out of scope for now).
    const declaresDelivery = endpointDeclaresDelivery(ctx.endpoint);
    const oobDisclaimer = "no OOB channel — accept ≠ proven fetch. Verify with Burp Collaborator / interactsh manually for HIGH severity.";
    if (echoed) {
      const label = echo.kind === "verbatim"
        ? "payload echoed verbatim"
        : `payload echoed (${echo.kind})`;
      if (declaresDelivery) {
        return {
          field: hit.field,
          class: hit.class,
          payload,
          status,
          echoed,
          severity: "low",
          reason: `${label}; ${hit.class}: endpoint declares delivery (webhook/callback) but ${oobDisclaimer}`,
        };
      }
      return {
        field: hit.field,
        class: hit.class,
        payload,
        status,
        echoed,
        severity: "low",
        reason: `${label} — stored ${hit.class} candidate; ${oobDisclaimer}`,
      };
    }
    if (declaresDelivery) {
      return {
        field: hit.field,
        class: hit.class,
        payload,
        status,
        echoed,
        severity: "medium",
        reason: `2xx accepted ${hit.class} payload on endpoint declaring delivery semantics (webhook/callback). ${oobDisclaimer}`,
      };
    }
    return {
      field: hit.field,
      class: hit.class,
      payload,
      status,
      echoed,
      severity: "low",
      reason: `2xx accepted ${hit.class} payload but no echo observed. ${oobDisclaimer}`,
    };
  }
  if (status >= 400) {
    return {
      field: hit.field,
      class: hit.class,
      payload,
      status,
      echoed,
      severity: "ok",
      reason: `${status} rejected — ${hit.class} payload refused`,
    };
  }
  return {
    field: hit.field,
    class: hit.class,
    payload,
    status,
    echoed,
    severity: "inconclusive",
    reason: `unexpected status ${status}`,
  };
}

function bodyToString(body: unknown): string {
  if (!body) return "";
  if (typeof body === "string") return body;
  // Walk object/array, concatenating raw string leaves so CR/LF chars aren't
  // hidden behind JSON escape sequences (\r → "\\r" after JSON.stringify).
  const parts: string[] = [];
  const seen = new WeakSet<object>();
  const visit = (v: unknown): void => {
    if (typeof v === "string") parts.push(v);
    else if (v && typeof v === "object") {
      if (seen.has(v as object)) return;
      seen.add(v as object);
      if (Array.isArray(v)) v.forEach(visit);
      else for (const k of Object.keys(v as object)) visit((v as Record<string, unknown>)[k]);
    }
  };
  try {
    visit(body);
  } catch {
    return "";
  }
  return parts.join("\n");
}

function safeDecodeURI(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

type EchoKind =
  | "verbatim"
  | "url-decoded"
  | "CR stripped"
  | "LF stripped"
  | "CRLF→LF"
  | "CRLF→CR"
  | "tail after CRLF";

export interface EchoResult {
  matched: boolean;
  kind: EchoKind | "none";
}

export function classifyEcho(body: unknown, payload: string, cls: SecurityClass): EchoResult {
  if (!payload) return { matched: false, kind: "none" };
  const haystackRaw = bodyToString(body);
  if (!haystackRaw) return { matched: false, kind: "none" };

  // SSRF / open-redirect: verbatim only — URLs are usually preserved as-is.
  if (cls !== "crlf") {
    return haystackRaw.includes(payload)
      ? { matched: true, kind: "verbatim" }
      : { matched: false, kind: "none" };
  }

  // CRLF: try verbatim → URL-decode pairs → CR/LF normalization variants → tail.
  if (haystackRaw.includes(payload)) return { matched: true, kind: "verbatim" };

  const haystackDecoded = safeDecodeURI(haystackRaw);
  const payloadDecoded = safeDecodeURI(payload);

  if (
    (payloadDecoded !== payload && haystackRaw.includes(payloadDecoded)) ||
    (haystackDecoded !== haystackRaw && haystackDecoded.includes(payload)) ||
    (payloadDecoded !== payload && haystackDecoded !== haystackRaw && haystackDecoded.includes(payloadDecoded))
  ) {
    return { matched: true, kind: "url-decoded" };
  }

  // Normalize: try variants of payload where backend stripped CR or LF.
  const variants: Array<[string, EchoKind]> = [];
  if (payloadDecoded.includes("\r\n")) {
    variants.push([payloadDecoded.replace(/\r\n/g, "\n"), "CRLF→LF"]);
    variants.push([payloadDecoded.replace(/\r\n/g, "\r"), "CRLF→CR"]);
    variants.push([payloadDecoded.replace(/\r\n/g, ""), "CRLF→LF"]);
  }
  if (payloadDecoded.includes("\r")) variants.push([payloadDecoded.replace(/\r/g, ""), "CR stripped"]);
  if (payloadDecoded.includes("\n")) variants.push([payloadDecoded.replace(/\n/g, ""), "LF stripped"]);

  for (const [variant, kind] of variants) {
    if (variant && variant !== payloadDecoded && (haystackRaw.includes(variant) || haystackDecoded.includes(variant))) {
      return { matched: true, kind };
    }
  }

  // Tail-substring: parser truncated at newline, only suffix landed in storage.
  const splitMatch = payloadDecoded.match(/(?:\r\n|%0d%0a|%0a|%0d|\r|\n)(.+)$/i);
  const tail = splitMatch?.[1];
  if (tail && tail.length >= 3 && (haystackRaw.includes(tail) || haystackDecoded.includes(tail))) {
    return { matched: true, kind: "tail after CRLF" };
  }

  return { matched: false, kind: "none" };
}
