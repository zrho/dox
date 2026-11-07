import { render } from "solid-js/web";
import { onCleanup } from "solid-js";
import App from "./App";
import { initializeTheme } from "./utils/theme";
import "./style.css";
const cleanupTheme = initializeTheme();
render(() => {
  onCleanup(cleanupTheme);
  return <App />;
}, document.getElementById("root")!);
