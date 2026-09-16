import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AppShell, Card, StatusMessage, type NavItem } from "./components/index.js";
import SystemCheck from "./SystemCheck.js";
import { AuthProvider, ChangePassword, Login, RequireAuth, landingPath, useAuth } from "./auth/index.js";
import CreateTicket from "./tickets/CreateTicket.js";
import MyTickets from "./tickets/MyTickets.js";
import TicketDetail from "./tickets/TicketDetail.js";

// Routes, so that "opening a private route directly shows Login" is a real claim
// about a real URL rather than about which branch of a conditional rendered.

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}

/** The navigation each role is offered (ui-spec.md §2). */
function navigationFor(role: string, navigate: (path: string) => void): NavItem[] {
  if (role !== "REQUESTER") return [];
  return [
    { key: "/tickets", label: "My Tickets", onSelect: () => navigate("/tickets") },
    { key: "/create", label: "Create Ticket", onSelect: () => navigate("/create") },
  ];
}

function Shell() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Hidden while a password change is pending: that screen offers Log out and
  // nothing else, and links behind it would only be bounced back (BR-02).
  const pending = user?.mustChangePassword ?? false;
  const navItems = user && !pending ? navigationFor(user.role, navigate) : [];

  return (
    <AppShell
      navItems={navItems}
      activeKey={location.pathname}
      userName={user?.fullName}
      userRole={user?.role}
      onChangePassword={user && !pending ? () => navigate("/change-password") : undefined}
      onLogout={user ? () => void signOut() : undefined}
    >
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/change-password" element={<ChangePasswordRoute />} />

        <Route
          path="/create"
          element={
            <RequireAuth roles={["REQUESTER"]}>
              <CreateTicket />
            </RequireAuth>
          }
        />
        <Route
          path="/tickets"
          element={
            <RequireAuth roles={["REQUESTER"]}>
              <MyTickets />
            </RequireAuth>
          }
        />
        <Route
          path="/tickets/:ticketId"
          element={
            <RequireAuth roles={["REQUESTER"]}>
              <TicketDetail />
            </RequireAuth>
          }
        />

        <Route
          path="/workspace"
          element={
            <RequireAuth>
              <Workspace />
            </RequireAuth>
          }
        />

        <Route
          path="/system-check"
          element={
            <RequireAuth>
              <SystemCheck />
            </RequireAuth>
          }
        />

        <Route path="*" element={<Landing />} />
      </Routes>
    </AppShell>
  );
}

/**
 * Change Password sits outside `RequireAuth` — it is where the password gate
 * sends people, so it cannot also sit behind that gate — but it still has to
 * wait for "who am I" to answer.
 *
 * Deciding while that answer is in flight sends a reload of this URL straight to
 * Login, because `user` is null until `GET /api/auth/me` returns. That is the
 * defect the mandatory-mode test caught, and it would have hit any real user who
 * refreshed the screen they were told they must complete.
 */
function ChangePasswordRoute() {
  const { user, loading } = useAuth();
  if (loading) return <StatusMessage>Loading TokTickIT…</StatusMessage>;
  if (!user) return <Navigate to="/login" replace />;
  return <ChangePassword />;
}

/** Sends each visitor to the right start, once "who am I" has been answered. */
function Landing() {
  const { user, loading } = useAuth();
  if (loading) return <p className="zen-status" role="status">Loading TokTickIT…</p>;
  return <Navigate to={user ? landingPath(user.role) : "/login"} replace />;
}

/**
 * The IT Staff and Administrator start page, until their screens exist.
 *
 * Their real landing pages — the Ticket Queue and User Management — arrive with
 * the issues that build them. Sending them to a Requester screen instead would
 * be worse than saying so: the server already answers `403` there, so the screen
 * would fill with refusals and look broken rather than unbuilt.
 */
function Workspace() {
  const { user } = useAuth();
  return (
    <Card title="Your workspace" as="h1">
      <p>
        You are signed in as {user?.fullName}. The screens for your role are not part of this
        release yet — the IT Staff Ticket Queue and User Management arrive with the issues that
        build them.
      </p>
    </Card>
  );
}
