import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { SessionProvider } from "@/lib/session";
import { ProfileProvider } from "@/lib/profile";
import { AppShell } from "@/components/AppShell";
import { PublicOnly, RequireAuth } from "@/components/RouteGuards";
import { LoginPage, ResetPasswordPage } from "@/features/auth";
import { OnboardingPage, HomePage, SettingsPage } from "@/features/profile";
import { DashboardPage } from "@/features/dashboard";
import { MealsPage } from "@/features/meals";
import { ActivityPage } from "@/features/activity";
import { Spinner } from "@/components/States";

// Recharts is large: load the chart screens on demand so the first screen stays small.
const ReportsPage = lazy(() => import("@/features/reports").then((m) => ({ default: m.ReportsPage })));
const ConnectionsPage = lazy(() => import("@/features/connections").then((m) => ({ default: m.ConnectionsPage })));
const WeightPage = lazy(() => import("@/features/weight").then((m) => ({ default: m.WeightPage })));

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <ProfileProvider>
          <Routes>
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route element={<PublicOnly />}>
              <Route path="/login" element={<LoginPage />} />
            </Route>
            <Route element={<RequireAuth />}>
              <Route path="/onboarding" element={<OnboardingPage />} />
              <Route element={<AppShell />}>
                <Route index element={<DashboardPage />} />
                <Route path="/health" element={<HomePage />} />
                <Route path="/meals" element={<MealsPage />} />
                <Route path="/activity" element={<ActivityPage />} />
                <Route path="/weight" element={<Suspense fallback={<Spinner />}><WeightPage /></Suspense>} />
                <Route path="/connections" element={<Suspense fallback={<Spinner />}><ConnectionsPage /></Suspense>} />
                <Route path="/reports" element={<Suspense fallback={<Spinner />}><ReportsPage /></Suspense>} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ProfileProvider>
      </SessionProvider>
    </BrowserRouter>
  );
}
