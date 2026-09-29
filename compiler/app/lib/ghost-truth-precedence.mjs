function hasFactValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return String(value ?? "").trim().length > 0;
}

export function isOwnerLockedIdentityField(truth = {}, field = "") {
  const lockedFields = [truth.owner_locked_fields, truth.ownerLockedFields, truth.owner_locks, truth.ownerLocks];
  return lockedFields.some((locks) => Array.isArray(locks) && locks.includes(field))
    || lockedFields.some((locks) => locks && typeof locks === "object" && locks[field] === true)
    || truth.identity?.[field]?.owner_locked === true
    || truth.identity?.[field]?.locked_by_owner === true;
}

function isVerifiedIdentityFact(identityFact) {
  return identityFact?.verified === true
    || identityFact?.owner_verified === true
    || /^(?:owner|gbp|google-business-profile|business-site)$/i.test(String(identityFact?.source || ""));
}

export function resolveGhostInputHint({
  field,
  prospectValue,
  priorCompiledValue,
  truth = {},
  fallback = "",
}) {
  const identityFact = truth.identity?.[field];
  if (isOwnerLockedIdentityField(truth, field) && hasFactValue(identityFact?.value)) return identityFact.value;
  if (hasFactValue(prospectValue)) return prospectValue;
  // An unverified identity value can be stale donor data. It must never seed
  // Firecrawl/Intake discovery ahead of an already compiled source fact.
  if (isVerifiedIdentityFact(identityFact) && hasFactValue(identityFact?.value)) return identityFact.value;
  if (hasFactValue(priorCompiledValue)) return priorCompiledValue;
  return fallback;
}

export function resolveGhostTruthFact({
  field,
  compiledValue,
  truth = {},
  fallback = "",
}) {
  const identityFact = truth.identity?.[field];
  if (isOwnerLockedIdentityField(truth, field) && hasFactValue(identityFact?.value)) return identityFact.value;
  if (hasFactValue(compiledValue)) return compiledValue;
  if (isVerifiedIdentityFact(identityFact) && hasFactValue(identityFact?.value)) return identityFact.value;
  return fallback;
}
