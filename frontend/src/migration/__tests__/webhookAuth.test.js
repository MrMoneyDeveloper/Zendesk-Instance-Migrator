import { describe, expect, it } from "vitest";

import { buildWebhookAuthentication, buildZendeskBasicAuthUsername, redactSecrets, stripWebhookSecrets } from "../webhookAuth";

describe("webhookAuth", () => {
  it("builds zendesk basic auth username and auth payload", () => {
    expect(buildZendeskBasicAuthUsername("admin@example.com")).toBe("admin@example.com/token");
    expect(buildWebhookAuthentication({ email: "admin@example.com", apiToken: "tok_123" })).toEqual({
      type: "basic_auth",
      add_position: "header",
      data: {
        username: "admin@example.com/token",
        password: "tok_123",
      },
    });
  });

  it("strips and redacts secret fields", () => {
    const webhook = {
      authentication: {
        type: "basic_auth",
        data: { username: "a/token", password: "secret", token: "x" },
      },
    };
    const stripped = stripWebhookSecrets(webhook);
    expect(stripped.authentication.data.password).toBeUndefined();
    expect(stripped.authentication.data.token).toBeUndefined();

    const redacted = redactSecrets({
      password: "secret",
      nested: { token: "abc", keep: "ok" },
    });
    expect(redacted.password).toBe("[REDACTED]");
    expect(redacted.nested.token).toBe("[REDACTED]");
    expect(redacted.nested.keep).toBe("ok");
  });
});

