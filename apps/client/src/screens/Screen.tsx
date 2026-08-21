import { useEffect, type ReactNode } from "react";
import { useAppShellStore } from "../state/appShellStore.js";

export interface ScreenProps {
  readonly title: string;
  readonly children: ReactNode;
  /** Skips the default reading-width/line-height body treatment and makes the body a height:100%
   * flex column instead — for a screen that's a full-viewport editor (canvas + floating
   * toolbar/HUD) rather than a document of stacked text sections. */
  readonly fullBleed?: boolean;
}

/**
 * Shared shell for every screen: registers its title with appShellStore, which is what the app
 * bar renders. The bar is the page heading, so nothing here draws a second one — see App.tsx.
 */
export function Screen({ title, children, fullBleed = false }: ScreenProps): JSX.Element {
  const setActiveScreenTitle = useAppShellStore((state) => state.setActiveScreenTitle);

  useEffect(() => {
    setActiveScreenTitle(title);
  }, [title, setActiveScreenTitle]);

  return (
    <section className={fullBleed ? "payload-screen payload-screen--full-bleed" : "payload-screen"} data-testid={`screen-${title}`}>
      <div className={fullBleed ? "payload-screen-body payload-screen-body--full-bleed" : "payload-screen-body"}>{children}</div>
    </section>
  );
}
