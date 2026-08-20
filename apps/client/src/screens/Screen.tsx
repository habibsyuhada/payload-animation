import { useEffect, type ReactNode } from "react";
import { useAppShellStore } from "../state/appShellStore.js";

export interface ScreenProps {
  readonly title: string;
  readonly children: ReactNode;
  /** Skips the <h1> heading and the default reading-width/line-height body treatment, and makes
   * the body a height:100% flex column instead — for a screen that's a full-viewport editor
   * (canvas + floating toolbar/HUD) rather than a document of stacked text sections. */
  readonly fullBleed?: boolean;
}

/** Shared shell for every screen: registers its title with appShellStore (drives the header) and renders a consistent heading + body layout. Screens themselves stay empty placeholders until C3.2-C3.4 build their real content. */
export function Screen({ title, children, fullBleed = false }: ScreenProps): JSX.Element {
  const setActiveScreenTitle = useAppShellStore((state) => state.setActiveScreenTitle);

  useEffect(() => {
    setActiveScreenTitle(title);
  }, [title, setActiveScreenTitle]);

  return (
    <section className={fullBleed ? "payload-screen payload-screen--full-bleed" : "payload-screen"} data-testid={`screen-${title}`}>
      {!fullBleed && <h1>{title}</h1>}
      <div className={fullBleed ? "payload-screen-body payload-screen-body--full-bleed" : "payload-screen-body"}>{children}</div>
    </section>
  );
}
