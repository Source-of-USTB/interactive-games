import { AdminPage } from "./AdminPage.js";
import { JoinPage } from "./JoinPage.js";
import { ScreenPage } from "./ScreenPage.js";

export function App() {
  const path = window.location.pathname;
  if (path.startsWith("/admin")) return <AdminPage />;
  if (path.startsWith("/screen")) return <ScreenPage />;
  return <JoinPage />;
}
