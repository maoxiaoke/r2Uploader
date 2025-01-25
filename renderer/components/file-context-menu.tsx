import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export function FileContextMenu({
  children,
  onExport,
  onOpenInBrowser,
  onCopyPath,
  onCopy2Clipboard,
  onDelete,
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-40 p-2">
        <ContextMenuItem className="text-sm" onClick={onExport}>
          Export
        </ContextMenuItem>
        <ContextMenuItem onClick={onOpenInBrowser}>
          Open in browser
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Copy & Paste</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            <ContextMenuItem onClick={onCopy2Clipboard}>
              Copy to clipboard
              <ContextMenuShortcut>⌘C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={onCopyPath}>Copy path</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onClick={onDelete}
        >
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
