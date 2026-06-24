export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Custom authentication: redirect to our own login page instead of Manus OAuth portal.
export const getLoginUrl = () => {
  return "/login";
};
