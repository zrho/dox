import { splitProps, type JSX } from 'solid-js';

export type ButtonProps = Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  variant?: 'default' | 'ghost' | 'danger';
  size?: 'default' | 'small' | 'icon';
  selected?: boolean;
  /** Block repeat actions without dimming the control during brief work. */
  busy?: boolean;
  onClick?: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
};

export default function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ['variant', 'size', 'selected', 'busy', 'class', 'classList', 'onClick']);
  return <button type="button" {...rest}
    class={`ui-button ui-button-${local.variant ?? 'default'} ui-button-size-${local.size ?? 'default'} ${local.class ?? ''}`}
    classList={{ ...local.classList, selected: local.selected ?? local.classList?.selected }}
    aria-disabled={local.busy || rest.disabled || rest['aria-disabled']}
    onClick={event => { if (!local.busy && !rest.disabled) local.onClick?.(event); }}
  />;
}
