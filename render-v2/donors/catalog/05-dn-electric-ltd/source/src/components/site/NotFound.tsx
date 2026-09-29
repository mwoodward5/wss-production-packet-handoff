import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="display text-7xl text-foreground">404</div>
        <h1 className="mt-3 text-xl font-semibold">Circuit not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          That page doesn't exist. Let's get you back on the grid.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            to="/"
            className="rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background"
          >
            Go home
          </Link>
          <Link
            to="/contact"
            className="rounded-full border border-border px-4 py-2 text-sm font-semibold"
          >
            Contact us
          </Link>
        </div>
      </div>
    </div>
  );
}
