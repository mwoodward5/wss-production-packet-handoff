"use strict";

// lib/wss-connect-assets — everything the outreach email's WSS Connect
// closing block needs: the funnel graphic (markup + renderer + served URL)
// and a real, provisioned magic link into wss-ai.com/dashboard per prospect.

const funnel = require("./funnel-html");
const magicLink = require("./magic-link");
const { OUT_PATH, renderConnectFunnel } = require("./render-funnel");

module.exports = {
  ...funnel,
  ...magicLink,
  CONNECT_FUNNEL_FILE: OUT_PATH,
  renderConnectFunnel,
};
