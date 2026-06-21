import { AlertCircle, CheckCircle, Info, X } from "lucide-react";
import { useEffect, useState } from "react";

export type NotificationType = "success" | "error" | "info" | "warning";

interface NotificationBannerProps {
  type: NotificationType;
  title: string;
  message: string;
  duration?: number; // in milliseconds, 0 = no auto-dismiss
  onClose?: () => void;
}

const notificationStyles = {
  success: {
    bg: "bg-green-50 border-green-200",
    icon: "text-green-600",
    title: "text-green-900",
    message: "text-green-700",
  },
  error: {
    bg: "bg-red-50 border-red-200",
    icon: "text-red-600",
    title: "text-red-900",
    message: "text-red-700",
  },
  info: {
    bg: "bg-blue-50 border-blue-200",
    icon: "text-blue-600",
    title: "text-blue-900",
    message: "text-blue-700",
  },
  warning: {
    bg: "bg-yellow-50 border-yellow-200",
    icon: "text-yellow-600",
    title: "text-yellow-900",
    message: "text-yellow-700",
  },
};

const icons = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
  warning: AlertCircle,
};

export function NotificationBanner({
  type,
  title,
  message,
  duration = 5000,
  onClose,
}: NotificationBannerProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (duration === 0) return;

    const timer = setTimeout(() => {
      setIsVisible(false);
      onClose?.();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  if (!isVisible) return null;

  const styles = notificationStyles[type];
  const Icon = icons[type];

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border p-4 ${styles.bg}`}
      role="alert"
    >
      <Icon className={`h-5 w-5 flex-shrink-0 ${styles.icon}`} />
      <div className="flex-1">
        <h3 className={`font-semibold ${styles.title}`}>{title}</h3>
        <p className={`text-sm ${styles.message}`}>{message}</p>
      </div>
      <button
        onClick={() => {
          setIsVisible(false);
          onClose?.();
        }}
        className="flex-shrink-0 text-gray-400 hover:text-gray-600"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}
