/**
 * Тестовый издатель OIDC: discovery, JWKS и выдача `id_token` для popup-входа.
 *
 * Живёт в процессе глобальной подготовки HTTP-тестов, а сами тесты работают
 * в других процессах, поэтому состояние меняется по HTTP:
 * `POST /__control` (только с loopback) с JSON `{profile, tamper}`,
 * `POST /__token` с `{nonce}` выдаёт подписанный токен.
 */
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
  clientId: string;
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

interface IssuerState {
  profile: TelegramProfile;
  tamper: TamperKind | null;
  /** Последний выданный токен: нужен тесту журнала приложения. */
  last: { idToken: string } | null;
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
    last: null,
  };

  async function signIdToken(nonce: string | undefined): Promise<string> {
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
    if (nonce !== undefined) payload.nonce = nonce;

    switch (state.tamper) {
      case "bad_aud":
        payload.aud = "another-client";
        break;
      case "bad_iss":
        payload.iss = "https://evil.example";
        break;
      case "expired":
        payload.exp = now - 60;
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
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ["code", "post_message"],
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

    if (path === "/__token" && request.method === "POST") {
      if (!isLoopback(request.socket.remoteAddress)) {
        response.writeHead(403).end("loopback only");
        return;
      }
      const body = JSON.parse(await readBody(request)) as { nonce?: unknown };
      const nonce = typeof body.nonce === "string" ? body.nonce : undefined;
      const idToken = await signIdToken(nonce);
      state.last = { idToken };
      sendJson(response, 200, { id_token: idToken });
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
        reset?: boolean;
      };

      if (body.reset === true) {
        state.profile = { ...DEFAULT_PROFILE };
        state.tamper = null;
        state.last = null;
      }
      if (body.profile !== undefined) state.profile = body.profile;
      if (body.tamper !== undefined) state.tamper = body.tamper;

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
