import { computed, Text, View } from "nsh";
import { Button, Tooltip } from "nsh/base";
import { Reader } from "dox-nsh/native";
import { Icon } from "../design/Icon";
import type { Session } from "./createSession";

type StatusState = Pick<Session, "path" | "git" | "syncing" | "syncError" | "automatic" | "operation" | "opening" | "refreshing">;

export function StatusBar(props: { state: StatusState; onOpenCommands: () => void }) {
  const { path, git, syncing, syncError, automatic, operation, opening, refreshing } = props.state;
  const gitStatus = computed(() => {
    const gitInfo = git();
    if (!gitInfo) return null;
    const branch = gitInfo.branch ?? "Detached HEAD";
    const status = syncing() ? { icon: "sync", label: "Syncing" } as const
      : syncError() ? { icon: "syncError", label: "Sync needs attention" } as const
      : !gitInfo.upstream ? { icon: "noUpstream", label: "No upstream" } as const
      : gitInfo.changed || gitInfo.ahead || gitInfo.behind ? { icon: "pending", label: "Pending sync" } as const
      : { icon: "synced", label: "Up to date" } as const;
    const counts = [
      `${gitInfo.changed} changed ${gitInfo.changed === 1 ? "file" : "files"}`,
      gitInfo.ahead == null ? null : `${gitInfo.ahead} ahead`,
      gitInfo.behind == null ? null : `${gitInfo.behind} behind`,
    ].filter(Boolean).join(" · ");
    return {
      branch,
      icon: status.icon,
      description: `${branch} · ${status.label} · Automatic sync ${automatic() ? "on" : "off"}`,
      details: [
        `${branch} · ${status.label}`,
        gitInfo.upstream ? `Upstream: ${gitInfo.upstream}` : null,
        counts,
        automatic() ? "Automatic sync on" : gitInfo.upstream
          ? "Automatic sync off · Sync now is still available"
          : "Automatic sync off",
        syncError() || null,
      ].filter(Boolean).join("\n"),
    };
  });
  const home = Reader.homeDirectory().replace(/\/+$/, "");
  const displayPath = computed(() => home && (path() === home || path().startsWith(`${home}/`)) ? `~${path().slice(home.length)}` : path());
  const parentPath = () => displayPath().slice(0, displayPath().lastIndexOf("/") + 1);
  const folderName = () => displayPath().slice(parentPath().length) || displayPath();

  return (
    <View accessibilityLabel="Status bar" style={{ height: 22 }} class="shrink-0 flex-row items-center gap-2 border-t border-border bg-muted px-2">
      <If when={path()} else={
        <Button onPress={props.onOpenCommands}><Text class="text-xs text-muted-foreground">⌘⇧P · Open library</Text></Button>
      }>
        <View class="min-w-0 flex-row items-center" tooltip={path()}>
          <Text class="min-w-0 shrink text-xs text-muted-foreground line-clamp-1" style={{ textOverflow: "ellipsis-start" }}>{parentPath()}</Text>
          <Text class="shrink-0 text-xs text-foreground line-clamp-1">{folderName()}</Text>
        </View>
      </If>
      <If when={!syncing() && (operation() || opening() || refreshing())}><Text class="shrink-0 text-xs text-muted-foreground">{operation() || (opening() ? "Opening…" : "Indexing…")}</Text></If>
      <If when={gitStatus()}>{(status) => (
        <View class="ml-auto shrink-0 flex-row items-center gap-1" accessibilityLabel={status().description}
          tooltip={<Tooltip align="end" class="rounded-md border border-border bg-popover px-2 py-1.5" style={{ maxWidth: 320 }}>
            <Text class="text-xs text-foreground">{status().details}</Text>
          </Tooltip>}>
          <Icon name={status().icon} size={13} />
          <If when={!automatic()}><Icon name="pause" size={12} /></If>
          <Text class="text-xs text-muted-foreground">{status().branch}</Text>
        </View>
      )}</If>
    </View>
  );
}
