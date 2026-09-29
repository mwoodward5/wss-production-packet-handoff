import { createFileRoute } from "@tanstack/react-router";
import { App } from "@/wss/App";
// Browser entry is main.tsx; retained route points to the same donor components.
export const Route = createFileRoute("/")({ component: () => <App path="/" /> });
