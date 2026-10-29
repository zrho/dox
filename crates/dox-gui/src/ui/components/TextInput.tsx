import { splitProps, type JSX } from 'solid-js';

export default function TextInput(props: JSX.InputHTMLAttributes<HTMLInputElement>) {
  const [local, rest] = splitProps(props, ['class']);
  return <input type="text" {...rest} class={`ui-input ${local.class ?? ''}`}/>;
}
