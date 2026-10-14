import { Tabs } from "expo-router";
import { CheckSquare, Library, MessageCircleQuestion, Mic, Settings } from "lucide-react-native";
import { useTheme } from "@/theme/tokens";
import { useRecorder } from "@/lib/recorder/RecorderProvider";
import { isLive } from "@/lib/recorder/machine";

export default function TabsLayout() {
  const theme = useTheme();
  const { state } = useRecorder();
  const live = isLive(state);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.mutedForeground,
        tabBarStyle: { backgroundColor: theme.card, borderTopColor: theme.border },
        tabBarLabelStyle: { fontFamily: "Geist_500Medium", fontSize: 11, lineHeight: 14 },
        sceneStyle: { backgroundColor: theme.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Library", tabBarIcon: ({ color, size }) => <Library color={color} size={size} /> }} />
      <Tabs.Screen
        name="record"
        options={{
          title: live ? "Recording" : "Record",
          tabBarAccessibilityLabel: live ? "Record, a recording is in progress" : "Record",
          tabBarIcon: ({ color, size }) => <Mic color={live ? theme.destructive : color} size={size} />,
        }}
      />
      <Tabs.Screen name="ask" options={{ title: "Ask", tabBarIcon: ({ color, size }) => <MessageCircleQuestion color={color} size={size} /> }} />
      <Tabs.Screen name="tasks" options={{ title: "Tasks", tabBarIcon: ({ color, size }) => <CheckSquare color={color} size={size} /> }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: ({ color, size }) => <Settings color={color} size={size} /> }} />
    </Tabs>
  );
}
