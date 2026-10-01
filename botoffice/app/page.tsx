"use client";
import dynamic from "next/dynamic";

// WebGL, WASM (Rapier/Recast) and AudioContext are browser-only
const App = dynamic(() => import("@/components/App"), { ssr: false, loading: () => <div className="loading">กำลังจัดออฟฟิศ… 🏗️</div> });

export default function Page() {
  return <App />;
}
