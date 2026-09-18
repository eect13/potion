/* eslint-disable */
// @ts-nocheck
/**
 * Client-only router for the Tauri window. The generated route tree also
 * pulls `/api/auth/$` (Better Auth server handlers) which cannot pack into
 * a static WebView bundle.
 */
import { createRouter } from "@tanstack/react-router";
import { AppErrorComponent } from "@/lib/error-component";
import { Route as rootRoute } from "./routes/__root";
import { Route as IndexRouteImport } from "./routes/index";
import { Route as LoginRouteImport } from "./routes/login";
import { Route as STokenRouteImport } from "./routes/s.$token";

const IndexRoute = IndexRouteImport.update({
  id: "/",
  path: "/",
  getParentRoute: () => rootRoute,
});
const LoginRoute = LoginRouteImport.update({
  id: "/login",
  path: "/login",
  getParentRoute: () => rootRoute,
});
const STokenRoute = STokenRouteImport.update({
  id: "/s/$token",
  path: "/s/$token",
  getParentRoute: () => rootRoute,
});

const routeTree = rootRoute._addFileChildren({
  IndexRoute,
  LoginRoute,
  STokenRoute,
});

export function getDesktopRouter() {
  return createRouter({ routeTree, defaultErrorComponent: AppErrorComponent });
}
