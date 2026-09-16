import { Link } from "react-router-dom";
import { Card } from "../components/index.js";
import { landingPath, useAuth } from "./AuthContext.js";

/**
 * ui-spec.md §5. Shown when a signed-in user opens a screen their role may not
 * use.
 *
 * It carries no detail about what was requested: the point of the screen is that
 * the answer reveals nothing, which is the same reason the API decides role
 * refusals before it looks a resource up (BR-18).
 */
export default function Forbidden() {
  const { user } = useAuth();

  return (
    <Card title="You do not have access to this page" as="h1">
      <p>Your role does not include this screen.</p>
      {user && (
        <Link className="zen-button zen-button--secondary" to={landingPath(user.role)}>
          Go to your start page
        </Link>
      )}
    </Card>
  );
}
