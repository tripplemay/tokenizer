/* eslint-disable */
import React from "react";
import { useCallback } from "react";
import { usePathname } from "next/navigation";
import NavLink from "components/link/NavLink";
import DashIcon from "components/icons/DashIcon";

export const SidebarLinks = (props: { routes: RoutesType[] }): JSX.Element => {
  const pathname = usePathname();
  const { routes } = props;

  const isActive = useCallback(
    (routePath: string) => {
      if (!pathname) return false;
      if (routePath === "/") return pathname === "/";
      return pathname === routePath || pathname.startsWith(routePath + "/");
    },
    [pathname]
  );

  const createLinks = (routes: RoutesType[]) => {
    return routes.map((route, index) => {
      const href = route.layout ? route.layout + "/" + route.path : route.path;
      const active = isActive(route.path);
      return (
        <NavLink key={index} href={href}>
          <div className="relative mb-3 flex hover:cursor-pointer">
            <li
              className="my-[3px] flex cursor-pointer items-center px-8"
              key={index}
            >
              <span
                className={`${
                  active
                    ? "font-bold text-brand-500 dark:text-white"
                    : "font-medium text-gray-600"
                }`}
              >
                {route.icon ? route.icon : <DashIcon />}{" "}
              </span>
              <p
                className={`leading-1 ml-4 flex ${
                  active
                    ? "font-bold text-navy-700 dark:text-white"
                    : "font-medium text-gray-600"
                }`}
              >
                {route.name}
              </p>
            </li>
            {active ? (
              <div className="absolute right-0 top-px h-9 w-1 rounded-lg bg-brand-500 dark:bg-brand-400" />
            ) : null}
          </div>
        </NavLink>
      );
    });
  };

  return <>{createLinks(routes)}</>;
};

export default SidebarLinks;
