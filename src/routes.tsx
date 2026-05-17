import React from "react";
import { MdDashboard, MdListAlt } from "react-icons/md";

const routes = [
  {
    name: "Overview",
    layout: "",
    path: "/",
    icon: <MdDashboard className="h-6 w-6" />
  },
  {
    name: "Events",
    layout: "",
    path: "/events",
    icon: <MdListAlt className="h-6 w-6" />
  }
];

export default routes;
