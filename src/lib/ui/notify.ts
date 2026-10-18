import { toast } from "sonner";
import { friendlyError } from "@/lib/game/error-messages";

export function notifyError(error: unknown, fallback?: string) {
  const message = friendlyError(error, fallback);
  toast.error(message, { id: `error:${message}` });
}

export function notifyFailure(message: string, description?: string) {
  toast.error(message, { id: `error:${message}`, description });
}
