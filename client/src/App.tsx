import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, Redirect } from "wouter";
import { lazy, Suspense } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { NotificationProvider } from "./components/NotificationContainer";
import { useCustomAuth } from "@/_core/hooks/useCustomAuth";
import { Loader2 } from "lucide-react";

// Route components are code-split per page: eagerly importing every page
// (including heavy per-page deps like mermaid/streamdown/recharts) bundled
// everything into one >1.7MB chunk loaded even for a first visit to /login.
const NotFound = lazy(() => import("@/pages/NotFound"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Record = lazy(() => import("./pages/Record"));
const RecordingDetail = lazy(() => import("./pages/RecordingDetail"));
const Upload = lazy(() => import("./pages/Upload"));
const Home = lazy(() => import("./pages/Home"));
const Demo = lazy(() => import("./pages/Demo"));
const Billing = lazy(() => import("./pages/Billing"));
const Login = lazy(() => import("./pages/Login"));
const Signup = lazy(() => import("./pages/Signup"));
const Invite = lazy(() => import("./pages/Invite"));
const RequestAccess = lazy(() => import("./pages/RequestAccess"));
const AdminInviteRequests = lazy(() => import("./pages/AdminInviteRequests"));
const AdminInviteCodes = lazy(() => import("./pages/AdminInviteCodes"));
const Admin = lazy(() => import("./pages/Admin"));
const PublicSharedRecording = lazy(() => import("./pages/PublicSharedRecording"));
const SharedWithMe = lazy(() => import("./pages/SharedWithMe"));
const SharedWithMeRecording = lazy(() => import("./pages/SharedWithMeRecording"));
const RecordOrUpload = lazy(() => import("./pages/RecordOrUpload"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const StudyGuides = lazy(() => import("./pages/StudyGuides"));
const KnowledgeBase = lazy(() => import("./pages/KnowledgeBase"));
const QuizPage = lazy(() => import("./pages/QuizPage"));
const EmailDrafts = lazy(() => import("./pages/EmailDrafts"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Help = lazy(() => import("./pages/Help"));

function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-accent" />
    </div>
  );
}

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
    <Suspense fallback={<RouteFallback />}>
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
    </Suspense>
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
