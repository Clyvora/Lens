import { useState } from "react";
import type { ComponentProps, ReactNode } from "react";

export function AppHeader(props: ComponentProps<"header">) {
  return <header {...props} />;
}

export function IntakeSurface(props: ComponentProps<"div">) {
  return <div {...props} />;
}

export function DocumentToolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar-shell">{children}</div>;
}

export function ProfilePanel(props: ComponentProps<"details">) {
  const [open, setOpen] = useState(true);
  return (
    <details
      {...props}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    />
  );
}

export function PasteDialog(props: ComponentProps<"section">) {
  return <section {...props} />;
}

export function ConversionDialog(props: ComponentProps<"section">) {
  return <section {...props} />;
}
