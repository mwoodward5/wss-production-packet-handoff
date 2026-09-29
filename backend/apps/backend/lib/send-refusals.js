"use strict";

/**
 * WHY A SEND WAS REFUSED, IN THE OWNER'S WORDS.
 *
 * The send path answers with codes: no_before_after_visuals,
 * before_image_capture_source_unrecorded, contact_confidence_review_hold. Those
 * are the right thing for a log and the wrong thing for a screen — /campaigns
 * shipped a run that printed "no_before_after_visuals" at the owner, which is
 * exactly the coder-speak these operator pages exist to remove.
 *
 * This lives in one module because two surfaces now report the same refusals
 * (the campaigns run log and the gallery's send panel) and two copies of a
 * translation table drift into two different answers for one code.
 *
 * MEASURED ON PRODUCTION, 2026-08-11, dry-running all 80 built mirrors:
 *
 *     before_image_capture_source_unrecorded   57
 *     no_before_after_visuals                   7
 *     contact_confidence_review_hold            5
 *     would send                               11
 *
 * So these sentences are not decoration. They are what the operator reads on
 * 69 of his 80 sites, and the difference between "the machine said no" and
 * knowing that the before-pictures need re-taking.
 *
 * An unknown code passes through RAW. A raw truth beats a wrong translation.
 */
const PLAIN_REFUSAL = Object.freeze({
  no_before_after_visuals:
    "the before-and-after pictures for the email were never taken, so there was nothing to show",
  before_image_capture_source_unrecorded:
    "we cannot prove the before-picture is of their own site, because nothing recorded where it was taken — it needs re-shooting",
  before_image_domain_mismatch:
    "the before-picture was taken on a different company's website, so it was refused rather than captioned as theirs",
  contact_confidence_review_hold:
    "this lead is held for a human to look at before anything goes out",
  owner_address_unset:
    "your own email address is not set on the server, so there was nowhere to send it",
  owner_address_unset_live_copy_required:
    "your own email address is not set on the server, so your copy could not be guaranteed",
  owner_only_assertion_failed:
    "the safety check that keeps every email in your own inbox failed, so nothing went out",
  owner_proof_recipient_gate_failed:
    "the safety check that keeps every email in your own inbox failed, so nothing went out",
  prospect_sends_disabled:
    "live sending is switched off on the server",
  suppressed:
    "this address asked not to be emailed, so nothing was sent",
  suppression_check_unavailable:
    "the do-not-email list could not be checked, so to be safe nothing was sent",
  no_completed_mirror:
    "there is no finished build for this one to show, so it needs mirroring first",
  preview_host_not_approved:
    "the site address on file is not one of ours, so it was refused",
  owner_email_unconfigured:
    "your own email address is not set on the server, so nothing can be sent",
  send_refused:
    "the server refused to send this one",
});

/** The sentence for a code, or "" when we have none. */
function plainRefusal(code) {
  return PLAIN_REFUSAL[String(code == null ? "" : code).trim()] || "";
}

module.exports = { PLAIN_REFUSAL, plainRefusal };
