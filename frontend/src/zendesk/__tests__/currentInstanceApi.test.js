import { describe, expect, it, vi } from "vitest";

import { classifyApiError, createCurrentInstanceApi } from "../currentInstanceApi";

describe("current instance API", () => {
  it("uses relative Zendesk API paths and follows pagination", async () => {
    const request = vi.fn(async ({ url }) => {
      expect(url.startsWith("/api/v2/")).toBe(true);
      if (url === "/api/v2/groups.json") {
        return {
          responseJSON: {
            groups: [{ id: 1, name: "Support" }],
            next_page: "https://example.zendesk.com/api/v2/groups.json?page=2",
          },
        };
      }
      return {
        responseJSON: {
          groups: [{ id: 2, name: "Billing" }],
          next_page: null,
        },
      };
    });

    const api = createCurrentInstanceApi({ client: { request } });
    const groups = await api.fetchAll("/api/v2/groups.json", "groups");

    expect(groups.map((group) => group.name)).toEqual(["Support", "Billing"]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("blocks full-domain API paths", async () => {
    const api = createCurrentInstanceApi({ client: { request: vi.fn() } });

    await expect(api.request({ path: "https://example.zendesk.com/api/v2/groups.json" })).rejects.toThrow(
      "must be relative",
    );
  });

  it("classifies unsupported APIs from client app context", () => {
    const classified = classifyApiError({ status: 404, message: "not found" }, "/api/v2/queues");

    expect(classified.code).toBe("unsupported_from_client_app");
    expect(classified.message).toContain("/api/v2/queues");
  });
});
