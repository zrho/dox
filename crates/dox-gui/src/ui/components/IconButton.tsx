import { createSignal, splitProps } from 'solid-js';
import Button, { type ButtonProps } from './Button';
import Tooltip from './Tooltip';

export type IconButtonProps = Omit<ButtonProps, 'size' | 'title' | 'aria-label'> & {
  label: string;
  tooltip?: string;
};

/** Named icon action with a component tooltip, including while disabled. */
export default function IconButton(props: IconButtonProps) {
  const [local, rest] = splitProps(props, ['label', 'tooltip', 'children']);
  const [hovered, setHovered] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  let button: HTMLButtonElement | undefined;
  return <span class="ui-icon-button-anchor"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusIn={() => setFocused(true)} onFocusOut={() => setFocused(false)}>
    <Button {...rest} ref={button} size="icon" aria-label={local.label}>{local.children}</Button>
    <Tooltip anchor={hovered() || focused() ? button : undefined} text={local.tooltip ?? local.label}/>
  </span>;
}
