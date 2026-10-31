/**
 * Проверка Telegram `id_token`, который библиотека `telegram-login.js`
 * получает в popup и присылает на сервер.
 *
 * Сервер выдаёт одноразовый `nonce` и подписанный токен. Браузер передаёт
 * `nonce` библиотеке и возвращает токен вместе с `id_token` на сервер,
 * который проверяет подпись по JWKS и сверяет `nonce`.
 * Секреты и токены в журнал не попадают — наружу отдаётся только код сбоя.
 */
import { timingSafeEqual } from "node:crypto";

import {
  SignJWT,
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JWTPayload,
  type RemoteJWKSet,
} from "jose";

import { NONCE_TTL_SECONDS } from "./nonce";
import { truncateName } from "./name";
import type { TelegramProfile } from "./service";

/** Сбой входа: `code` пишется в журнал вместо текста исключения. */
export class AuthFlowError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "AuthFlowError";
    this.code = code;
  }
}

export interface OidcSettings {
  issuer: string;
  clientId: string;
}

interface DiscoveryDocument {
  issuer: string;
  jwks_uri: string;
}

const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const DISCOVERY_TIMEOUT_MS = 10_000;
const JWKS_TIMEOUT_MS = 10_000;

interface CachedDiscovery {
  document: DiscoveryDocument;
  expiresAt: number;
}

const discoveryCache = new Map<string, CachedDiscovery>();
const jwksCache = new Map<string, RemoteJWKSet>();

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Проверяет, что адрес из discovery принадлежит тому же origin, что издатель. */
function assertIssuerOrigin(issuer: string, value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AuthFlowError(`discovery_bad_${field}`);
  }
  if (url.origin !== new URL(issuer).origin) throw new AuthFlowError(`discovery_bad_${field}`);
  return url.toString();
}

/** Discovery-документ кэшируется в памяти на час. */
export async function loadDiscovery(issuer: string): Promise<DiscoveryDocument> {
  const cached = discoveryCache.get(issuer);
  if (cached !== undefined && cached.expiresAt > Date.now()) return cached.document;

  const discoveryUrl = new URL(".well-known/openid-configuration", `${issuer}/`);
  let response: Response;
  try {
    response = await fetch(discoveryUrl, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new AuthFlowError("discovery_unavailable");
  }
  if (!response.ok) throw new AuthFlowError("discovery_unavailable");

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new AuthFlowError("discovery_invalid");
  }
  if (typeof raw !== "object" || raw === null) throw new AuthFlowError("discovery_invalid");
  const data = raw as Record<string, unknown>;

  const documentIssuer = stringValue(data.issuer);
  const jwksUri = stringValue(data.jwks_uri);
  if (documentIssuer === null || jwksUri === null) {
    throw new AuthFlowError("discovery_invalid");
  }
  if (documentIssuer !== issuer) throw new AuthFlowError("discovery_issuer_mismatch");

  const document: DiscoveryDocument = {
    issuer: documentIssuer,
    jwks_uri: assertIssuerOrigin(issuer, jwksUri, "jwks_uri"),
  };

  discoveryCache.set(issuer, { document, expiresAt: Date.now() + DISCOVERY_TTL_MS });
  return document;
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/** Подписывает nonce незавершённого входа (HS256, `SESSION_SECRET`). */
export async function signLoginNonce(nonce: string, sessionSecret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ nonce })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + NONCE_TTL_SECONDS)
    .sign(secretKey(sessionSecret));
}

/** Проверяет подпись и срок контейнера, возвращает `nonce`. */
export async function verifyLoginNonce(
  token: string,
  sessionSecret: string,
): Promise<string> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, secretKey(sessionSecret), {
      algorithms: ["HS256"],
      clockTolerance: 5,
      requiredClaims: ["exp", "iat"],
    }));
  } catch (error) {
    throw new AuthFlowError(oidcErrorCode(error));
  }

  const nonce = stringValue(payload.nonce);
  if (nonce === null) throw new AuthFlowError("bad_nonce_token");
  return nonce;
}

/** Сравнение за постоянное время для `nonce`. */
export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function remoteJwks(jwksUri: string): RemoteJWKSet {
  const cached = jwksCache.get(jwksUri);
  if (cached !== undefined) return cached;
  const jwks = createRemoteJWKSet(new URL(jwksUri), { timeoutDuration: JWKS_TIMEOUT_MS });
  jwksCache.set(jwksUri, jwks);
  return jwks;
}

/** Проверяет `id_token`: подпись RS256, издатель, аудиторию, сроки и `nonce`. */
export async function verifyIdToken(
  idToken: string,
  settings: OidcSettings,
  discovery: DiscoveryDocument,
  expectedNonce: string,
): Promise<JWTPayload> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(idToken, remoteJwks(discovery.jwks_uri), {
      algorithms: ["RS256"],
      issuer: settings.issuer,
      audience: settings.clientId,
      clockTolerance: 30,
      requiredClaims: ["sub", "exp", "iat"],
    }));
  } catch (error) {
    throw new AuthFlowError(oidcErrorCode(error));
  }

  const nonce = stringValue(payload.nonce);
  if (nonce === null) throw new AuthFlowError("missing_nonce");
  if (!safeEqual(nonce, expectedNonce)) throw new AuthFlowError("bad_nonce");

  return payload;
}

const MAX_PHOTO_URL_LENGTH = 1000;

/** Превращает claims Telegram в профиль пользователя. */
export function profileFromClaims(payload: JWTPayload): TelegramProfile {
  const id = payload.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    throw new AuthFlowError("missing_id");
  }

  const preferredUsername = stringValue(payload.preferred_username);
  const name = stringValue(payload.name) ?? preferredUsername ?? `Пользователь ${id}`;
  const picture = stringValue(payload.picture);
  const photoUrl =
    picture !== null && picture.startsWith("https://") && picture.length <= MAX_PHOTO_URL_LENGTH
      ? picture
      : null;

  return {
    telegramId: id,
    name: truncateName(name),
    username: preferredUsername,
    photoUrl,
  };
}

/** Код причины сбоя для журнала; тексты ошибок наружу не уходят. */
function oidcErrorCode(error: unknown): string {
  if (error instanceof AuthFlowError) return error.code;
  if (error instanceof errors.JWTExpired) return "expired";
  if (error instanceof errors.JWKSNoMatchingKey) return "unknown_kid";
  if (error instanceof errors.JWSSignatureVerificationFailed) return "bad_signature";
  if (error instanceof errors.JOSEAlgNotAllowed) return "bad_algorithm";
  if (error instanceof errors.JWTClaimValidationFailed) {
    if (error.claim === "iss") return "bad_iss";
    if (error.claim === "aud") return "bad_aud";
    if (error.claim === "sub") return "missing_sub";
    return "bad_claims";
  }
  return "failed";
}

/** Полный вход: проверка `id_token` с ожидаемым nonce и профиль. */
export async function authenticateWithIdToken(
  settings: OidcSettings,
  input: { idToken: string; expectedNonce: string },
): Promise<TelegramProfile> {
  const discovery = await loadDiscovery(settings.issuer);
  const payload = await verifyIdToken(input.idToken, settings, discovery, input.expectedNonce);
  return profileFromClaims(payload);
}
