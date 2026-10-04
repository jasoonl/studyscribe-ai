/** Public contact address shown on the legal pages. Set VITE_CONTACT_EMAIL before launch. */
export const CONTACT_EMAIL: string | null = (import.meta.env.VITE_CONTACT_EMAIL as string | undefined)?.trim() || null;
