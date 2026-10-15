import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { roleLabel } from "@/components/RoleSelect";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, Users2, Mic } from "lucide-react";
import { useI18n } from "@/i18n";

export default function SharedWithMe() {
  const { t, formatDate } = useI18n();
  const { data: shared, isLoading } = trpc.sharing.sharedWithMe.useQuery();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background sticky top-0 z-40">
        <div className="container h-16 flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              {t("shared.back")}
            </Button>
          </Link>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Users2 className="w-5 h-5" /> {t("shared.title")}
          </h1>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="container py-8 max-w-3xl focus:outline-none">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-accent" />
          </div>
        ) : !shared || shared.length === 0 ? (
          <Card className="p-12 text-center">
            <Users2 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">{t("shared.empty")}</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {shared.map((item) => (
              <Link key={item.recordingId} href={`/shared-with-me/${item.recordingId}`}>
                <Card className="p-4 flex items-center justify-between hover:border-accent transition-colors cursor-pointer">
                  <div className="flex items-center gap-3 min-w-0">
                    <Mic className="w-5 h-5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <h4 className="font-semibold truncate">{item.title}</h4>
                      <p className="text-xs text-muted-foreground">
                        {t("shared.sharedOn", { date: formatDate(item.sharedAt) })} · {roleLabel(item.role)}
                        {item.viaGroups.length > 0 && ` · ${t("shared.through", { groups: item.viaGroups.join(", ") })}`}
                      </p>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
