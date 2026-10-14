import { Stack } from "expo-router";
import { useTheme } from "@/theme/tokens";

export default function AuthLayout() {
  const theme = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }} initialRouteName="login" />;
}
