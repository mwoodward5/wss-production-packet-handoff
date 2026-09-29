"use strict";

class RouterError extends Error {
  constructor(code, statusCode, message) {
    super(message || code);
    this.name = "RouterError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function badRequest(code = "bad_request") {
  return new RouterError(code, 400, code);
}

function notFound(code = "not_found") {
  return new RouterError(code, 404, code);
}

function unauthorized(code = "unauthorized") {
  return new RouterError(code, 401, code);
}

function unavailable(code = "router_unavailable") {
  return new RouterError(code, 503, code);
}

module.exports = { RouterError, badRequest, notFound, unauthorized, unavailable };
