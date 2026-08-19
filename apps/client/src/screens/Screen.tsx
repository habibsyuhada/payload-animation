import { useEffect, type ReactNode } from "react";
import { useAppShellStore } from "../state/appShellStore.js";

export interface ScreenProps {
  readonly title: string;
  readonly children: ReactNode;
}

/** Shared shell for every screen: registers its title with appShellStore (drives the header) and renders a consistent heading + body layout. Screens themselves stay empty placeholders until C3.2-C3.4 build their real content. */
export function Screen({ title, children }: ScreenProps): JSX.Element {
  const setActiveScreenTitle = useAppShellStore((state) => state.setActiveScreenTitle);

  useEffect(() => {
    setActiveScreenTitle(title);
  }, [title, setActiveScreenTitle]);

  return (
    <section className="payload-screen" data-testid={`screen-${title}`}>
      <h1>{title}</h1>
      <div className="payload-screen-body">{children}</div>
    </section>
  );
}
