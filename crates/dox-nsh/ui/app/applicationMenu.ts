import { Menu } from "nsh/desktop";

export function installApplicationMenu(newWindow: () => void) {
  Menu.setApplicationMenu([
    { label: "Dox", submenu: [
      { role: "about", label: "About Dox" },
      { type: "separator" },
      { role: "hide", label: "Hide Dox" },
      { role: "hideOthers" },
      { role: "showAll" },
      { type: "separator" },
      { role: "quit", label: "Quit Dox" },
    ] },
    { label: "File", submenu: [{ label: "New Window", onSelect: newWindow }] },
    { label: "Edit", submenu: [
      { role: "undo" }, { role: "redo" }, { type: "separator" },
      { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
    ] },
    { label: "Window", submenu: [
      { role: "minimize" }, { role: "zoom" }, { role: "toggleFullScreen" },
    ] },
  ]);
  return () => Menu.setApplicationMenu(null);
}
