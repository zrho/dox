import { colorScheme, Image } from "nsh";
import { Button } from "nsh/base";

const paths = {
  note: "M5 3h9l5 5v13H5z M14 3v5h5 M8 12h8 M8 16h8",
  reference: "M4 5h5q2 0 3 2 1-2 3-2h5v13h-5q-2 0-3 2-1-2-3-2H4z M12 7v13",
  add: "M12 5v14 M5 12h14",
  delete: "M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7",
  edit: "M4 16 16 4l4 4L8 20H4z M13 7l4 4",
  view: "M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z M15 12a3 3 0 1 0-6 0 3 3 0 1 0 6 0",
  close: "M6 6l12 12 M18 6 6 18",
  sync: "M19 8a8 8 0 0 0-14-2L3 9 M3 4v5h5 M5 16a8 8 0 0 0 14 2l2-3 M21 20v-5h-5",
  synced: "m5 12 4 4L19 6",
  pending: "M12 20V4 M6 10l6-6 6 6",
  syncError: "M12 3 2 21h20z M12 9v5 M12 17v.2",
  noUpstream: "M6 12h12",
  pause: "M8 5v14 M16 5v14",
} as const;

type IconName = keyof typeof paths;
export type ItemIcon = "note" | "reference";

function source(name: IconName, color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="${paths[name]}" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function Icon(props: { name: IconName; size?: number }) {
  return <Image src={source(props.name, colorScheme() === "dark" ? "#aeb5c1" : "#596373")}
    style={{ width: props.size ?? 15, height: props.size ?? 15, flexShrink: 0 }} accessible={false} />;
}

export function IconButton(props: { icon: IconName; label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Button class="shrink-0 items-center justify-center rounded hover:bg-muted disabled:opacity-50"
      style={{ width: 22, height: 20 }} accessibilityLabel={props.label} tooltip={props.label}
      disabled={props.disabled} onPress={props.onPress}>
      <Icon name={props.icon} />
    </Button>
  );
}
