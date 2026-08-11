import { describe, it, expect } from "vitest";
import { safeReturnTo, buildAuthorizeUrl, pkcePair, randomState } from "../visant-user-oauth";

const BASE = "https://loja.example.com/api/auth/visant/callback";

describe("safeReturnTo", () => {
  it("keeps an internal path", () => {
    expect(safeReturnTo("/calibrate")).toBe("/calibrate");
    expect(safeReturnTo("/")).toBe("/");
    expect(safeReturnTo("/a/b?c=1#d")).toBe("/a/b?c=1#d");
  });

  const hostis: Array<[string | null, string]> = [
    ["//evil.example.net", "protocol-relative"],
    ["/\\evil.example.net", "backslash"],
    ["https://evil.example.net", "absolute"],
    ["calibrate", "sem barra"],
    ["", "vazio"],
    [null, "ausente"],
  ];

  it.each(hostis)("blocks %s (%s)", (input) => {
    expect(safeReturnTo(input)).toBe("/");
  });

  it("never leaves this host once resolved", () => {
    for (const hostil of ["//evil.example.net", "/\\evil.example.net", "https://evil.example.net"]) {
      const url = new URL(safeReturnTo(hostil), BASE);
      // Era exatamente isto que vazava: URL("//evil…") herda o protocolo e troca o host.
      expect(url.host).toBe("loja.example.com");
    }
  });
});

describe("buildAuthorizeUrl", () => {
  const client = { clientId: "cid", redirectUri: BASE };

  it("carries PKCE S256 and the state", () => {
    const { challenge } = pkcePair();
    const state = randomState();
    const u = new URL(buildAuthorizeUrl(client, state, challenge));

    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toBe(challenge);
    expect(u.searchParams.get("state")).toBe(state);
    expect(u.searchParams.get("redirect_uri")).toBe(BASE);
  });

  it("appends returnTo to the state without losing the CSRF half", () => {
    const u = new URL(buildAuthorizeUrl(client, "st4te", "chal", "/calibrate"));
    const [csrf, ret] = (u.searchParams.get("state") || "").split("|");
    expect(csrf).toBe("st4te");
    expect(decodeURIComponent(ret)).toBe("/calibrate");
  });
});

describe("pkcePair", () => {
  it("derives the challenge from the verifier, never reusing it", () => {
    const a = pkcePair();
    const b = pkcePair();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(a.verifier);
    expect(a.verifier.length).toBeGreaterThanOrEqual(43); // RFC 7636
  });
});
