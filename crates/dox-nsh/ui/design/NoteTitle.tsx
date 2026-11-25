import { Text } from "nsh";
import type { TextStyle } from "nsh/types";

export type TitleSpan = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  mono?: boolean;
  underline?: boolean;
  strike?: boolean;
  small_caps?: boolean;
};

function spanStyle(span: TitleSpan): TextStyle {
  return {
    fontWeight: span.bold ? "bold" : undefined,
    fontStyle: span.italic ? "italic" : undefined,
    fontVariant: span.small_caps ? "small-caps" : undefined,
    textDecorationLine: span.underline
      ? span.strike ? "underline line-through" : "underline"
      : span.strike ? "line-through" : undefined,
  };
}

/** Render title runs in one native paragraph so the whole title clamps together. */
export function NoteTitle(props: { title: string; spans?: readonly TitleSpan[]; class?: string }) {
  return (
    <Text class={props.class}>
      <If when={props.spans?.length} else={props.title}>
        <Each of={props.spans} key="index">
          {(span) => (
            <Text class={span().mono ? "font-mono" : undefined} style={spanStyle(span())}>{span().text}</Text>
          )}
        </Each>
      </If>
    </Text>
  );
}
