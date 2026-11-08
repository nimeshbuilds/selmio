import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import SelmioApp from "../components/selmio/app";
import "../app/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Selmio could not find its application root.");

createRoot(root).render(
  <StrictMode>
    <SelmioApp />
  </StrictMode>,
);
