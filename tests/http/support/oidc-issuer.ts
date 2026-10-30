/**
 * Тестовый издатель OIDC: discovery, JWKS, авторизация и токен-эндпоинт.
 *
 * Живёт в процессе глобальной подготовки HTTP-тестов, а сами тесты работают
 * в других процессах, поэтому состояние меняется по HTTP:
 * `POST /__control` (только с loopback) с JSON `{profile, tamper, authorize}`.
 */
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { SignJWT, exportJWK, exportSPKI, generateKeyPair, type JWK } from "jose";

export type TamperKind =
  | "bad_signature"
  | "bad_aud"
  | "bad_iss"
  | "expired"
  | "bad_nonce"
  | "no_nonce"
  | "no_id"
  | "alg_none"
  | "alg_hs256"
  | "unknown_kid";

export interface TelegramProfile {
  id: number;
  name: string;
  preferred_username?: string | null;
  picture?: string | null;
}

export interface OidcIssuerOptions {
  /** Адрес приложения: сюда издатель возвращает код. */
  appUrl: string;
  clientId: string;
  clientSecret: string;
}

export interface OidcIssuer {
  url: string;
  close(): Promise<void>;
}

export const DEFAULT_PROFILE: TelegramProfile = {
  id: 4242,
  name: "Тест Тестович",
  preferred_username: "test_user",
  picture: "https://example.com/avatar.png",
};

interface PendingCode {
  nonce: string;
  challenge: string;
  redirectUri: string;
  state: string;
}

interface IssuerState {
  profile: TelegramProfile;
  tamper: TamperKind | null;
  authorize: "approve" | "deny";
  pending: Map<string, PendingCode>;
  used: Set<string>;
  /** Последняя выданная пара: нужна тесту журнала приложения. */
  last: { code: string; idToken: string } | null;
}

function randomId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function sendRedirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  response.end();
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      if (chunks.reduce((sum, item) => sum + item.length, 0) > 1_000_000) {
        reject(new Error("body too large"));
      }
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

async function createKeys(): Promise<{
  privateKey: CryptoKey;
  jwks: { keys: JWK[] };
  kid: string;
  publicPem: string;
}> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const kid = `issuer-${randomId().slice(0, 8)}`;
  const jwk = await exportJWK(publicKey);
  return {
    privateKey,
    jwks: { keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] },
    kid,
    publicPem: await exportSPKI(publicKey),
  };
}

export async function startOidcIssuer(
  url: string,
  options: OidcIssuerOptions,
): Promise<OidcIssuer> {
  const issuerUrl = new URL(url);
  const issuer = issuerUrl.origin;
  const primary = await createKeys();
  const foreign = await createKeys();

  const state: IssuerState = {
    profile: { ...DEFAULT_PROFILE },
    tamper: null,
    authorize: "approve",
    pending: new Map(),
    used: new Set(),
    last: null,
  };

  async function idTokenPayload(): Promise<Record<string, unknown>> {
    const now = Math.floor(Date.now() / 1000);
    const payload: Record<string, unknown> = {
      iss: issuer,
      aud: options.clientId,
      sub: `telegram-${state.profile.id}`,
      iat: now,
      exp: now + 600,
      id: state.profile.id,
      name: state.profile.name,
      preferred_username: state.profile.preferred_username ?? undefined,
      picture: state.profile.picture ?? undefined,
    };
    return payload;
  }

  async function signIdToken(code: string): Promise<string> {
    const pending = state.pending.get(code);
    if (pending === undefined) throw new Error("unknown code");
    const payload = await idTokenPayload();
    payload.nonce = pending.nonce;

    switch (state.tamper) {
      case "bad_aud":
        payload.aud = "another-client";
        break;
      case "bad_iss":
        payload.iss = "https://evil.example";
        break;
      case "expired":
        payload.exp = Math.floor(Date.now() / 1000) - 60;
        break;
      case "bad_nonce":
        payload.nonce = "wrong-nonce";
        break;
      case "no_nonce":
        delete payload.nonce;
        break;
      case "no_id":
        delete payload.id;
        break;
      default:
        break;
    }

    if (state.tamper === "alg_none") {
      return `${base64url({ alg: "none", typ: "JWT" })}.${base64url(payload)}.`;
    }
    if (state.tamper === "alg_hs256") {
      const secret = new TextEncoder().encode(primary.publicPem);
      return new SignJWT(payload)
        .setProtectedHeader({ alg: "HS256", typ: "JWT", kid: primary.kid })
        .sign(secret);
    }
    if (state.tamper === "bad_signature") {
      return new SignJWT(payload)
        .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: primary.kid })
        .sign(foreign.privateKey);
    }
    if (state.tamper === "unknown_kid") {
      return new SignJWT(payload)
        .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "unknown-kid" })
        .sign(primary.privateKey);
    }
    return new SignJWT(payload)
      .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: primary.kid })
      .sign(primary.privateKey);
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestUrl = new URL(request.url ?? "/", issuer);
    const path = requestUrl.pathname;

    if (path === "/.well-known/openid-configuration") {
      sendJson(response, 200, {
        issuer,
        authorization_endpoint: `${issuer}/auth`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        scopes_supported: ["openid", "profile"],
      });
      return;
    }

    if (path === "/jwks") {
      sendJson(response, 200, primary.jwks);
      return;
    }

    if (path === "/auth") {
      const query = requestUrl.searchParams;
      const expectedRedirect = `${options.appUrl}/api/auth/telegram/callback`;

      if (query.get("client_id") !== options.clientId) {
        response.writeHead(400).end("bad client_id");
        return;
      }
      if (query.get("redirect_uri") !== expectedRedirect) {
        response.writeHead(400).end("bad redirect_uri");
        return;
      }
      if (query.get("response_type") !== "code") {
        response.writeHead(400).end("bad response_type");
        return;
      }
      if (query.get("scope") !== "openid profile") {
        response.writeHead(400).end("bad scope");
        return;
      }
      if (query.get("code_challenge_method") !== "S256") {
        response.writeHead(400).end("bad code_challenge_method");
        return;
      }
      const challenge = query.get("code_challenge");
      const stateValue = query.get("state");
      const nonce = query.get("nonce");
      if (challenge === null || stateValue === null || nonce === null) {
        response.writeHead(400).end("missing PKCE, state or nonce");
        return;
      }

      if (state.authorize === "deny") {
        const denied = new URL(expectedRedirect);
        denied.searchParams.set("error", "access_denied");
        denied.searchParams.set("state", stateValue);
        sendRedirect(response, denied.toString());
        return;
      }

      const code = randomId();
      state.pending.set(code, {
        nonce,
        challenge,
        redirectUri: expectedRedirect,
        state: stateValue,
      });
      const granted = new URL(expectedRedirect);
      granted.searchParams.set("code", code);
      granted.searchParams.set("state", stateValue);
      sendRedirect(response, granted.toString());
      return;
    }

    if (path === "/token" && request.method === "POST") {
      const body = await readBody(request);
      const form = new URLSearchParams(body);

      // Токен-эндпоинт Telegram всегда отвечает 200; сбой виден по телу.
      const expected = Buffer.from(
        `${options.clientId}:${options.clientSecret}`,
        "utf8",
      ).toString("base64");
      if (request.headers.authorization !== `Basic ${expected}`) {
        sendJson(response, 200, { error: "invalid_client" });
        return;
      }

      const code = form.get("code") ?? "";
      const verifier = form.get("code_verifier") ?? "";
      const pending = state.pending.get(code);
      if (
        pending === undefined ||
        state.used.has(code) ||
        form.get("grant_type") !== "authorization_code" ||
        form.get("redirect_uri") !== pending.redirectUri ||
        form.get("client_id") !== options.clientId
      ) {
        sendJson(response, 200, { error: "invalid_grant" });
        return;
      }

      const digest = createHash("sha256").update(verifier).digest("base64url");
      if (digest !== pending.challenge) {
        sendJson(response, 200, { error: "invalid_grant" });
        return;
      }

      state.used.add(code);
      const idToken = await signIdToken(code);
      state.last = { code, idToken };
      sendJson(response, 200, {
        access_token: `access-${randomId()}`,
        token_type: "Bearer",
        expires_in: 3600,
        id_token: idToken,
      });
      return;
    }

    if (path === "/__last" && request.method === "GET") {
      if (!isLoopback(request.socket.remoteAddress)) {
        response.writeHead(403).end("loopback only");
        return;
      }
      sendJson(response, 200, state.last);
      return;
    }

    if (path === "/__control" && request.method === "POST") {
      if (!isLoopback(request.socket.remoteAddress)) {
        response.writeHead(403).end("loopback only");
        return;
      }
      const body = JSON.parse(await readBody(request)) as {
        profile?: TelegramProfile;
        tamper?: TamperKind | null;
        authorize?: "approve" | "deny";
        reset?: boolean;
      };

      if (body.reset === true) {
        state.profile = { ...DEFAULT_PROFILE };
        state.tamper = null;
        state.authorize = "approve";
        state.pending.clear();
        state.used.clear();
        state.last = null;
      }
      if (body.profile !== undefined) state.profile = body.profile;
      if (body.tamper !== undefined) state.tamper = body.tamper;
      if (body.authorize !== undefined) state.authorize = body.authorize;

      sendJson(response, 200, { ok: true });
      return;
    }

    response.writeHead(404).end("not found");
  }

  const server: Server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      console.error("[oidc-issuer]", error);
      if (!response.headersSent) response.writeHead(500);
      response.end("issuer error");
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(issuerUrl.port), "127.0.0.1", () => resolve());
  });

  return {
    url: issuer,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}
