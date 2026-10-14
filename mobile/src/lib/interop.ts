import { cssInterop } from "nativewind";
import { SafeAreaView } from "react-native-safe-area-context";

// Lets className work on third-party components NativeWind does not wrap itself.
cssInterop(SafeAreaView, { className: "style" });
