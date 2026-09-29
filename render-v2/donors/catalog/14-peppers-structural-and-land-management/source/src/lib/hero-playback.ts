export function heroPlaybackAllowed(reducedMotion:boolean, connection:{saveData?:boolean;effectiveType?:string}={}) {
  return !reducedMotion && !connection.saveData && !['2g','slow-2g','3g'].includes(connection.effectiveType || '');
}
