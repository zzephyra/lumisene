import { PublicProfilePage } from "./features/profile/profile-page";
import { LumiLogo } from "./components/brand/LumiLogo";
import { BrandInformation } from "./features/landing/brand-information";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router";

import { LandingPage } from "./features/landing";
import { LoginPage, RequireSession } from "./features/auth";
import { SkillsScreen, AssetsScreen, ExportsScreen, UsersScreen, TasksScreen, AdminOverview, AdminModuleScreen, AssignmentScreen, CatalogScreen, ModelDetailsScreen, ModelAdminPage, SystemSettingsScreen } from "./features/admin";
import { ProjectEntryPage, ProjectsPage, StudioEntry } from "./features/projects";
import { setUnauthorizedHandler } from "./lib/api";

const VideoEditor = lazy(() => import("./features/video-editor/video-editor").then(module => ({ default: module.VideoEditor })));

export function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <UnauthorizedRedirect />
        <Routes>
          <Route path="/projects/:projectId/editor/:documentId" element={<RequireSession><Suspense fallback={<div role="status" aria-label="正在加载编辑器" className="grid min-h-screen place-items-center bg-canvas text-ink"><LumiLogo variant="icon" /></div>}><VideoEditor /></Suspense></RequireSession>} />
          <Route path="/u/:userId" element={<PublicProfilePage />} />
          <Route element={<LandingPage />} path="/" />
          <Route element={<BrandInformation kind="about" />} path="/about" />
          <Route element={<BrandInformation kind="privacy" />} path="/privacy" />
          <Route element={<BrandInformation kind="terms" />} path="/terms" />
          <Route element={<LoginPage />} path="/login" />
          <Route
            element={
              <RequireSession>
                <StudioEntry />
              </RequireSession>
            }
            path="/studio"
          />
          <Route
            element={
              <RequireSession>
                <ProjectsPage />
              </RequireSession>
            }
            path="/projects"
          />
          <Route
            element={
              <RequireSession>
                <ProjectEntryPage />
              </RequireSession>
            }
            path="/projects/:projectId/*"
          />
          <Route
            element={
              <RequireSession>
                <ModelAdminPage />
              </RequireSession>
            }
            path="/admin"
          >
            <Route index element={<AdminOverview />} />
            <Route element={<AdminModuleScreen />} path=":module" />
            <Route element={<AssetsScreen />} path="assets" />
            <Route element={<ExportsScreen />} path="exports" />
            <Route element={<UsersScreen />} path="users" />
            <Route element={<SkillsScreen />} path="skills" />
            <Route element={<SystemSettingsScreen />} path="settings" />
            <Route element={<TasksScreen />} path="tasks" />
            <Route element={<CatalogScreen />} path="models" />
            <Route element={<ModelDetailsScreen />} path="models/details" />
            <Route element={<Navigate replace to="/admin/models" />} path="register" />
            <Route element={<AssignmentScreen />} path="assignments" />
          </Route>
          <Route element={<Navigate replace to="/studio" />} path="*" />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function UnauthorizedRedirect() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      queryClient.clear();
      navigate("/login", { replace: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate, queryClient]);

  return null;
}
