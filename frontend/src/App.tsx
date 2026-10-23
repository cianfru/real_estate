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
const Mercato = lazy(() => import("@/pages/Mercato"));
const PublicShare = lazy(() => import("@/pages/PublicShare"));
const Access = lazy(() => import("@/pages/Access"));
const Account = lazy(() => import("@/pages/Account"));
const Portale = lazy(() => import("@/pages/Portale"));
const PortaleLotto = lazy(() => import("@/pages/PortaleLotto"));

function Loading() {
  return (
    <div className="grid h-full place-items-center">
      <Spinner />
    </div>
  );
}

/** Logged in, and on the right side: staff pages for staff, the client area for clients. */
function RequireAuth({ children, client = false, any = false }: { children: ReactNode; client?: boolean; any?: boolean }) {
  const { data, isLoading, isError } = useMe();
  const loc = useLocation();
  if (isLoading) return <Loading />;
  if (isError || !data) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  const isClient = data.role === "client";
  if (!any && isClient !== client) return <Navigate to={isClient ? "/portale" : "/"} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/s/:token" element={<PublicShare />} />
        <Route path="/accesso/:token" element={<Access />} />
        <Route path="/" element={<RequireAuth><Explore /></RequireAuth>} />
        <Route path="/lotti/:id" element={<RequireAuth><LottoPage /></RequireAuth>} />
        <Route path="/mercato" element={<RequireAuth><Mercato /></RequireAuth>} />
        <Route path="/ricerche" element={<RequireAuth><SavedSearches /></RequireAuth>} />
        <Route path="/clienti" element={<RequireAuth><Clienti /></RequireAuth>} />
        <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
        <Route path="/account" element={<RequireAuth any><Account /></RequireAuth>} />
        <Route path="/portale" element={<RequireAuth client><Portale /></RequireAuth>} />
        <Route path="/portale/:id" element={<RequireAuth client><PortaleLotto /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
