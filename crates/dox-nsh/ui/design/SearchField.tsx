import { Input, type InputProps } from "nsh/base";

type SearchFieldProps = Pick<InputProps,
  "accessibilityLabel" | "placeholder" | "readonly" | "value" | "onChange" | "onCompositionChange" | "onSubmit"
> & { stretch?: boolean };

export function SearchField(props: SearchFieldProps) {
  return (
    <Input
      autoFocus
      autoCapitalize="none"
      autoCorrect={false}
      class={`rounded-md bg-muted px-2 py-2 text-sm text-foreground${props.stretch ? " min-w-0 flex-1" : ""}`}
      accessibilityLabel={props.accessibilityLabel}
      placeholder={props.placeholder}
      readonly={props.readonly}
      value={props.value}
      onChange={props.onChange}
      onCompositionChange={props.onCompositionChange}
      submitBehavior="submit"
      onSubmit={props.onSubmit}
    />
  );
}
