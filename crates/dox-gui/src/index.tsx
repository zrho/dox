import { render } from "solid-js/web";
import { onCleanup } from "solid-js";
import App from "./App";
import { initializeTheme, showThemedWindow } from "./utils/theme";
import "./style.css";
const cleanupTheme = initializeTheme();
render(() => {
  onCleanup(cleanupTheme);
  return <App />;
}, document.getElementById("root")!);
void showThemedWindow().catch((error) => console.error("Unable to show the window", error));
