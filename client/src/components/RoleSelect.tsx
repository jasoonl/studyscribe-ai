import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { SHARE_ROLES, SHARE_ROLE_LABELS, type ShareRole } from "@shared/sharing";

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
  return (
    <Select value={value} onValueChange={next => onChange(next as ShareRole)} disabled={disabled}>
      <SelectTrigger aria-label={label} className={cn("h-9 w-[8.5rem] shrink-0 text-sm", className)}>
        <SelectValue>{SHARE_ROLE_LABELS[value].label}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end" className="w-72">
        {SHARE_ROLES.map(role => (
          <SelectItem key={role} value={role} className="py-2">
            <span className="flex flex-col items-start">
              <span className="font-medium">{SHARE_ROLE_LABELS[role].label}</span>
              <span className="text-xs text-muted-foreground">{SHARE_ROLE_LABELS[role].hint}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function roleLabel(role: string) {
  return SHARE_ROLE_LABELS[role as ShareRole]?.label ?? "Can view";
}
