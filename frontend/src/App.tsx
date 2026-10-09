import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { SessionProvider, useSession } from "./lib/session";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";

// The story page loads first; the app pages (and their demo corpus) load when someone signs in.
const AskPage = lazy(() => import("./pages/AskPage").then((m) => ({ default: m.AskPage })));
const ComparePage = lazy(() => import("./pages/ComparePage").then((m) => ({ default: m.ComparePage })));
const KnowledgePage = lazy(() => import("./pages/KnowledgePage").then((m) => ({ default: m.KnowledgePage })));
const RecordsPage = lazy(() => import("./pages/RecordsPage").then((m) => ({ default: m.RecordsPage })));
const SecurityPage = lazy(() => import("./pages/SecurityPage").then((m) => ({ default: m.SecurityPage })));

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
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </SessionProvider>
  );
}
