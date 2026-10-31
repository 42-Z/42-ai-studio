/**
 * Вход через Telegram OIDC: редиректы, PKCE, серверный обмен кода и
 * проверка `id_token`. В журнал попадает только код причины сбоя.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  SignJWT,
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JWTPayload,
  type RemoteJWKSet,
} from "jose";

import { NONCE_TTL_SECONDS, consumeLoginNonce, issueLoginNonce } from "./nonce";
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
  clientSecret: string;
  appUrl: string;
}

interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface OidcContainer {
  state: string;
  nonce: string;
  verifier: string;
  next: string;
}

const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const DISCOVERY_TIMEOUT_MS = 10_000;
const JWKS_TIMEOUT_MS = 10_000;
const TOKEN_TIMEOUT_MS = 10_000;

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
      redirect: "error",
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
  const authorizationEndpoint = stringValue(data.authorization_endpoint);
  const tokenEndpoint = stringValue(data.token_endpoint);
  const jwksUri = stringValue(data.jwks_uri);
  if (
    documentIssuer === null ||
    authorizationEndpoint === null ||
    tokenEndpoint === null ||
    jwksUri === null
  ) {
    throw new AuthFlowError("discovery_invalid");
  }
  if (documentIssuer !== issuer) throw new AuthFlowError("discovery_issuer_mismatch");

  const document: DiscoveryDocument = {
    issuer: documentIssuer,
    authorization_endpoint: assertIssuerOrigin(
      issuer,
      authorizationEndpoint,
      "authorization_endpoint",
    ),
    token_endpoint: assertIssuerOrigin(issuer, tokenEndpoint, "token_endpoint"),
    jwks_uri: assertIssuerOrigin(issuer, jwksUri, "jwks_uri"),
  };

  discoveryCache.set(issuer, { document, expiresAt: Date.now() + DISCOVERY_TTL_MS });
  return document;
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/** Подписывает временную cookie с state, nonce и PKCE verifier. */
export async function signOidcContainer(
  container: OidcContainer,
  sessionSecret: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...container })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + NONCE_TTL_SECONDS)
    .sign(secretKey(sessionSecret));
}

/** Проверяет подпись, срок и обязательные поля временной cookie входа. */
export async function verifyOidcContainer(
  token: string,
  sessionSecret: string,
): Promise<OidcContainer> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, secretKey(sessionSecret), {
      algorithms: ["HS256"],
      clockTolerance: 5,
      requiredClaims: ["exp", "iat"],
      maxTokenAge: NONCE_TTL_SECONDS,
    }));
  } catch (error) {
    throw new AuthFlowError(oidcErrorCode(error));
  }

  const nonce = stringValue(payload.nonce);
  const state = stringValue(payload.state);
  const verifier = stringValue(payload.verifier);
  const next = stringValue(payload.next);
  if (nonce === null || state === null || verifier === null || next === null) {
    throw new AuthFlowError("bad_oidc_cookie");
  }
  return { state, nonce, verifier, next };
}

/** Создаёт PKCE и одноразовый nonce, формирует адрес авторизации. */
export async function createLoginRequest(settings: OidcSettings, next: string): Promise<{
  url: URL;
  container: OidcContainer;
}> {
  const discovery = await loadDiscovery(settings.issuer);
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const nonce = await issueLoginNonce();
  const url = new URL(discovery.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: `${settings.appUrl}/api/auth/telegram/callback`,
    response_type: "code",
    scope: "openid profile",
    state,
    nonce,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { url, container: { state, nonce, verifier, next } };
}

async function exchangeCode(
  settings: OidcSettings,
  discovery: DiscoveryDocument,
  code: string,
  verifier: string,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: `${settings.appUrl}/api/auth/telegram/callback`,
    client_id: settings.clientId,
    code_verifier: verifier,
  });
  const credentials = Buffer.from(
    `${settings.clientId}:${settings.clientSecret}`,
    "utf8",
  ).toString("base64");
  let response: Response;
  try {
    response = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new AuthFlowError("token_exchange_failed");
  }
  if (response.status !== 200) throw new AuthFlowError("token_exchange_failed");
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AuthFlowError("token_exchange_failed");
  }
  if (typeof payload !== "object" || payload === null) throw new AuthFlowError("no_id_token");
  const idToken = stringValue((payload as Record<string, unknown>).id_token);
  if (idToken === null) throw new AuthFlowError("no_id_token");
  return idToken;
}

/** Сравнение за постоянное время для state и nonce. */
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
  // Telegram присылает id строкой, хотя официальный пример показывает число.
  const rawId = payload.id;
  const id = typeof rawId === "string" && /^[1-9]\d*$/.test(rawId) ? Number(rawId) : rawId;
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

/** Проверяет cookie и state, обменивает код и проверяет одноразовый nonce. */
export async function completeLogin(
  settings: OidcSettings,
  input: { code: string; state: string; containerToken: string; sessionSecret: string },
): Promise<{ profile: TelegramProfile; next: string }> {
  const container = await verifyOidcContainer(input.containerToken, input.sessionSecret);
  if (!safeEqual(input.state, container.state)) throw new AuthFlowError("state_mismatch");
  const discovery = await loadDiscovery(settings.issuer);
  const idToken = await exchangeCode(settings, discovery, input.code, container.verifier);
  const payload = await verifyIdToken(idToken, settings, discovery, container.nonce);
  const profile = profileFromClaims(payload);
  if (!(await consumeLoginNonce(container.nonce))) throw new AuthFlowError("bad_nonce");
  return { profile, next: container.next };
}
