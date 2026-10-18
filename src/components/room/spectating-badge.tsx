import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";

export function SpectatingBadge({ className }: { className?: string }) {
  return (
    <Badge tone="outline" className={cn("animate-swap", className)}>
      <Eye />
      Spectating
    </Badge>
  );
}
