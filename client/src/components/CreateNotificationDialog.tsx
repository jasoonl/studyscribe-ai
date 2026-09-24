import { useState } from "react";
import { BellPlus } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type NotificationCategory = "info" | "success" | "warning" | "error";

const categoryLabels: Record<NotificationCategory, string> = {
  info: "Information",
  success: "Success",
  warning: "Reminder",
  error: "Important",
};

export function CreateNotificationDialog({ triggerClassName }: { triggerClassName?: string } = {}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [type, setType] = useState<NotificationCategory>("info");
  const [recordingId, setRecordingId] = useState("none");
  const utils = trpc.useUtils();

  const { data: recordings } = trpc.recordings.list.useQuery(undefined, { enabled: open });
  const createNotification = trpc.userNotifications.create.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.userNotifications.list.invalidate(),
        utils.userNotifications.unreadCount.invalidate(),
      ]);
      toast.success("Custom notification added");
      setTitle("");
      setMessage("");
      setType("info");
      setRecordingId("none");
      setOpen(false);
    },
    onError: (error) => toast.error(error.message || "Could not add notification"),
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    createNotification.mutate({
      title,
      message,
      type,
      ...(recordingId !== "none" ? { recordingId: Number(recordingId) } : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className={triggerClassName ?? "h-7 gap-1 px-2 text-xs"}>
          <BellPlus className="h-3.5 w-3.5" />
          Add reminder
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a notification</DialogTitle>
          <DialogDescription>
            Save a personal reminder in your StudyScribe notification center.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="notification-title">Title</Label>
            <Input
              id="notification-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g., Review tomorrow's lecture"
              maxLength={120}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notification-message">Message</Label>
            <Textarea
              id="notification-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Add the details you want to remember."
              maxLength={1000}
              rows={4}
              required
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={type} onValueChange={(value) => setType(value as NotificationCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(categoryLabels) as NotificationCategory[]).map((category) => (
                    <SelectItem key={category} value={category}>{categoryLabels[category]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Link a recording</Label>
              <Select value={recordingId} onValueChange={setRecordingId}>
                <SelectTrigger><SelectValue placeholder="No recording" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No recording</SelectItem>
                  {recordings?.map((recording) => (
                    <SelectItem key={recording.id} value={String(recording.id)}>{recording.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={createNotification.isPending}>Cancel</Button>
            <Button type="submit" disabled={createNotification.isPending || !title.trim() || !message.trim()}>
              {createNotification.isPending ? "Saving..." : "Add notification"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
