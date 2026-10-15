import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { SHARE_ROLES, type ShareRole } from "@shared/sharing";
import { t, useI18n } from "@/i18n";

/** Picks what someone may do with a shared recording: view, comment or edit (D3). */
export function RoleSelect({
  value,
  onChange,
  disabled,
  label,
  className,
}: {
  value: ShareRole;
  onChange: (role: ShareRole) => void;
  disabled?: boolean;
  /** Accessible name, e.g. "Access for ana@example.com". */
  label: string;
  className?: string;
}) {
  useI18n();
  return (
    <Select value={value} onValueChange={next => onChange(next as ShareRole)} disabled={disabled}>
      <SelectTrigger aria-label={label} className={cn("h-9 w-[9.5rem] shrink-0 text-sm", className)}>
        <SelectValue>{roleLabel(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end" className="w-72">
        {SHARE_ROLES.map(role => (
          <SelectItem key={role} value={role} className="py-2">
            <span className="flex flex-col items-start">
              <span className="font-medium">{roleLabel(role)}</span>
              <span className="text-xs text-muted-foreground">{t(`share.role.${role}Hint`)}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function roleLabel(role: string) {
  return t(SHARE_ROLES.includes(role as ShareRole) ? `share.role.${role as ShareRole}` : "share.role.view");
}
