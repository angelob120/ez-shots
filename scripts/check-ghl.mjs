import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
process.env.GHL_LOCATION_ID = "location-test";
process.env.GHL_PRIVATE_TOKEN = "token-test";
process.env.GHL_BOOKED_TAG = "ezshots-booked";

const ghl = require("../server/ghl");
const calls = [];
const fakeFetch = async (url, options) => {
  calls.push({ url, options, body: JSON.parse(options.body) });
  if (url.endsWith("/contacts/upsert")) {
    return new Response(JSON.stringify({ contact: { id: "contact-123" }, new: false }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ tags: ["existing", "ezshots-booked"] }), {
    status: 201, headers: { "content-type": "application/json" },
  });
};

const result = await ghl.sync({
  id: "EZ-1", name: "Test Booker", email: "test@example.com",
  phone: "3135550100", address: "1 Test Ave",
}, fakeFetch);

assert.deepEqual(result, { contactId: "contact-123", tag: "ezshots-booked" });
assert.equal(calls.length, 2);
assert.equal(calls[0].url, "https://services.leadconnectorhq.com/contacts/upsert");
assert.equal(calls[0].body.locationId, "location-test");
assert.equal(calls[0].body.createNewIfDuplicateAllowed, false);
assert.equal("tags" in calls[0].body, false, "upsert must not overwrite existing tags");
assert.equal("dnd" in calls[0].body, false, "sync must not modify opt-out state");
assert.equal("dndSettings" in calls[0].body, false, "sync must not modify channel opt-outs");
assert.equal(calls[1].url, "https://services.leadconnectorhq.com/contacts/contact-123/tags");
assert.deepEqual(calls[1].body, { tags: ["ezshots-booked"] });
assert.equal(calls[0].options.headers.Authorization, "Bearer token-test");
assert.equal(calls[0].options.headers.Version, "v3");

console.log("HighLevel booking sync check passed");
