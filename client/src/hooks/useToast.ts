import { useCallback } from "react";
import { toast } from "sonner";

export function useToast() {
  const success = useCallback((message: string, description?: string) => {
    toast.success(message, { description });
  }, []);

  const error = useCallback((message: string, description?: string) => {
    toast.error(message, { description });
  }, []);

  const info = useCallback((message: string, description?: string) => {
    toast(message, { description });
  }, []);

  const warning = useCallback((message: string, description?: string) => {
    toast.warning ? toast.warning(message, { description }) : toast(message, { description });
  }, []);

  const loading = useCallback((message: string) => {
    return toast.loading(message);
  }, []);

  const dismiss = useCallback((id: string | number) => {
    toast.dismiss(id);
  }, []);

  return { success, error, info, warning, loading, dismiss };
}
