import { Suspense, lazy, Component, useEffect, useState, type ReactNode, type ComponentType } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";

import { I18nProvider } from "@/lib/i18n";
import PwaInstallBanner from "@/components/pwa-install-banner";
import InviteBanner from "@/components/invite-banner";
import { useAuth } from "@/hooks/use-auth";

const LandingPage = lazy(() => import("@/pages/landing"));
const HomePage    = lazy(() => import("@/pages/home"));
const RoomPage    = lazy(() => import("@/pages/room"));
const AuthPage    = lazy(() => import("@/pages/auth"));
const TermsPage   = lazy(() => import("@/pages/terms"));
const PrivacyPage = lazy(() => import("@/pages/privacy"));
const AdminPage   = lazy(() => import("@/pages/admin"));
const NotFound    = lazy(() => import("@/pages/not-found"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,         // Keep cached data longer (10 min) for offline scenarios
      refetchOnWindowFocus: false,
      retry: 1,
      // 'offlineFirst' serves cached data immediately when there is no network,
      // instead of showing an error. Requests are paused and retried when online again.
      networkMode: 'offlineFirst',
    },
    mutations: {
      networkMode: 'offlineFirst',
    },
  },
});

// Auto-reload on Vite chunk loading errors (happens after new deployments when
// the browser has a cached index.html referencing old hashed chunk files).
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', () => {
    window.location.reload();
  });
}

function isChunkLoadError(err: Error) {
  const msg = err?.message ?? '';
  return (
    msg.includes('Importing a module script failed') ||
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('ChunkLoadError')
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) {
    // Chunk load errors → reload silently so the user never sees the error screen
    if (isChunkLoadError(error)) {
      window.location.reload();
      return { error: null };
    }
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, color: '#fff', background: '#0f0f1a', minHeight: '100vh', fontFamily: 'sans-serif' }}>
          <h2 style={{ color: '#f87171' }}>خطأ في التطبيق</h2>
          <pre style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'pre-wrap' }}>
            {(this.state.error as Error).message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 16, padding: '8px 20px', background: '#06b6d4', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
          >
            إعادة المحاولة
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function PageLoader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'hsl(240 10% 4%)' }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid #06b6d4', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function SiteAnnouncementBanner() {
  const [announcement, setAnnouncement] = useState("");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetch("/api/public/site-info")
      .then(r => r.json())
      .then(d => { if (d.announcement) setAnnouncement(d.announcement); })
      .catch(() => {});
  }, []);

  if (!announcement || dismissed) return null;

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
      background: "linear-gradient(90deg, #7c3aed, #2563eb)",
      color: "#fff", padding: "10px 16px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      fontSize: "14px", fontFamily: "sans-serif", direction: "rtl",
      boxShadow: "0 2px 8px rgba(0,0,0,0.4)"
    }}>
      <span>📢 {announcement}</span>
      <button
        onClick={() => setDismissed(true)}
        style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px" }}
      >×</button>
    </div>
  );
}

// Redirect to /auth if user has unverified email
function VerifiedRoute({ component: Comp }: { component: ComponentType<any> }) {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && user && user.email && user.emailVerified === false) {
      setLocation('/auth');
    }
  }, [user, loading]);

  if (loading) return <PageLoader />;
  return <Comp />;
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/"           component={() => <VerifiedRoute component={HomePage} />} />
        <Route path="/home"       component={() => <VerifiedRoute component={HomePage} />} />
        <Route path="/auth"       component={AuthPage} />
        <Route path="/room/:slug" component={() => <VerifiedRoute component={RoomPage} />} />
        <Route path="/terms"      component={TermsPage} />
        <Route path="/privacy"    component={PrivacyPage} />
        <Route path="/admin"      component={() => <VerifiedRoute component={AdminPage} />} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <SiteAnnouncementBanner />
          <PwaInstallBanner />
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <InviteBanner />
            <Router />
          </WouterRouter>
          <Toaster />
        </I18nProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
