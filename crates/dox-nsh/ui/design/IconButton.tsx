import { Button } from "nsh/base";
import { Icon } from "./Icon";

type IconName = Parameters<typeof Icon>[0]["name"];

export function IconButton(props: { icon: IconName; label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Button class="shrink-0 items-center justify-center rounded hover:bg-muted disabled:opacity-50"
      style={{ width: 22, height: 20 }} accessibilityLabel={props.label} tooltip={props.label}
      disabled={props.disabled} onPress={props.onPress}>
      <Icon name={props.icon} />
    </Button>
  );
}
