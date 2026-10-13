import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CircleAlert, CircleCheck, Info } from "lucide-react-native";
import { cn } from "@/lib/cn";
import { useTheme } from "@/theme/tokens";
import { Text } from "./Text";

type ToastTone = "info" | "success" | "error";
type ToastItem = { id: number; message: string; tone: ToastTone };

const ToastContext = createContext<{ show: (message: string, tone?: ToastTone) => void } | null>(null);

/** Short confirmations and errors (the web uses sonner), announced to screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);

  const show = useCallback(
    (message: string, tone: ToastTone = "info") => {
      const id = nextId.current++;
      setItems((current) => [...current.slice(-2), { id, message, tone }]);
      AccessibilityInfo.announceForAccessibility(message);
      setTimeout(() => dismiss(id), tone === "error" ? 6000 : 3500);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <View pointerEvents="box-none" className="absolute left-0 right-0 items-center gap-2 px-4" style={{ top: insets.top + 8 }}>
        {items.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="alert"
            accessibilityHint="Tap to dismiss"
            onPress={() => dismiss(item.id)}
            className={cn("w-full max-w-[520px] flex-row items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-md", item.tone === "error" ? "border-destructive/40" : "border-border")}
          >
            {item.tone === "success" ? (
              <CircleCheck size={18} color={theme.success} />
            ) : item.tone === "error" ? (
              <CircleAlert size={18} color={theme.destructive} />
            ) : (
              <Info size={18} color={theme.primary} />
            )}
            <Text variant="small" className="flex-1">
              {item.message}
            </Text>
          </Pressable>
        ))}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
