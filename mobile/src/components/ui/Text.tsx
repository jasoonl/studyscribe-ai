import { Text as RNText, type TextProps as RNTextProps } from "react-native";
import { cn } from "@/lib/cn";

/**
 * Text in Geist. Sizes follow the web's type scale; every size scales with the
 * system text size (Dynamic Type / font scale), capped so layouts hold.
 */
const variants = {
  display: "font-bold text-[30px] leading-[36px] tracking-tight text-foreground",
  title: "font-bold text-[24px] leading-[30px] tracking-tight text-foreground",
  heading: "font-semibold text-[19px] leading-[25px] tracking-tight text-foreground",
  subheading: "font-semibold text-[16px] leading-[22px] text-foreground",
  body: "font-sans text-[16px] leading-[24px] text-foreground",
  small: "font-sans text-[14px] leading-[20px] text-foreground",
  muted: "font-sans text-[14px] leading-[20px] text-muted-foreground",
  caption: "font-medium text-[12px] leading-[16px] text-muted-foreground",
  label: "font-medium text-[14px] leading-[20px] text-foreground",
} as const;

export type TextVariant = keyof typeof variants;

export type TextProps = RNTextProps & { variant?: TextVariant; className?: string };

export function Text({ variant = "body", className, maxFontSizeMultiplier = 1.8, ...props }: TextProps) {
  const isHeading = variant === "display" || variant === "title" || variant === "heading";
  return (
    <RNText
      accessibilityRole={isHeading ? "header" : props.accessibilityRole}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      className={cn(variants[variant], className)}
      {...props}
    />
  );
}
