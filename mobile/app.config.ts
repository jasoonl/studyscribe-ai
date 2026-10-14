import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * App config. Placeholders the owner replaces before the first store build
 * (see mobile/README.md, "Before the first build"):
 *  - BUNDLE_ID: com.studyscribe.app is a placeholder; set APP_BUNDLE_ID once registered.
 *  - EAS_PROJECT_ID: from `eas init` (needed for push tokens and EAS Update).
 *  - GOOGLE_IOS_URL_SCHEME: the iOS OAuth client's reversed client id.
 *  - APP_DOMAIN: the web domain for universal / app links.
 */
const BUNDLE_ID = process.env.APP_BUNDLE_ID || "com.studyscribe.app";
const APP_DOMAIN = process.env.APP_DOMAIN || "studyscribe-ai.vercel.app";
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID || undefined;
const GOOGLE_IOS_URL_SCHEME = process.env.GOOGLE_IOS_URL_SCHEME || "com.googleusercontent.apps.REPLACE_WITH_IOS_CLIENT_ID";
const VERSION = "1.0.0";

const microphoneReason = "StudyScribe records lectures and meetings you choose to capture so they can be transcribed.";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "StudyScribe",
  slug: "studyscribe",
  owner: process.env.EXPO_OWNER || undefined,
  version: VERSION,
  orientation: "default",
  icon: "./assets/images/icon.png",
  scheme: "studyscribe",
  userInterfaceStyle: "automatic",
  backgroundColor: "#f8fafd",
  runtimeVersion: { policy: "appVersion" },
  updates: EAS_PROJECT_ID ? { url: `https://u.expo.dev/${EAS_PROJECT_ID}` } : undefined,
  extra: { eas: EAS_PROJECT_ID ? { projectId: EAS_PROJECT_ID } : undefined },
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: true,
    usesAppleSignIn: true,
    associatedDomains: [`applinks:${APP_DOMAIN}`, `webcredentials:${APP_DOMAIN}`],
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      NSMicrophoneUsageDescription: microphoneReason,
      NSPhotoLibraryUsageDescription: "Choose a lecture or meeting video from your library to transcribe it.",
      // Recording continues with the screen locked; playback continues in the background.
      UIBackgroundModes: ["audio", "remote-notification"],
      ITSAppUsesNonExemptEncryption: false,
    },
    // PrivacyInfo.xcprivacy: required-reason APIs used by the Expo modules in this app,
    // and the data the app collects (mirrors mobile/STORE.md's privacy label).
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults", NSPrivacyAccessedAPITypeReasons: ["CA92.1"] },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp", NSPrivacyAccessedAPITypeReasons: ["C617.1", "0A2A.1", "3B52.1"] },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategorySystemBootTime", NSPrivacyAccessedAPITypeReasons: ["35F9.1"] },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryDiskSpace", NSPrivacyAccessedAPITypeReasons: ["E174.1", "85F4.1"] },
      ],
      NSPrivacyCollectedDataTypes: [
        collected("NSPrivacyCollectedDataTypeEmailAddress"),
        collected("NSPrivacyCollectedDataTypeName"),
        collected("NSPrivacyCollectedDataTypeAudioData"),
        collected("NSPrivacyCollectedDataTypeOtherUserContent"),
        collected("NSPrivacyCollectedDataTypeUserID"),
        collected("NSPrivacyCollectedDataTypeDeviceID"),
      ],
    },
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: "#ffffff",
      foregroundImage: "./assets/images/adaptive-icon.png",
      monochromeImage: "./assets/images/adaptive-mono.png",
    },
    // RECORD_AUDIO and the microphone foreground service come from the expo-audio plugin below.
    permissions: ["android.permission.RECORD_AUDIO", "android.permission.POST_NOTIFICATIONS", "android.permission.FOREGROUND_SERVICE", "android.permission.FOREGROUND_SERVICE_MICROPHONE", "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"],
    blockedPermissions: ["android.permission.SYSTEM_ALERT_WINDOW"],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: ["/recording", "/shared", "/shared-with-me", "/courses", "/exam-packs", "/tasks", "/ask", "/reset-password", "/invite", "/signup"].map((pathPrefix) => ({
          scheme: "https",
          host: APP_DOMAIN,
          pathPrefix,
        })),
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
    predictiveBackGestureEnabled: false,
  },
  web: { output: "single", favicon: "./assets/images/favicon.png", bundler: "metro" },
  plugins: [
    "expo-router",
    "expo-font",
    "expo-secure-store",
    "expo-apple-authentication",
    "expo-sharing",
    [
      "expo-audio",
      {
        microphonePermission: microphoneReason,
        // iOS: the audio background mode. Android: a microphone foreground service with an ongoing notification.
        enableBackgroundRecording: true,
        enableBackgroundPlayback: true,
      },
    ],
    ["expo-notifications", { icon: "./assets/images/adaptive-mono.png", color: "#2154d8" }],
    ["expo-image-picker", { photosPermission: "Choose a lecture or meeting video from your library to transcribe it.", cameraPermission: false, microphonePermission: false }],
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 120,
        backgroundColor: "#f8fafd",
        dark: { image: "./assets/images/splash-icon.png", backgroundColor: "#070d1a" },
      },
    ],
    ["@react-native-google-signin/google-signin", { iosUrlScheme: GOOGLE_IOS_URL_SCHEME }],
    ["expo-build-properties", { android: { minSdkVersion: 24 } }],
  ],
  experiments: { typedRoutes: false, reactCompiler: true },
});

function collected(type: string) {
  return {
    NSPrivacyCollectedDataType: type,
    NSPrivacyCollectedDataTypeLinked: true,
    NSPrivacyCollectedDataTypeTracking: false,
    NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
  };
}
