/** IF Scanned — Condition: gates the immediately-following block while the "scanned" status (from a Scanner node) is active. */
export function evaluateIfScanned(scannedUntilTick: number | null, currentTick: number): boolean {
  return scannedUntilTick !== null && currentTick < scannedUntilTick;
}
