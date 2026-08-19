import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { applyTheme } from "./theme.js";
import "./theme.css";

applyTheme();

const container = document.getElementById("root");
if (!container) {
  throw new Error("main: #root element not found in index.html");
}
createRoot(container).render(<App />);
