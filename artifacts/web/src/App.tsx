import { Suspense, lazy } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";

import { I18nProvider } from "@/lib/i18n";
import PwaInstallBanner from "@/components/pwa-install-banner";
import InviteBanner from "@/components/invite-banner";

const LandingPage = lazy(() => import("@/pages/landing"));
const HomePage    = lazy(() => import("@/pages/home"));
const RoomPage    = lazy(() => import("@/pages/room"));
const AuthPage    = lazy(() => import("@/pages/auth"));
const TermsPage   = lazy(() => import("@/pages/terms"));
const PrivacyPage = lazy(() => import("@/pages/privacy"));
const NotFound    = lazy(() => import("@/pages/not-found"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/"           component={LandingPage} />
        <Route path="/home"       component={HomePage} />
        <Route path="/auth"       component={AuthPage} />
        <Route path="/room/:slug" component={RoomPage} />
        <Route path="/terms"      component={TermsPage} />
        <Route path="/privacy"    component={PrivacyPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <PwaInstallBanner />
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <InviteBanner />
          <Router />
        </WouterRouter>
        <Toaster />
      </I18nProvider>
    </QueryClientProvider>
  );
}

export default App;
