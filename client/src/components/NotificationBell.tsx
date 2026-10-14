import { useState } from "react";
import { Bell, BellRing, CheckCheck, Info, AlertTriangle, X, XCircle, CheckCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { CreateNotificationDialog } from "./CreateNotificationDialog";
import { createBrowserPushSubscription, isBrowserPushSupported } from "@/lib/browserPush";
import { toast } from "sonner";
import { htmlLangFor } from "@shared/i18n";
import { getUiLanguage, useI18n } from "@/i18n";

const ICON_STYLES: Record<string, { Icon: typeof Info; tone: string }> = {
  success: { Icon: CheckCircle, tone: "bg-green-500/10 text-green-600" },
  warning: { Icon: AlertTriangle, tone: "bg-yellow-500/10 text-yellow-600" },
  error: { Icon: XCircle, tone: "bg-red-500/10 text-red-600" },
  info: { Icon: Info, tone: "bg-blue-500/10 text-blue-600" },
};

function NotificationIcon({ type }: { type: string }) {
  const { Icon, tone } = ICON_STYLES[type] ?? ICON_STYLES.info;
  return (
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone}`}>
      <Icon className="h-4 w-4" aria-hidden="true" />
    </span>
  );
}

/** "5 minutes ago" in the interface language. */
function timeAgo(date: string | Date) {
  const seconds = Math.round((new Date(date).getTime() - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(htmlLangFor(getUiLanguage()), { numeric: "auto" });
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [["year", 31_536_000], ["month", 2_592_000], ["week", 604_800], ["day", 86_400], ["hour", 3_600], ["minute", 60]];
  for (const [unit, size] of steps) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return format.format(0, "minute");
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [isEnablingPush, setIsEnablingPush] = useState(false);
  const { t } = useI18n();
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
      toast.error(t("notif.pushUnavailable"));
      return;
    }
    if (!isBrowserPushSupported()) {
      toast.error(t("notif.pushUnsupported"));
      return;
    }

    setIsEnablingPush(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.message(t("notif.pushDenied"));
        return;
      }
      const subscription = await createBrowserPushSubscription(browserPushConfig.publicKey);
      await subscribeBrowserPush.mutateAsync(subscription);
      toast.success(t("notif.pushOn"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("notif.pushFailed"));
    } finally {
      setIsEnablingPush(false);
    }
  };

  const pushAvailable = browserPushConfig ? browserPushConfig.supported : true;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unreadCount > 0 ? t("notif.labelUnread", { count: unreadCount }) : t("notif.label")}
        >
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <Badge className="absolute -top-1 -right-1 h-4 min-w-4 justify-center px-1 text-[10px] leading-none bg-primary text-primary-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="flex w-[min(24rem,calc(100vw-1.5rem))] max-h-[min(34rem,calc(100dvh-5rem))] flex-col overflow-hidden rounded-xl p-0 shadow-lg motion-reduce:animate-none"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold tracking-tight">{t("notif.label")}</h3>
            {unreadCount > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {t("notif.new", { count: unreadCount })}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs font-medium text-primary hover:bg-primary/10 hover:text-primary"
            onClick={() => markAllRead.mutate()}
            disabled={unreadCount === 0 || markAllRead.isPending}
          >
            <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {t("notif.markAll")}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {isLoading ? (
            <div className="space-y-4 p-4" aria-label={t("notif.loading")}>
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex animate-pulse gap-3">
                  <div className="h-8 w-8 rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-2/5 rounded bg-muted" />
                    <div className="h-3 w-4/5 rounded bg-muted/70" />
                  </div>
                </div>
              ))}
            </div>
          ) : !notifications || notifications.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Bell className="h-5 w-5" aria-hidden="true" />
              </span>
              <p className="text-sm font-medium">{t("notif.caughtUp")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("notif.caughtUpHelp")}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {notifications.map((notif) => {
                const unread = notif.isRead === 0;
                return (
                  <li
                    key={notif.id}
                    className={`group relative flex gap-3 px-4 py-3 transition-colors hover:bg-primary/[0.04] ${unread ? "bg-primary/[0.05]" : ""}`}
                    onClick={() => {
                      if (unread) markRead.mutate({ id: notif.id });
                    }}
                    // Keyboard users reach the item through its buttons and links, so focus counts as reading it.
                    onFocus={() => {
                      if (unread && !markRead.isPending) markRead.mutate({ id: notif.id });
                    }}
                  >
                    {unread && (
                      <span className="absolute left-1.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-primary" aria-label={t("notif.unread")} />
                    )}
                    <NotificationIcon type={notif.type ?? "info"} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm leading-snug ${unread ? "font-semibold text-foreground" : "font-medium text-foreground/70"}`}>
                          {notif.title}
                        </p>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="-mr-1 -mt-1 h-7 w-7 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                          aria-label={t("notif.dismissOne", { title: notif.title })}
                          title={t("notif.dismiss")}
                          onClick={(event) => {
                            event.stopPropagation();
                            dismiss.mutate({ id: notif.id });
                          }}
                          disabled={dismiss.isPending}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <p className="mt-0.5 break-words text-[13px] leading-snug text-muted-foreground line-clamp-2">
                        {notif.message}
                      </p>
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{timeAgo(notif.createdAt)}</span>
                        {notif.recordingId && (
                          <>
                            <span aria-hidden="true">·</span>
                            <Link
                              href={`/recording/${notif.recordingId}`}
                              className="font-medium text-primary hover:underline"
                              onClick={(event) => {
                                event.stopPropagation();
                                setOpen(false);
                              }}
                            >
                              {t("notif.viewRecording")}
                            </Link>
                          </>
                        )}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className={`grid shrink-0 gap-1 border-t bg-muted/20 p-2 ${pushAvailable ? "grid-cols-2" : "grid-cols-1"}`}>
          <CreateNotificationDialog triggerClassName="h-9 w-full justify-center gap-1.5 text-xs font-medium" />
          {pushAvailable && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-full justify-center gap-1.5 text-xs font-medium"
              onClick={enableBrowserPush}
              disabled={isEnablingPush}
              title={t("notif.pushHint")}
            >
              <BellRing className="h-3.5 w-3.5" aria-hidden="true" />
              {isEnablingPush ? t("notif.enabling") : t("notif.enablePush")}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
