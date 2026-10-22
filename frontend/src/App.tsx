import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Spinner } from "@/components/ui";
import { useMe } from "@/lib/hooks";
import Explore from "@/pages/Explore";
import Login from "@/pages/Login";

const LottoPage = lazy(() => import("@/pages/LottoPage"));
const SavedSearches = lazy(() => import("@/pages/SavedSearches"));
const Clienti = lazy(() => import("@/pages/Clienti"));
const Admin = lazy(() => import("@/pages/Admin"));
const PublicShare = lazy(() => import("@/pages/PublicShare"));

function Loading() {
  return (
    <div className="grid h-full place-items-center">
      <Spinner />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isLoading, isError } = useMe();
  const loc = useLocation();
  if (isLoading) return <Loading />;
  if (isError || !data) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/s/:token" element={<PublicShare />} />
        <Route path="/" element={<RequireAuth><Explore /></RequireAuth>} />
        <Route path="/lotti/:id" element={<RequireAuth><LottoPage /></RequireAuth>} />
        <Route path="/ricerche" element={<RequireAuth><SavedSearches /></RequireAuth>} />
        <Route path="/clienti" element={<RequireAuth><Clienti /></RequireAuth>} />
        <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
