import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { LogOut, ShieldCheck, RefreshCw } from "lucide-react";
import {
  listBookings,
  updateBookingStatus,
  claimFirstAdmin,
  currentUserRole,
} from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";
import { siteConfig } from "@/config/siteConfig";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminDashboard,
});

const STATUSES = [
  "new",
  "reviewing",
  "consultation",
  "approved",
  "deposit_requested",
  "booked",
  "declined",
  "archived",
] as const;

type Status = (typeof STATUSES)[number];

const statusColor: Record<Status, string> = {
  new: "bg-signal/20 text-signal",
  reviewing: "bg-blue-500/20 text-blue-300",
  consultation: "bg-purple-500/20 text-purple-300",
  approved: "bg-emerald-500/20 text-emerald-300",
  deposit_requested: "bg-amber-500/20 text-amber-300",
  booked: "bg-emerald-600/30 text-emerald-200",
  declined: "bg-red-500/20 text-red-300",
  archived: "bg-neutral-500/20 text-neutral-400",
};

function AdminDashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const role = useQuery({
    queryKey: ["role"],
    queryFn: () => currentUserRole(),
  });

  const bookings = useQuery({
    queryKey: ["bookings"],
    queryFn: () => listBookings(),
    enabled: !!role.data?.isAdmin,
  });

  const update = useMutation({
    mutationFn: (v: { id: string; status: Status; adminNotes?: string }) =>
      updateBookingStatus({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      toast.success("Updated");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const claim = useMutation({
    mutationFn: () => claimFirstAdmin(),
    onSuccess: (res) => {
      if (res.claimed) {
        toast.success("You are now admin");
        qc.invalidateQueries({ queryKey: ["role"] });
      } else {
        toast.error("An admin already exists");
      }
    },
  });

  const rows = bookings.data?.rows ?? [];
  const filtered = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );
  const selected = filtered.find((r) => r.id === selectedId) ?? filtered[0];

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  if (role.isLoading) {
    return (
      <div className="wss min-h-screen bg-ink text-bone flex items-center justify-center">
        Loading…
      </div>
    );
  }

  if (!role.data?.isAdmin) {
    return (
      <div className="wss min-h-screen bg-ink text-bone flex items-center justify-center px-4">
        <div className="glass max-w-md p-8 text-center">
          <ShieldCheck className="mx-auto text-signal" size={32} />
          <h1 className="mt-4 text-2xl font-bold">Admin access required</h1>
          <p className="text-fadetext text-sm mt-2">
            You're signed in but not an admin. If you're the studio owner and no admin has been
            claimed yet, claim it now.
          </p>
          <button
            onClick={() => claim.mutate()}
            disabled={claim.isPending}
            className="mt-6 bg-signal text-ink font-semibold px-6 py-2.5 rounded-full emboss"
          >
            {claim.isPending ? "…" : "Claim admin"}
          </button>
          <button onClick={signOut} className="block mx-auto mt-4 text-xs text-fadetext">
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wss min-h-screen bg-ink text-bone">
      <header className="border-b border-line px-6 py-4 flex items-center justify-between sticky top-0 bg-ink/95 backdrop-blur z-10">
        <div className="flex items-center gap-4">
          <Link to="/" className="font-display font-bold">
            ✦ {siteConfig.studioName}
          </Link>
          <span className="text-xs text-fadetext uppercase tracking-widest">Admin</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => bookings.refetch()}
            className="text-fadetext hover:text-bone p-2"
            aria-label="Refresh"
          >
            <RefreshCw size={16} className={bookings.isFetching ? "animate-spin" : ""} />
          </button>
          <button
            onClick={signOut}
            className="text-fadetext hover:text-bone text-sm flex items-center gap-1.5"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </header>

      <div className="grid lg:grid-cols-[300px_1fr_400px] min-h-[calc(100vh-65px)]">
        {/* Filters */}
        <aside className="border-r border-line p-4 space-y-1">
          <h2 className="text-xs uppercase tracking-widest text-fadetext mb-3 px-2">
            Requests
          </h2>
          {(["all", ...STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition ${
                filter === s ? "bg-surface text-bone" : "text-fadetext hover:text-bone"
              }`}
            >
              <span className="capitalize">{s.replace("_", " ")}</span>
              <span className="text-xs opacity-70">{counts[s] ?? 0}</span>
            </button>
          ))}
        </aside>

        {/* List */}
        <section className="border-r border-line overflow-y-auto max-h-[calc(100vh-65px)]">
          {bookings.isLoading ? (
            <div className="p-8 text-fadetext">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-fadetext text-sm">No requests in this view.</div>
          ) : (
            <ul>
              {filtered.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => setSelectedId(r.id)}
                    className={`w-full text-left border-b border-line p-4 hover:bg-surface/50 transition ${
                      selected?.id === r.id ? "bg-surface" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{r.full_name}</div>
                        <div className="text-xs text-fadetext truncate">
                          {r.style ?? "—"} · {r.placement ?? "—"} · {r.approx_size ?? "—"}
                        </div>
                      </div>
                      <span
                        className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap ${statusColor[r.status as Status] ?? "bg-neutral-500/20"}`}
                      >
                        {r.status.replace("_", " ")}
                      </span>
                    </div>
                    <div className="text-[11px] text-fadetext mt-2">
                      #{String(r.request_number).padStart(5, "0")} ·{" "}
                      {new Date(r.created_at).toLocaleDateString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Detail */}
        <section className="overflow-y-auto max-h-[calc(100vh-65px)]">
          {selected ? (
            <BookingDetail
              key={selected.id}
              row={selected}
              onUpdate={(status, adminNotes) =>
                update.mutate({ id: selected.id, status, adminNotes })
              }
            />
          ) : (
            <div className="p-8 text-fadetext text-sm">Select a request</div>
          )}
        </section>
      </div>
    </div>
  );
}

function BookingDetail({
  row,
  onUpdate,
}: {
  row: NonNullable<Awaited<ReturnType<typeof listBookings>>["rows"]>[number];
  onUpdate: (status: Status, adminNotes?: string) => void;
}) {
  const [notes, setNotes] = useState(row.admin_notes ?? "");
  return (
    <div className="p-6 space-y-5">
      <div>
        <div className="text-xs text-fadetext uppercase tracking-widest">
          #{String(row.request_number).padStart(5, "0")} ·{" "}
          {new Date(row.created_at).toLocaleString()}
        </div>
        <h2 className="text-2xl font-bold mt-1">{row.full_name}</h2>
        <div className="text-sm text-fadetext mt-1">
          <a href={`mailto:${row.email}`} className="hover:text-bone">
            {row.email}
          </a>{" "}
          ·{" "}
          <a href={`tel:${row.phone}`} className="hover:text-bone">
            {row.phone}
          </a>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <Field label="Style" value={row.style} />
        <Field label="Color" value={row.color_pref} />
        <Field label="Placement" value={row.placement} />
        <Field label="Size" value={row.approx_size} />
        <Field label="Budget" value={row.budget} />
        <Field label="Availability" value={row.availability} />
      </div>

      <Block label="Idea">{row.description}</Block>
      {row.health_notes && <Block label="Health notes">{row.health_notes}</Block>}
      {row.reference_url && (
        <Block label="Reference URL">
          <a
            href={row.reference_url}
            target="_blank"
            rel="noreferrer"
            className="text-signal hover:underline break-all"
          >
            {row.reference_url}
          </a>
        </Block>
      )}
      {row.reference_urls && row.reference_urls.length > 0 && (
        <Block label={`Attached references (${row.reference_urls.length})`}>
          <ul className="text-xs text-fadetext space-y-1">
            {row.reference_urls.map((p) => (
              <li key={p} className="truncate">{p}</li>
            ))}
          </ul>
        </Block>
      )}

      <div>
        <label className="text-xs uppercase tracking-widest text-fadetext">Admin notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="field mt-2"
          placeholder="Private notes…"
        />
      </div>

      <div>
        <div className="text-xs uppercase tracking-widest text-fadetext mb-2">
          Update status
        </div>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => onUpdate(s, notes)}
              className={`px-3 py-1.5 rounded-full text-xs border transition ${
                row.status === s
                  ? "bg-signal text-ink border-signal font-semibold"
                  : "border-line text-fadetext hover:text-bone"
              }`}
            >
              {s.replace("_", " ")}
            </button>
          ))}
        </div>
        <button
          onClick={() => onUpdate(row.status as Status, notes)}
          className="mt-4 text-xs text-fadetext hover:text-bone underline underline-offset-4"
        >
          Save notes only
        </button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-fadetext">{label}</div>
      <div className="mt-0.5">{value || "—"}</div>
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="glass p-4">
      <div className="text-[10px] uppercase tracking-widest text-fadetext mb-2">{label}</div>
      <div className="text-sm whitespace-pre-wrap">{children}</div>
    </div>
  );
}
