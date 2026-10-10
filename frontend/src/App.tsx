import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { SessionProvider, useSession } from "./lib/session";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";

// A tab opened before a deploy still asks for the old hashed chunks, which no longer exist. Reload
// once to pick up the new build instead of rendering a blank page.
const RELOADED = "vaultrag.chunk-reload";
function load<T>(factory: () => Promise<T>): Promise<T> {
  return factory().then(
    (m) => {
      try {
        sessionStorage.removeItem(RELOADED);
      } catch {
        /* ignore */
      }
      return m;
    },
    (err) => {
      let tried = true;
      try {
        tried = sessionStorage.getItem(RELOADED) === "1";
        if (!tried) sessionStorage.setItem(RELOADED, "1");
      } catch {
        /* no storage: reload at most this once */
        tried = false;
      }
      if (!tried) {
        window.location.reload();
        return new Promise<T>(() => {});
      }
      throw err;
    },
  );
}

// The story page loads first; the app pages (and their demo corpus) load when someone signs in.
const AskPage = lazy(() => load(() => import("./pages/AskPage")).then((m) => ({ default: m.AskPage })));
const ComparePage = lazy(() => load(() => import("./pages/ComparePage")).then((m) => ({ default: m.ComparePage })));
const KnowledgePage = lazy(() => load(() => import("./pages/KnowledgePage")).then((m) => ({ default: m.KnowledgePage })));
const RecordsPage = lazy(() => load(() => import("./pages/RecordsPage")).then((m) => ({ default: m.RecordsPage })));
const DemoPage = lazy(() => load(() => import("./pages/DemoPage")).then((m) => ({ default: m.DemoPage })));
const MePage = lazy(() => load(() => import("./pages/MePage")).then((m) => ({ default: m.MePage })));
const InsightsPage = lazy(() => load(() => import("./pages/InsightsPage")).then((m) => ({ default: m.InsightsPage })));
const SecurityPage = lazy(() => load(() => import("./pages/SecurityPage")).then((m) => ({ default: m.SecurityPage })));

function RequireAuth({ children }: { children: ReactNode }) {
  const { session } = useSession();
  return session ? <>{children}</> : <Navigate to="/login" replace />;
}

function Loading() {
  return <div className="grid h-48 place-items-center font-mono text-[12px] text-ink-3">loading…</div>;
}

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/demo" element={<DemoPage />} />
            <Route
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route path="/ask" element={<AskPage />} />
              <Route path="/compare" element={<ComparePage />} />
              <Route path="/knowledge" element={<KnowledgePage />} />
              <Route path="/records" element={<RecordsPage />} />
              <Route path="/security" element={<SecurityPage />} />
              <Route path="/me" element={<MePage />} />
              <Route path="/insights" element={<InsightsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </SessionProvider>
  );
}
