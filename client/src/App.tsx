import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
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
import RequestAccess from "./pages/RequestAccess";
import AdminInviteRequests from "./pages/AdminInviteRequests";
import AdminInviteCodes from "./pages/AdminInviteCodes";
import Admin from "./pages/Admin";
import PublicSharedRecording from "./pages/PublicSharedRecording";
import SharedWithMe from "./pages/SharedWithMe";
import SharedWithMeRecording from "./pages/SharedWithMeRecording";
import RecordOrUpload from "./pages/RecordOrUpload";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import StudyGuides from "./pages/StudyGuides";
import KnowledgeBase from "./pages/KnowledgeBase";
import QuizPage from "./pages/QuizPage";
import EmailDrafts from "./pages/EmailDrafts";
import Analytics from "./pages/Analytics";
import Help from "./pages/Help";
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
    return <Redirect to="/login" />;
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
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/request-access" component={RequestAccess} />
      <Route path="/demo" component={Demo} />
      <Route path="/billing" component={Billing} />
      <Route path="/shared/:token" component={PublicSharedRecording} />

      {/* Protected routes */}
      <Route path="/dashboard" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/record" component={() => <ProtectedRoute component={Record} />} />
      <Route path="/upload" component={() => <ProtectedRoute component={Upload} />} />
      <Route path="/recording/:id" component={() => <ProtectedRoute component={RecordingDetail} />} />
      <Route path="/admin" component={() => <ProtectedRoute component={Admin} />} />
      <Route path="/admin/invite-requests" component={() => <ProtectedRoute component={AdminInviteRequests} />} />
      <Route path="/admin/invite-codes" component={() => <ProtectedRoute component={AdminInviteCodes} />} />
      <Route path="/record-or-upload" component={() => <ProtectedRoute component={RecordOrUpload} />} />
      <Route path="/knowledge-base" component={() => <ProtectedRoute component={KnowledgeBase} />} />
      <Route path="/shared-with-me" component={() => <ProtectedRoute component={SharedWithMe} />} />
      <Route path="/shared-with-me/:id" component={() => <ProtectedRoute component={SharedWithMeRecording} />} />
      <Route path="/recordings/:recordingId/study-guides" component={() => <ProtectedRoute component={StudyGuides} />} />
      <Route path="/recordings/:recordingId/quizzes" component={() => <ProtectedRoute component={QuizPage} />} />
      <Route path="/recordings/:recordingId/email-drafts" component={() => <ProtectedRoute component={EmailDrafts} />} />
      <Route path="/analytics" component={() => <ProtectedRoute component={Analytics} />} />
      <Route path="/help" component={() => <ProtectedRoute component={Help} />} />
      
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
