import { createRoot } from "react-dom/client";

function App() {
  return <h1>Analytiq</h1>;
}

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(<App />);
}
