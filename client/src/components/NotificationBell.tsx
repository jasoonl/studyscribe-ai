import { useState } from "react";
import { Bell, BellRing, Check, CheckCheck, Info, AlertTriangle, X, XCircle, CheckCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { CreateNotificationDialog } from "./CreateNotificationDialog";
import { createBrowserPushSubscription, isBrowserPushSupported } from "@/lib/browserPush";
import { toast } from "sonner";

function NotificationIcon({ type }: { type: string }) {
  switch (type) {
    case "success":
      return <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />;
    case "warning":
      return <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />;
    case "error":
      return <XCircle className="w-4 h-4 text-red-500 shrink-0" />;
    default:
      return <Info className="w-4 h-4 text-blue-500 shrink-0" />;
  }
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [isEnablingPush, setIsEnablingPush] = useState(false);
  const utils = trpc.useUtils();

  const { data: browserPushConfig } = trpc.browserPush.configuration.useQuery(undefined, { enabled: open });
  const subscribeBrowserPush = trpc.browserPush.subscribe.useMutation();

  const { data: unreadData } = trpc.userNotifications.unreadCount.useQuery(undefined, {
    refetchInterval: 30000, // Poll every 30 seconds
  });

  const { data: notifications, isLoading } = trpc.userNotifications.list.useQuery(undefined, {
    enabled: open,
  });

  const markRead = trpc.userNotifications.markRead.useMutation({
    onSuccess: () => {
      utils.userNotifications.unreadCount.invalidate();
      utils.userNotifications.list.invalidate();
    },
  });

  const markAllRead = trpc.userNotifications.markAllRead.useMutation({
    onSuccess: () => {
      utils.userNotifications.unreadCount.invalidate();
      utils.userNotifications.list.invalidate();
    },
  });

  const dismiss = trpc.userNotifications.dismiss.useMutation({
    onSuccess: () => {
      utils.userNotifications.unreadCount.invalidate();
      utils.userNotifications.list.invalidate();
    },
  });

  const unreadCount = unreadData?.count ?? 0;

  const enableBrowserPush = async () => {
    if (!browserPushConfig?.supported || !browserPushConfig.publicKey) {
      toast.error("Browser notifications are temporarily unavailable.");
      return;
    }
    if (!isBrowserPushSupported()) {
      toast.error("This browser does not support push notifications.");
      return;
    }

    setIsEnablingPush(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.message("Notifications remain off. You can enable them in your browser settings later.");
        return;
      }
      const subscription = await createBrowserPushSubscription(browserPushConfig.publicKey);
      await subscribeBrowserPush.mutateAsync(subscription);
      toast.success("Browser notifications are enabled for this device.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to enable browser notifications.");
    } finally {
      setIsEnablingPush(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <Badge
              className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs bg-primary text-primary-foreground"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
          <h3 className="font-semibold text-sm">Notifications</h3>
          <div className="flex items-center gap-1">
            <CreateNotificationDialog />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={enableBrowserPush}
              disabled={isEnablingPush}
              title="Enable browser notifications on this device"
            >
              <BellRing className="w-3 h-3" />
              {isEnablingPush ? "Enabling..." : "Enable push"}
            </Button>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
              >
                <CheckCheck className="w-3 h-3" />
                Mark all read
              </Button>
            )}
          </div>
        </div>
        <ScrollArea className="max-h-80">
          {isLoading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              Loading notifications...
            </div>
          ) : !notifications || notifications.length === 0 ? (
            <div className="p-6 text-center">
              <Bell className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-50" />
              <p className="text-sm text-muted-foreground">No notifications yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                You'll be notified when transcriptions complete
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notif) => (
                <div
                  key={notif.id}
                  className={`flex gap-3 p-3 hover:bg-muted/50 transition-colors cursor-pointer ${
                    notif.isRead === 0 ? "bg-primary/5" : ""
                  }`}
                  onClick={() => {
                    if (notif.isRead === 0) {
                      markRead.mutate({ id: notif.id });
                    }
                  }}
                >
                  <div className="mt-0.5">
                    <NotificationIcon type={notif.type ?? "info"} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm font-medium leading-tight ${notif.isRead === 0 ? "text-foreground" : "text-muted-foreground"}`}>
                        {notif.title}
                      </p>
                      <div className="flex items-center gap-1 shrink-0">
                        {notif.isRead === 0 && <div className="mt-1 h-2 w-2 rounded-full bg-primary" />}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                          aria-label={`Dismiss ${notif.title} notification`}
                          title="Dismiss notification"
                          onClick={(event) => {
                            event.stopPropagation();
                            dismiss.mutate({ id: notif.id });
                          }}
                          disabled={dismiss.isPending}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {notif.message}
                    </p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })}
                    </p>
                    {notif.recordingId && (
                      <Link
                        href={`/recording/${notif.recordingId}`}
                        className="text-xs text-primary hover:underline mt-1 inline-block"
                        onClick={() => setOpen(false)}
                      >
                        View recording →
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
