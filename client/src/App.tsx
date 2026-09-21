import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AppShell, StatusMessage, type NavItem } from "./components/index.js";
import SystemCheck from "./SystemCheck.js";
import { AuthProvider, ChangePassword, Login, RequireAuth, landingPath, useAuth } from "./auth/index.js";
import UserManagement from "./admin/UserManagement.js";
import StaffTicketDetail from "./staff/StaffTicketDetail.js";
import StaffTicketQueue from "./staff/StaffTicketQueue.js";
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
  if (role === "REQUESTER") {
    return [
      { key: "/tickets", label: "My Tickets", onSelect: () => navigate("/tickets") },
      { key: "/create", label: "Create Ticket", onSelect: () => navigate("/create") },
    ];
  }

  // IT Staff and Administrators share the queue (decision D-08); only an
  // Administrator is offered Users, which issue #55 adds. IT Staff must not see
  // the control at all — the server refuses them at step 4, and offering a
  // button that is certain to be refused is not a courtesy.
  const items: NavItem[] = [{ key: "/queue", label: "Ticket Queue", onSelect: () => navigate("/queue") }];
  if (role === "ADMINISTRATOR") {
    items.push({ key: "/users", label: "Users", onSelect: () => navigate("/users") });
  }
  return items;
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
            // Open to every role: issue #47 already lets IT Staff and
            // Administrators read any ticket, and the queue links here. The
            // screen hides the attachment controls for anyone who is not the
            // Requester, matching the server rather than offering a button that
            // would be refused.
            <RequireAuth>
              <TicketDetail />
            </RequireAuth>
          }
        />

        <Route
          path="/queue"
          element={
            <RequireAuth roles={["IT_STAFF", "ADMINISTRATOR"]}>
              <StaffTicketQueue />
            </RequireAuth>
          }
        />
        <Route
          path="/queue/:ticketId"
          element={
            // The operational screen is its own route rather than a mode of
            // /tickets/:id: the two show the same ticket to different readers,
            // and a Requester must never reach a screen carrying Internal Notes
            // — not even one that would render them empty.
            <RequireAuth roles={["IT_STAFF", "ADMINISTRATOR"]}>
              <StaffTicketDetail />
            </RequireAuth>
          }
        />

        <Route
          path="/users"
          element={
            // Administrator only. The server refuses every /api/admin route to
            // anyone else before it looks a user up, so this guard decides what
            // the browser renders and nothing more (AC-23).
            <RequireAuth roles={["ADMINISTRATOR"]}>
              <UserManagement />
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

// The `Workspace` placeholder that stood here is gone: issue #50 gives IT Staff
// and Administrators the real Ticket Queue to land on.
