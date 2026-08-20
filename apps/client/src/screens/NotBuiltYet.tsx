import type { ReactNode } from "react";

/**
 * The shared card for a screen whose feature does not exist yet.
 *
 * Four of the seven screens are still empty, and until now each one said so in a bare paragraph
 * that read like a rendering failure. A screen that is honestly unfinished should still look
 * *deliberate*: what it will be, and the one thing it is waiting on. `blockedBy` is the more
 * useful half — "needs a server" and "needs the economy first" are different kinds of empty, and
 * only one of them is worth asking about.
 */
export function NotBuiltYet({ children, blockedBy, reference }: { children: ReactNode; blockedBy: string; reference: string }): JSX.Element {
  return (
    <div className="payload-card payload-soon" data-testid="not-built-yet">
      <span className="payload-soon-tag">Belum dibangun</span>
      <p>{children}</p>
      <p className="payload-card-note payload-card-note--divided">
        Menunggu: {blockedBy} · {reference}
      </p>
    </div>
  );
}
