/**
 * Поток входа Telegram по OIDC: discovery, PKCE, обмен кода и проверка
 * `id_token`. Секреты и коды в журнал не попадают — наружу отдаётся только
 * код причины сбоя (`AuthFlowError.code`).
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

import type { TelegramProfile } from "./service";
import { truncateName } from "./name";

/** Сбой потока входа: `code` пишется в журнал вместо текста исключения. */
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
const TOKEN_TIMEOUT_MS = 10_000;
const CONTAINER_TTL_SECONDS = 600;

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

/** Подписывает контейнер незавершённого входа (HS256, `SESSION_SECRET`). */
export async function signOidcContainer(
  container: OidcContainer,
  sessionSecret: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    state: container.state,
    nonce: container.nonce,
    verifier: container.verifier,
    next: container.next,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + CONTAINER_TTL_SECONDS)
    .sign(secretKey(sessionSecret));
}

/** Проверяет подпись и срок контейнера, возвращает его поля. */
export async function verifyOidcContainer(
  token: string,
  sessionSecret: string,
): Promise<OidcContainer> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, secretKey(sessionSecret), {
      algorithms: ["HS256"],
      clockTolerance: 5,
    }));
  } catch (error) {
    throw new AuthFlowError(oidcErrorCode(error));
  }

  const state = stringValue(payload.state);
  const nonce = stringValue(payload.nonce);
  const verifier = stringValue(payload.verifier);
  const next = stringValue(payload.next);
  if (state === null || nonce === null || verifier === null || next === null) {
    throw new AuthFlowError("bad_oidc_cookie");
  }
  return { state, nonce, verifier, next };
}

function base64urlDigest(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function randomValue(): string {
  return randomBytes(32).toString("base64url");
}

export interface LoginRequest {
  url: URL;
  container: OidcContainer;
}

/** Собирает адрес авторизации Telegram и значения для cookie `studio_oidc`. */
export async function createLoginRequest(
  settings: OidcSettings,
  next: string,
): Promise<LoginRequest> {
  const discovery = await loadDiscovery(settings.issuer);
  const state = randomValue();
  const nonce = randomValue();
  // PKCE: verifier 43 символа, challenge — SHA-256 в base64url.
  const verifier = randomValue();

  const url = new URL(discovery.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: `${settings.appUrl}/api/auth/telegram/callback`,
    response_type: "code",
    scope: "openid profile",
    state,
    nonce,
    code_challenge: base64urlDigest(verifier),
    code_challenge_method: "S256",
  }).toString();

  return { url, container: { state, nonce, verifier, next } };
}

/** Сравнение за постоянное время для `state` и `nonce`. */
export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface TokenResponse {
  id_token?: unknown;
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
    });
  } catch {
    throw new AuthFlowError("token_exchange_failed");
  }
  if (response.status !== 200) throw new AuthFlowError("token_exchange_failed");

  let payload: TokenResponse;
  try {
    payload = (await response.json()) as TokenResponse;
  } catch {
    throw new AuthFlowError("token_exchange_failed");
  }
  const idToken = stringValue(payload.id_token);
  if (idToken === null) throw new AuthFlowError("no_id_token");
  return idToken;
}

function remoteJwks(jwksUri: string): RemoteJWKSet {
  const cached = jwksCache.get(jwksUri);
  if (cached !== undefined) return cached;
  const jwks = createRemoteJWKSet(new URL(jwksUri), { timeoutDuration: TOKEN_TIMEOUT_MS });
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

export interface CompletedLogin {
  profile: TelegramProfile;
  next: string;
}

/** Полный callback: контейнер, `state`, обмен кода, проверка токена и профиль. */
export async function completeLogin(
  settings: OidcSettings,
  input: { code: string; state: string; containerToken: string; sessionSecret: string },
): Promise<CompletedLogin> {
  const container = await verifyOidcContainer(input.containerToken, input.sessionSecret);
  if (!safeEqual(input.state, container.state)) throw new AuthFlowError("state_mismatch");

  const discovery = await loadDiscovery(settings.issuer);
  const idToken = await exchangeCode(settings, discovery, input.code, container.verifier);
  const payload = await verifyIdToken(idToken, settings, discovery, container.nonce);
  return { profile: profileFromClaims(payload), next: container.next };
}

/**
 * Проверяет сообщение из `?error=` от Telegram: любой отказ означает сбой входа.
 */
export function assertNoProviderError(value: string | null): void {
  if (value !== null) throw new AuthFlowError("provider_error");
}
