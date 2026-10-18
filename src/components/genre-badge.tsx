import { genreLabel } from "@/lib/game/genres";
import { Badge } from "./ui/badge";

export function GenreBadge({ genre, className }: { genre: string | null | undefined; className?: string }) {
  return <Badge className={className}>{genreLabel(genre)}</Badge>;
}
