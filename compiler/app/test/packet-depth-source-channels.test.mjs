import test from "node:test";
import assert from "node:assert/strict";
import { extractSourceDepthChannels, extractSourceServiceObservations, mergeSourceResults } from "../lib/source-intake.mjs";

test("service prose stays on its own page and editorial headings are refused", () => {
  const observations = extractSourceServiceObservations([
    { url: "https://example.com/services/patios", markdown: "## Concrete Patios\nWe install concrete patios for outdoor living spaces.\n\n## Contact Us\nCall today." },
    { url: "https://example.com/blog/18-pro-lawn-and-landscape-tips", markdown: "## Landscape Lighting\nInstall landscape lighting around your home for safer paths." },
  ]);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].source_url, "https://example.com/services/patios");
  assert.equal(observations[0].description, "We install concrete patios for outdoor living spaces.");
  assert.equal(observations[0].excerpt, "## Concrete Patios\nWe install concrete patios for outdoor living spaces.");
});

test("service description skips media and buttons but never crosses a section", () => {
  const rows = extractSourceServiceObservations([{ url: "https://example.com/bathroom-remodeling", markdown: [
    "## Bathroom Renovation Services", "", "![Bathroom](https://example.com/photo.jpg)", "[Get a Quote](/contact)",
    "", "We renovate bathrooms with custom layouts and finishes.", "## Kitchen Renovation Services",
    "![Kitchen](https://example.com/kitchen.jpg)", "[Contact Us](/contact)", "## About Us",
    "We renovate kitchens with custom layouts and finishes.",
  ].join("\n") }]);
  assert.equal(rows.find((row) => row.name === "Bathroom Renovation Services")?.description,
    "We renovate bathrooms with custom layouts and finishes.");
  assert.equal(rows.find((row) => row.name === "Kitchen Renovation Services")?.description, "");
});

test("extracts only explicit depth copy with exact page evidence", () => {
  const source = "https://example.com/about";
  const markdown = [
    "# Example Landscaping",
    "## Hours",
    "- Monday: 8:00 am - 5:00 pm",
    "## Frequently Asked Questions",
    "Do you offer maintenance?",
    "Yes, we offer weekly lawn maintenance.",
    "## Service Areas",
    "- Salem, Oregon",
    "## Testimonials",
    "> They arrived on time and transformed our yard.",
    "— Casey Smith",
  ].join("\n");
  const result = extractSourceDepthChannels([{ url: source, markdown }]);
  assert.equal(result.hours[0].evidence, "- Monday: 8:00 am - 5:00 pm");
  assert.equal(result.faqs[0].evidence, "Do you offer maintenance?\nYes, we offer weekly lawn maintenance.");
  assert.equal(result.areas[0].value, "Salem, Oregon");
  assert.equal(result.reviews[0].author, "Casey Smith");
  for (const entries of Object.values(result)) for (const entry of entries) assert.equal(entry.source_url, source);
});

test("omits unavailable or ambiguous channels and merges distinct evidence", () => {
  assert.deepEqual(extractSourceDepthChannels([{ url: "https://example.com", markdown: "Great reviews! Open daily. We serve everywhere." }]), {});
  const entry = { value: "- Monday: 8:00 am - 5:00 pm", source_url: "https://example.com", evidence: "- Monday: 8:00 am - 5:00 pm" };
  const base = { found: { depth_channels: { hours: [entry] } }, assets: [], summary: {} };
  const merged = mergeSourceResults(base, [{ found: { depth_channels: { hours: [entry] } }, assets: [], summary: {} }]);
  assert.equal(merged.found.depth_channels.hours.length, 1);
  assert.equal(merged.found.depth_channels.reviews, undefined);
});

test("direct HTML fallback retains only explicit section evidence", () => {
  const result = extractSourceDepthChannels([{ url: "https://example.com", markdown: "", html: [
    "<h2>Hours</h2><p>Monday: 9 am - 5 pm</p>",
    "<h2>Frequently Asked Questions</h2><p>Do you offer lawn care?</p><p>Yes, weekly lawn care is available.</p>",
    "<h2>Service Areas</h2><ul><li>Salem, Oregon</li></ul>",
  ].join("") }]);
  assert.equal(result.hours.length, 1);
  assert.equal(result.faqs.length, 1);
  assert.equal(result.areas.length, 1);
  assert.equal(result.reviews, undefined);
});
