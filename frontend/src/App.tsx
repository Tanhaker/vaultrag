import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { SessionProvider, useSession } from "./lib/session";
import { AskPage } from "./pages/AskPage";
import { ComparePage } from "./pages/ComparePage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { LoginPage } from "./pages/LoginPage";
import { RecordsPage } from "./pages/RecordsPage";
import { SecurityPage } from "./pages/SecurityPage";

function RequireAuth({ children }: { children: ReactNode }) {
  const { session } = useSession();
  return session ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
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
          <Route path="*" element={<Navigate to="/ask" replace />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}
