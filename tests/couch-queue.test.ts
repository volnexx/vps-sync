import { describe, expect, it } from "vitest";
import { CouchClient } from "../src/couch";

describe("CouchClient request queue", () => {
  it("never runs two native requests concurrently", async () => {
    let active = 0;
    let maximum = 0;
    const requester = async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { status: 200, json: { db_name: "test", update_seq: 1 }, text: "" };
    };
    const client = new CouchClient("https://example.org", "test", "user", "password", requester);
    await Promise.all([client.info(), client.info(), client.info()]);
    expect(maximum).toBe(1);
  });

  it("retries a temporary native failure", async () => {
    let calls = 0;
    const requester = async () => {
      calls += 1;
      if (calls < 3) throw new Error("temporary network failure");
      return { status: 200, json: { db_name: "test", update_seq: 1 }, text: "" };
    };
    const client = new CouchClient("https://example.org", "test", "user", "password", requester);
    await expect(client.info()).resolves.toMatchObject({ db_name: "test" });
    expect(calls).toBe(3);
  });
});
