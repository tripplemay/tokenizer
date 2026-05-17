import React from "react";
import { MdDashboard, MdListAlt, MdComputer } from "react-icons/md";

// route.name is now a next-intl message key resolved at render time so the
// sidebar / navbar labels follow the active locale. The IRoute interface still
// types it as string, which is fine.
const routes = [
  {
    name: "nav.overview",
    layout: "",
    path: "/",
    icon: <MdDashboard className="h-6 w-6" />
  },
  {
    name: "nav.events",
    layout: "",
    path: "/events",
    icon: <MdListAlt className="h-6 w-6" />
  },
  {
    name: "nav.devices",
    layout: "",
    path: "/devices",
    icon: <MdComputer className="h-6 w-6" />
  }
];

export default routes;
