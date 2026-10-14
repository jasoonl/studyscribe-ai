import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, Redirect } from "wouter";
import { nextFromLocation } from "@shared/safeNext";
import { lazy, Suspense } from "react";
import { RecorderProvider } from "./contexts/RecorderContext";
import { LiveTranscriptProvider } from "./contexts/LiveTranscriptContext";
import RecordingIndicator from "./components/RecordingIndicator";
import CookieBanner from "./components/CookieBanner";
import SkipLink from "./components/SkipLink";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { NotificationProvider } from "./components/NotificationContainer";
import { useCustomAuth } from "@/_core/hooks/useCustomAuth";
import { Loader2 } from "lucide-react";
import { CalendarReminderWatcher } from "@/components/CalendarReminderWatcher";

// Route components are code-split per page: eagerly importing every page
// (including heavy per-page deps like mermaid/streamdown/recharts) bundled
// everything into one >1.7MB chunk loaded even for a first visit to /login.
const NotFound = lazy(() => import("@/pages/NotFound"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Cookies = lazy(() => import("./pages/Cookies"));
const Refunds = lazy(() => import("./pages/Refunds"));
const Credits = lazy(() => import("./pages/Credits"));
const Pricing = lazy(() => import("./pages/Pricing"));
const Settings = lazy(() => import("./pages/Settings"));
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
const Ask = lazy(() => import("./pages/Ask"));
const CoursePage = lazy(() => import("./pages/CoursePage"));
const Tasks = lazy(() => import("./pages/Tasks"));
const Templates = lazy(() => import("./pages/Templates"));
const ExamPacks = lazy(() => import("./pages/ExamPacks"));
const ExamPack = lazy(() => import("./pages/ExamPack"));
const Groups = lazy(() => import("./pages/Groups"));
const Developers = lazy(() => import("./pages/Developers"));
const Unsubscribe = lazy(() => import("./pages/Unsubscribe"));
const Team = lazy(() => import("./pages/Team"));
const JoinTeam = lazy(() => import("./pages/JoinTeam"));
const TeamCourse = lazy(() => import("./pages/TeamCourse"));
const GroupPage = lazy(() => import("./pages/GroupPage"));
const JoinGroup = lazy(() => import("./pages/JoinGroup"));

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
    // Come back here after signing in (a group join link, a shared recording, a deep link with ?t=).
    const next = nextFromLocation(window.location.pathname, window.location.search);
    return <Redirect to={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} />;
  }

  return (
    <>
      <Component />
      <CalendarReminderWatcher />
    </>
  );
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
        <Route path="/terms" component={Terms} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/cookies" component={Cookies} />
        <Route path="/refunds" component={Refunds} />
        <Route path="/credits" component={Credits} />
        <Route path="/pricing" component={Pricing} />
        <Route path="/developers" component={Developers} />
        <Route path="/unsubscribe" component={Unsubscribe} />
        <Route path="/team/join/:token" component={JoinTeam} />
        <Route path="/billing" component={() => <ProtectedRoute component={Billing} />} />
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
        <Route path="/ask" component={() => <ProtectedRoute component={Ask} />} />
        <Route path="/courses/:id" component={() => <ProtectedRoute component={CoursePage} />} />
        <Route path="/tasks" component={() => <ProtectedRoute component={Tasks} />} />
        <Route path="/templates" component={() => <ProtectedRoute component={Templates} />} />
        <Route path="/exam-packs" component={() => <ProtectedRoute component={ExamPacks} />} />
        <Route path="/exam-packs/:id" component={() => <ProtectedRoute component={ExamPack} />} />
        <Route path="/groups" component={() => <ProtectedRoute component={Groups} />} />
        <Route path="/groups/join/:token" component={() => <ProtectedRoute component={JoinGroup} />} />
        <Route path="/groups/:id" component={() => <ProtectedRoute component={GroupPage} />} />
        <Route path="/help" component={() => <ProtectedRoute component={Help} />} />
        <Route path="/settings" component={() => <ProtectedRoute component={Settings} />} />
        <Route path="/team" component={() => <ProtectedRoute component={Team} />} />
        <Route path="/team/courses/:id" component={() => <ProtectedRoute component={TeamCourse} />} />

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
            <RecorderProvider>
              <LiveTranscriptProvider>
                <SkipLink />
                <Toaster />
                <Router />
                <RecordingIndicator />
                <CookieBanner />
              </LiveTranscriptProvider>
            </RecorderProvider>
          </TooltipProvider>
        </NotificationProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
