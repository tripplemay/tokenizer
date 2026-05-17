import { IRoute } from "types/navigation";

export const isWindowAvailable = () => typeof window !== "undefined";

const matches = (routePath: string, pathname: string) => {
  if (routePath === "/") return pathname === "/";
  return pathname === routePath || pathname.startsWith(routePath + "/");
};

export const findCurrentRoute = (
  routes: IRoute[],
  pathname: string
): IRoute | undefined => {
  for (const route of routes) {
    if (route.items) {
      const found = findCurrentRoute(route.items, pathname);
      if (found) return found;
    }
    if (route.path && pathname && matches(route.path, pathname)) return route;
  }
  return undefined;
};

// Returns the active route's message key (e.g. "nav.overview") so callers
// can resolve it via next-intl on the client side. Defaults to "app.name"
// when no route matches (e.g. /admin/setup which isn't in the sidebar).
export const getActiveRouteKey = (routes: IRoute[], pathname: string): string => {
  const route = findCurrentRoute(routes, pathname);
  return route?.name || "app.name";
};

export const getActiveNavbar = (
  routes: IRoute[],
  pathname: string
): boolean => {
  const route = findCurrentRoute(routes, pathname);
  return Boolean(route?.secondary);
};

// Kept for backward compatibility — same as getActiveRouteKey now.
export const getActiveRoute = getActiveRouteKey;
