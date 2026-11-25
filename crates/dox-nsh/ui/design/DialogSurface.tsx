import { Dialog, type DialogProps } from "nsh/base";

type DialogSurfaceProps = Pick<DialogProps,
  "open" | "accessibilityLabel" | "accessibilityDescription" | "children" |
  "closeOnEscape" | "closeOnBackdropPress" | "closeOnSwipe" | "onCancel" | "onOpenChange"
>;

/** Presents above the workspace, including its native web view. */
export function DialogSurface(props: DialogSurfaceProps) {
  return (
    <Dialog
      open={props.open}
      animation="none"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityDescription={props.accessibilityDescription}
      backdropStyle={{ backgroundColor: "#00000033" }}
      closeOnEscape={props.closeOnEscape}
      closeOnBackdropPress={props.closeOnBackdropPress}
      closeOnSwipe={props.closeOnSwipe}
      onCancel={props.onCancel}
      onOpenChange={props.onOpenChange}
      class="rounded-lg border border-border bg-popover"
      style={{ alignSelf: "center", top: "14%", width: "92%", maxWidth: 560, boxShadow: "0 16px 48px #00000040" }}
    >
      {props.children}
    </Dialog>
  );
}
