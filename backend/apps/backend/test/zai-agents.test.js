"use strict";

// test/zai-agents.test.js — pins the Z.ai agent lane's contracts without the
// network: SSE harvesting (real payload shapes), the honest-failure paths, the
// mission poll law (5s cadence, 300s ceiling), and both transports.
//
// Run: node --test test/zai-agents.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const zai = require("../lib/zai-agents.js");

function sse(events) {
  return events.map((e) => `data: ${JSON.stringify(e)}`).join("\n\n") + "\n\n";
}

function jsonResponse(body, init = {}) {
  return {
    ok: (init.status || 200) >= 200 && (init.status || 200) < 300,
    status: init.status || 200,
    headers: new Map([["content-length", String(body.length)]]),
    text: async () => body,
  };
}

test("poster lane: SSE submit is harvested to image URLs and an answer", async () => {
  const stream = sse([
    { id: "req-1", agent_id: "slides_glm_agent", choices: [{ index: 0, messages: [{ role: "assistant", content: { type: "text", text: "The user" }, phase: "thinking" }] }] },
    { id: "req-1", agent_id: "slides_glm_agent", choices: [{ index: 0, messages: [{ role: "assistant", content: [{ type: "object", object: { tool_name: "search_images", output: "[{\"image_url\":\"https://mfile.z.ai/a.jpg\"},{\"image_url\":\"https://mfile.z.ai/b.jpg\"}]" } }], phase: "tool" }] }] },
    { id: "req-1", agent_id: "slides_glm_agent", conversation_id: "conv-9", choices: [{ index: 0, messages: [{ role: "assistant", content: { type: "text", text: "Your poster is ready." }, phase: "answer" }] }] },
  ]);
  const calls = [];
  const result = await zai.generatePoster({
    businessName: "MR A/C of Orlando",
    services: ["AC repair", "maintenance"],
    phone: "(407) 555-0199",
    colors: ["cool blue", "white"],
    env: { ZAI_AGENTS_KEY: "k", ZAI_AGENTS_POLL_MS: "1", ZAI_AGENTS_TIMEOUT_MS: "1000" },
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return jsonResponse(stream);
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.posterImages.length, 2);
  assert.ok(result.posterImages.includes("https://mfile.z.ai/a.jpg"));
  assert.equal(result.answer, "Your poster is ready.");
  assert.equal(result.conversationId, "conv-9");
  assert.equal(result.tools[0], "search_images");
  // content is an ARRAY of typed objects — the format the first live probe got wrong.
  assert.deepEqual(calls[0].body.messages[0].content, [
    { type: "text", text: calls[0].body.messages[0].content[0].text },
  ]);
  assert.match(calls[0].body.messages[0].content[0].text, /MR A\/C of Orlando/);
  assert.match(calls[0].body.messages[0].content[0].text, /\(407\) 555-0199/);
  assert.equal(calls[0].body.stream, false);
});

test("poster lane: thinking text never joins the answer", () => {
  const h = zai.harvest(zai.parseSseEvents(sse([
    { choices: [{ messages: [{ role: "assistant", content: { type: "text", text: "secret plan" }, phase: "thinking" }] }] },
    { choices: [{ messages: [{ role: "assistant", content: { type: "text", text: "DONE." }, phase: "answer" }] }] },
  ])));
  assert.equal(h.answer, "DONE.");
});

test("poster lane: finished with zero URLs is an honest failure", async () => {
  const result = await zai.generatePoster({
    businessName: "Empty Co",
    env: { ZAI_AGENTS_KEY: "k" },
    fetchImpl: async () => jsonResponse(sse([
      { choices: [{ messages: [{ role: "assistant", content: { type: "text", text: "here you go" }, phase: "answer" }] }] },
    ])),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "no_urls_returned");
});

test("missing key fails closed without a network call", async () => {
  const result = await zai.generatePoster({ businessName: "X", env: {}, fetchImpl: async () => { throw new Error("must not be called"); } });
  assert.equal(result.ok, false);
  assert.equal(result.error, "zai_key_missing");
  assert.equal(result.detail.includes("ZAI_AGENTS_KEY"), true);
});

test("video lane: async ack then poll to the finished mp4", async () => {
  let polls = 0;
  const result = await zai.generateVideo({
    template: "french_kiss",
    imageUrl: "https://mfile.z.ai/a.jpg",
    prompt: "gentle motion",
    env: { ZAI_AGENTS_KEY: "k", ZAI_AGENTS_POLL_MS: "1", ZAI_AGENTS_TIMEOUT_MS: "5000" },
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      if (url.endsWith("/v1/agents")) {
        assert.equal(body.agent_id, "vidu_template_agent");
        assert.equal(body.custom_variables.template, "french_kiss");
        assert.deepEqual(body.messages[0].content[0], { type: "image_url", image_url: "https://mfile.z.ai/a.jpg" });
        return jsonResponse(JSON.stringify({ id: "r1", async_id: "task-77" }));
      }
      polls += 1;
      if (polls === 1) return jsonResponse(JSON.stringify({ status: "pending", agent_id: "vidu_template_agent", async_id: "task-77" }));
      return jsonResponse(JSON.stringify({
        status: "success",
        choices: [{ index: 0, message: [{ role: "assistant", content: [{ type: "video_url", video_url: "https://cdn.example.com/out.mp4" }] }] }],
      }));
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.videoUrl, "https://cdn.example.com/out.mp4");
  assert.equal(result.asyncId, "task-77");
  assert.equal(polls, 2);
});

test("video lane: bad template is refused before any submit", async () => {
  const result = await zai.generateVideo({ template: "matrix_rain", imageUrl: "https://x/y.jpg", env: { ZAI_AGENTS_KEY: "k" }, fetchImpl: async () => { throw new Error("must not be called"); } });
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid_template");
});

test("poll law: terminal failure and timeout are honest", async () => {
  const failed = await zai.pollAgentResult({
    agentId: "vidu_template_agent",
    asyncId: "t1",
    intervalMs: 1,
    timeoutMs: 500,
    env: { ZAI_AGENTS_KEY: "k" },
    fetchImpl: async () => jsonResponse(JSON.stringify({ status: "failed", error: { code: "TASK_NOT_FOUND", message: "gone" } })),
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.error, "agent_failed:TASK_NOT_FOUND");

  let n = 0;
  const timed = await zai.pollAgentResult({
    agentId: "vidu_template_agent",
    asyncId: "t2",
    intervalMs: 1,
    timeoutMs: 60,
    env: { ZAI_AGENTS_KEY: "k" },
    fetchImpl: async () => { n += 1; return jsonResponse(JSON.stringify({ status: "pending" })); },
  });
  assert.equal(timed.ok, false);
  assert.equal(timed.error, "timeout");
  assert.ok(n >= 1);
});

test("http error surfaces status and provider code", async () => {
  const result = await zai.submitAgentTask({
    agentId: "slides_glm_agent",
    messages: [{ role: "user", content: [{ type: "text", text: "x" }] }],
    env: { ZAI_AGENTS_KEY: "k" },
    fetchImpl: async () => jsonResponse(JSON.stringify({ error: { code: "1211", message: "Message content need be array" } }), { status: 400 }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "http_400:1211");
  assert.match(result.detail, /array/);
});
