import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import Dashboard from "./pages/Dashboard";
import Record from "./pages/Record";
import RecordingDetail from "./pages/RecordingDetail";
import Upload from "./pages/Upload";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Demo from "./pages/Demo";
import Billing from "./pages/Billing";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Invite from "./pages/Invite";
import { NotificationProvider } from "./components/NotificationContainer";
import { useCustomAuth } from "@/_core/hooks/useCustomAuth";
import { Loader2 } from "lucide-react";

/**
 * Protected Route Component
 * Redirects to /login if not authenticated
 */
function ProtectedRoute({ component: Component }: { component: React.ComponentType<any> }) {
  const { isAuthenticated, loading } = useCustomAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    window.location.href = "/login";
    return null;
  }

  return <Component />;
}

function Router() {
  return (
    <Switch>
      {/* Public routes */}
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/invite" component={Invite} />
      <Route path="/demo" component={Demo} />
      <Route path="/billing" component={Billing} />
      
      {/* Protected routes */}
      <Route path="/dashboard" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/record" component={() => <ProtectedRoute component={Record} />} />
      <Route path="/upload" component={() => <ProtectedRoute component={Upload} />} />
      <Route path="/recording/:id" component={() => <ProtectedRoute component={RecordingDetail} />} />
      
      {/* 404 fallback */}
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook
// 
// NOTE: About Authentication
// - Custom authentication system replaces Manus OAuth
// - Protected routes redirect to /login if not authenticated
// - useCustomAuth hook manages session state

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <NotificationProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </NotificationProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
