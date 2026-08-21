import { test } from "node:test";
import assert from "node:assert/strict";
import { outboundLinkKindFor, relFor, destinationDomainOf } from "./affiliate.ts";

test("outboundLinkKindFor: affiliate_status 'affiliate' maps to kind 'affiliate'", () => {
  assert.equal(outboundLinkKindFor("affiliate"), "affiliate");
});

test("outboundLinkKindFor: 'pending' never renders as an active affiliate link", () => {
  assert.equal(outboundLinkKindFor("pending"), "outbound");
});

test("outboundLinkKindFor: 'non_affiliate' maps to kind 'outbound'", () => {
  assert.equal(outboundLinkKindFor("non_affiliate"), "outbound");
});

test("relFor: affiliate links are marked sponsored", () => {
  assert.equal(relFor("affiliate"), "nofollow sponsored noreferrer");
});

test("relFor: plain outbound links are not marked sponsored", () => {
  assert.equal(relFor("outbound"), "nofollow noreferrer");
});

test("destinationDomainOf: strips protocol, path, and www.", () => {
  assert.equal(destinationDomainOf("https://www.example.com/some/path?x=1"), "example.com");
});

test("destinationDomainOf: an invalid URL yields an empty string, never throws", () => {
  assert.equal(destinationDomainOf("not a url"), "");
});
