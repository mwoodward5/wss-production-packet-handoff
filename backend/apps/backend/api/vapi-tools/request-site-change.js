"use strict";
// api/vapi-tools/request-site-change.js — the ONE tool.
//
// The owner's insight, which drives this whole design: "maybe there's a
// universal way of entering into that so we don't have to build tools for
// every little thing." So Riley does not get change_color, resize_logo,
// add_page, update_hours. He gets one verb that carries INTENT:
//
//   request_site_change({ client_ref, instruction, confirm_code })
//
// `instruction` is the customer's own words. The backend resolves who is
// calling, reads the business name and domain back for confirmation, plans the
// change against that client's own archived source, applies it, redeploys and
// reports one sentence Riley can say out loud. A request nobody anticipated
// still arrives as text, so it generalises without shipping a new tool.
//
// This is deliberately a THIN ALIAS over api/vapi-tools/site-edit.js rather
// than a second implementation. The confirm-before-apply token, the caller
// collision guard and the deploy-target scope check all live there and are
// already proven; a parallel copy of that logic is exactly how one of the two
// front doors ends up missing a gate. Both names hit the same handler.
module.exports = require("./site-edit.js");
