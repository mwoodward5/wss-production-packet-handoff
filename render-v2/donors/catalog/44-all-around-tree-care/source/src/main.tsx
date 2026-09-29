import "./styles.css";

// Dynamic import keeps invalid/missing islands from importing donor components.
import("./spa").then(({ mount }) => mount()).catch(() => {
  const root = document.getElementById("root");
  if (root) {
    const message = document.createElement("p");
    message.setAttribute("role", "alert");
    message.textContent = "This site is unavailable because required client data could not be verified.";
    root.replaceChildren(message);
  }
});
