import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { SessionProvider } from "@/lib/session";
import { ProfileProvider } from "@/lib/profile";
import { AppShell } from "@/components/AppShell";
import { PublicOnly, RequireAuth } from "@/components/RouteGuards";
import { LoginPage, ResetPasswordPage } from "@/features/auth";
import { OnboardingPage, HomePage, SettingsPage } from "@/features/profile";
import { DashboardPage } from "@/features/dashboard";
import { WeightPage } from "@/features/weight";
import { MealsPage } from "@/features/meals";
import { ActivityPage } from "@/features/activity";

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
                <Route path="/weight" element={<WeightPage />} />
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
