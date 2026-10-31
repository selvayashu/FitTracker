import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useSession } from "@/lib/session";
import { useProfile } from "@/lib/profile";
import { ErrorState, Spinner } from "./States";

/** Requires a signed-in user; sends first-time users to onboarding until their profile is complete. */
export function RequireAuth() {
  const { user, loading: sessionLoading } = useSession();
  const { profile, loading: profileLoading, error, refresh } = useProfile();
  const { pathname } = useLocation();

  if (sessionLoading || (user && profileLoading)) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (error) return <div className="p-4"><ErrorState message={`Could not load your profile: ${error}`} onRetry={() => void refresh()} /></div>;
  if (!profile?.onboarded && pathname !== "/onboarding") return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

/** Keeps signed-in users away from the login page. */
export function PublicOnly() {
  const { user, loading } = useSession();
  if (loading) return <Spinner />;
  return user ? <Navigate to="/" replace /> : <Outlet />;
}
