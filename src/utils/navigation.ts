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

export const getActiveRoute = (routes: IRoute[], pathname: string): string => {
  const route = findCurrentRoute(routes, pathname);
  return route?.name || "Tokenizer";
};

export const getActiveNavbar = (
  routes: IRoute[],
  pathname: string
): boolean => {
  const route = findCurrentRoute(routes, pathname);
  return Boolean(route?.secondary);
};

export const getActiveNavbarText = (
  routes: IRoute[],
  pathname: string
): string | boolean => {
  return getActiveRoute(routes, pathname) || false;
};
