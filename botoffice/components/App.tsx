"use client";
import { useEffect } from "react";
import Hud from "./Hud";
import Office from "./Office";
import { connect, useOffice } from "./store";

// dev-only handle for UI tests (node tests/*.mjs); stripped from production builds
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") (window as unknown as { __office: typeof useOffice }).__office = useOffice;

export default function App() {
  useEffect(() => connect(), []);
  return (
    <main className="app">
      <Office />
      <Hud />
    </main>
  );
}
