import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getDesktopRouter } from "./desktop-router";
import "./styles.css";

const el = document.getElementById("potion-root");
if (!el) {
  throw new Error("Potion: #potion-root missing");
}

createRoot(el).render(
  <StrictMode>
    <RouterProvider router={getDesktopRouter()} />
  </StrictMode>,
);
