import { Scroll, signal, Text, View } from "nsh";
import { Button } from "nsh/base";
import type { JSX } from "nsh/jsx-runtime";

export function Drawer(props: {
  title: string;
  label: string;
  count: number;
  onToggle?: () => void;
  renderAction?: () => JSX.Element;
  renderRows: () => JSX.Element;
}) {
  const expanded = signal(false);

  return (
    <If when={props.count > 0}>
      <View class="shrink-0 border-t border-border">
        <View class="h-5 flex-row">
          <Button
            class="min-w-0 flex-1 justify-center px-2 hover:bg-muted"
            accessibilityLabel={`${expanded() ? "Collapse" : "Expand"} ${props.label} (${props.count})`}
            onPress={() => { props.onToggle?.(); expanded.set(!expanded()); }}
          >
            <Text class="text-xs text-muted-foreground">{props.title} · {props.count}</Text>
          </Button>
          <If when={props.renderAction !== undefined}>
            <View class="justify-center pr-2">{props.renderAction?.()}</View>
          </If>
        </View>
        <If when={expanded()}>
          <Scroll style={{ maxHeight: 80 }}>{props.renderRows()}</Scroll>
        </If>
      </View>
    </If>
  );
}
