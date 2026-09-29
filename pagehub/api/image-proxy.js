module.exports.config = {
  maxDuration: 20
};

const { requireProviderRouteAuth } = require("./lib/provider-route-auth");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Use GET.");
  }

  if (!requireProviderRouteAuth(req, res)) return;

  try {
    const rawUrl = req.query?.url || new URL(req.url, "http://localhost").searchParams.get("url");
    const target = new URL(String(rawUrl || ""));

    if (!["http:", "https:"].includes(target.protocol) || isBlockedHost(target.hostname)) {
      return res.status(400).send("Unsupported image URL.");
    }

    const upstream = await fetch(target.href, {
      headers: {
        "User-Agent": "Woodward Intake Studio/1.0",
        "Accept": "image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*,*/*;q=0.8"
      }
    });

    if (!upstream.ok) {
      return res.status(upstream.status).send("Image could not be loaded.");
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    if (!/^image\//i.test(contentType)) {
      return res.status(415).send("URL did not return an image.");
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800");
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).send(buffer);
  } catch {
    return res.status(400).send("Invalid image URL.");
  }
};

function isBlockedHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost" ||
    host.endsWith(".local") ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
}
