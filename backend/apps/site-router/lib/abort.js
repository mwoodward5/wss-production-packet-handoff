"use strict";

function requestAbortScope(req, res) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const abortOnEarlyClose = () => {
    if (!res.writableEnded) abort();
  };

  if (req && typeof req.once === "function") req.once("aborted", abort);
  if (res && typeof res.once === "function") res.once("close", abortOnEarlyClose);

  return {
    signal: controller.signal,
    cleanup() {
      if (req && typeof req.off === "function") req.off("aborted", abort);
      if (res && typeof res.off === "function") res.off("close", abortOnEarlyClose);
    }
  };
}

module.exports = { requestAbortScope };
