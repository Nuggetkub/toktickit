import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AppShell, type NavItem } from "./components/index.js";
import SystemCheck from "./SystemCheck.js";
import { RequesterProvider, RequesterSelector, RequireRequester, useRequester } from "./requester/index.js";
import CreateTicket from "./tickets/CreateTicket.js";
import MyTickets from "./tickets/MyTickets.js";
import TicketDetail from "./tickets/TicketDetail.js";

// Routes, so that AC-02 — opening a requester-scoped route directly shows the
// selector — is a real claim about a real URL rather than about which branch of
// a conditional happened to render.

export default function App() {
  return (
    <RequesterProvider>
      <Shell />
    </RequesterProvider>
  );
}

function Shell() {
  const { requester, clear } = useRequester();
  const location = useLocation();
  const navigate = useNavigate();

  // Navigation is hidden until a Requester is chosen: on the selector screen
  // there is nothing behind those links yet, and offering them would invite the
  // guard to bounce the user straight back.
  const navItems: NavItem[] = requester
    ? [
        { key: "/create", label: "Create Ticket", onSelect: () => navigate("/create") },
        { key: "/tickets", label: "My Tickets", onSelect: () => navigate("/tickets") },
      ]
    : [];

  function changeRequester() {
    // BR-11: drop the context first, so requester-scoped screens unmount before
    // the selector appears rather than briefly showing the old requester's data.
    clear();
    navigate("/select-requester", { replace: true });
  }

  return (
    <AppShell
      navItems={navItems}
      activeKey={location.pathname}
      requesterName={requester?.fullName}
      onChangeRequester={requester ? changeRequester : undefined}
    >
      <Routes>
        <Route path="/select-requester" element={<RequesterSelector />} />
        <Route
          path="/create"
          element={
            <RequireRequester>
              <CreateTicket />
            </RequireRequester>
          }
        />
        <Route
          path="/tickets"
          element={
            <RequireRequester>
              <MyTickets />
            </RequireRequester>
          }
        />
        <Route
          path="/tickets/:ticketId"
          element={
            <RequireRequester>
              <TicketDetail />
            </RequireRequester>
          }
        />
        <Route path="/system-check" element={<SystemCheck />} />
        <Route path="*" element={<Navigate to="/tickets" replace />} />
      </Routes>
    </AppShell>
  );
}
