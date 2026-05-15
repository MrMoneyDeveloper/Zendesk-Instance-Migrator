import { describe, expect, it } from "vitest";

import { extractWebhookPath, isZendeskWebhookEndpoint, rewriteZendeskWebhookEndpoint } from "../webhookEndpointRewrite";

describe("webhookEndpointRewrite", () => {
  it("rewrites zendesk endpoint host and preserves path/query", () => {
    const sourceEndpoint = "https://source-subdomain.zendesk.com/api/v2/tickets/{{ticket.id}}.json?x=1";
    expect(isZendeskWebhookEndpoint(sourceEndpoint)).toBe(true);
    expect(extractWebhookPath(sourceEndpoint)).toBe("/api/v2/tickets/{{ticket.id}}.json?x=1");

    const rewritten = rewriteZendeskWebhookEndpoint({
      sourceEndpoint,
      targetSubdomain: "target-subdomain",
    });
    expect(rewritten.endpoint).toBe("https://target-subdomain.zendesk.com/api/v2/tickets/{{ticket.id}}.json?x=1");
    expect(rewritten.rewritten).toBe(true);
    expect(rewritten.warning).toBe("");
  });

  it("keeps non-zendesk endpoint and returns warning", () => {
    const sourceEndpoint = "https://example.com/hook";
    const rewritten = rewriteZendeskWebhookEndpoint({
      sourceEndpoint,
      targetSubdomain: "target-subdomain",
    });
    expect(rewritten.endpoint).toBe(sourceEndpoint);
    expect(rewritten.rewritten).toBe(false);
    expect(rewritten.warning).toContain("does not appear to be a Zendesk URL");
  });
});

