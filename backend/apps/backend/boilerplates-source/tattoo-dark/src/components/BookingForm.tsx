import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { Check, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { bookingSchema, type BookingValues } from "@/lib/bookingSchema";
import { siteConfig } from "@/config/siteConfig";
import { supabase } from "@/integrations/supabase/client";
import { track } from "@/lib/analytics";
import { readUtm } from "@/lib/utm";

function readPrefill(): Partial<BookingValues> {
  try {
    const raw = sessionStorage.getItem("wss_prefill");
    if (!raw) return {};
    const p = JSON.parse(raw);
    sessionStorage.removeItem("wss_prefill");
    return p;
  } catch {
    return {};
  }
}

export function BookingForm() {
  const [sent, setSent] = useState(false);
  const [confirmation, setConfirmation] = useState<{ requestNumber?: number } | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [started, setStarted] = useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<BookingValues>({ resolver: zodResolver(bookingSchema) });

  useEffect(() => {
    const p = readPrefill();
    Object.entries(p).forEach(([k, v]) => {
      if (v != null) setValue(k as keyof BookingValues, v as never);
    });
  }, [setValue]);

  const handleFocus = () => {
    if (!started) {
      setStarted(true);
      track("form_start", { form: "booking" });
    }
  };

  const uploadReferences = async (): Promise<string[]> => {
    if (!files.length) return [];
    setUploading(true);
    const urls: string[] = [];
    for (const file of files) {
      const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-100);
      const path = `req/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;
      const { error } = await supabase.storage
        .from("booking-references")
        .upload(path, file, { contentType: file.type });
      if (error) throw error;
      urls.push(path);
    }
    setUploading(false);
    return urls;
  };

  const onSubmit = async (data: BookingValues) => {
    track("form_submit", { form: "booking" });
    try {
      const referenceUrls = await uploadReferences();
      const utm = readUtm();
      const res = await fetch("/api/public/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, referenceUrls, utm }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (res.status === 429) {
          toast.error("Too many requests. Try again in an hour.");
        } else {
          toast.error(body.error || "Something went wrong. Please try again.");
        }
        track("form_error", { form: "booking", status: res.status });
        return;
      }
      track("form_success", { form: "booking" });
      setConfirmation({ requestNumber: body.requestNumber });
      setSent(true);
      toast.success("Request received. Check your email for a confirmation.");
    } catch (e) {
      console.error(e);
      toast.error("Upload or submission failed. Please try again.");
      track("form_error", { form: "booking", error: "exception" });
    }
  };

  const f = "field";
  const err = (m?: string) => m && <p className="text-signal text-xs mt-1">{m}</p>;

  if (sent)
    return (
      <section id="booking" className="py-24 container-wss">
        <div className="glass max-w-xl mx-auto p-10 text-center">
          <div className="w-14 h-14 rounded-full bg-signal/20 text-signal grid place-items-center mx-auto mb-5">
            <Check size={28} />
          </div>
          <h2 className="text-3xl font-bold mb-3">Request received.</h2>
          {confirmation?.requestNumber && (
            <p className="text-xs uppercase tracking-widest text-fadetext mb-3">
              Confirmation #{String(confirmation.requestNumber).padStart(5, "0")}
            </p>
          )}
          <p className="text-fadetext">
            {siteConfig.artistName} will reply with appointment options and a deposit link if it is a fit.
          </p>
        </div>
      </section>
    );

  return (
    <section id="booking" className="py-24 container-wss">
      <div className="section-label">Booking</div>
      <h2 className="text-4xl font-bold mb-3">Send a complete request — not a messy DM.</h2>
      <p className="text-fadetext max-w-xl mb-10">
        Collects everything {siteConfig.artistName} needs before saying yes.
      </p>
      <form
        onSubmit={handleSubmit(onSubmit)}
        onFocus={handleFocus}
        className="glass p-8 grid md:grid-cols-2 gap-5 max-w-3xl"
      >
        <div>
          <input {...register("fullName")} placeholder="Full name" className={f} />
          {err(errors.fullName?.message)}
        </div>
        <div>
          <input {...register("email")} placeholder="Email" className={f} />
          {err(errors.email?.message)}
        </div>
        <div>
          <input {...register("phone")} placeholder="Phone" className={f} />
          {err(errors.phone?.message)}
        </div>
        <div>
          <input {...register("placement")} placeholder="Placement (e.g. forearm)" className={f} />
          {err(errors.placement?.message)}
        </div>
        <div>
          <input {...register("approxSize")} placeholder="Approx size" className={f} />
          {err(errors.approxSize?.message)}
        </div>
        <div>
          <input {...register("style")} placeholder="Preferred style" className={f} />
          {err(errors.style?.message)}
        </div>
        <div>
          <select {...register("colorPref")} className={f}>
            <option>Black & Grey</option>
            <option>Full Color</option>
            <option>Not sure</option>
          </select>
        </div>
        <div>
          <input {...register("budget")} placeholder="Rough budget" className={f} />
          {err(errors.budget?.message)}
        </div>
        <div className="md:col-span-2">
          <textarea
            {...register("description")}
            placeholder="Describe your idea"
            rows={3}
            className={f}
          />
          {err(errors.description?.message)}
        </div>
        <div>
          <input
            {...register("referenceUrl")}
            placeholder="Reference image link (optional)"
            className={f}
          />
          {err(errors.referenceUrl?.message)}
        </div>
        <div>
          <input
            {...register("availability")}
            placeholder="General availability"
            className={f}
          />
          {err(errors.availability?.message)}
        </div>
        <div className="md:col-span-2">
          <div className="text-[10px] uppercase tracking-widest text-fadetext mb-2">
            Health intake — check any that apply
          </div>
          <div className="grid sm:grid-cols-2 gap-2 text-sm text-fadetext">
            <label className="flex items-center gap-2">
              <input type="checkbox" {...register("healthFlags.pregnantOrNursing")} /> Pregnant / nursing
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" {...register("healthFlags.bleedingDisorder")} /> Bleeding disorder
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" {...register("healthFlags.recentSurgery")} /> Surgery in last 6 months
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" {...register("healthFlags.onMedication")} /> On blood thinners / retinoids
            </label>
            <label className="flex items-center gap-2 sm:col-span-2">
              <input type="checkbox" {...register("healthFlags.metalOrPigmentAllergy")} /> Metal / pigment allergies
            </label>
          </div>
        </div>
        <div className="md:col-span-2">
          <textarea
            {...register("healthNotes")}
            placeholder={`Anything else ${siteConfig.artistName.split(" ")[0]} should know (allergies, skin conditions, meds) — private, admin-only.`}
            rows={2}
            className={f}
          />
        </div>
        <div className="md:col-span-2">
          <label className="flex items-center gap-3 text-sm text-fadetext cursor-pointer border border-line rounded-lg px-4 py-3 hover:border-signal/50 transition">
            <Upload size={16} />
            <span>
              {files.length ? `${files.length} reference image(s) attached` : "Attach reference images (optional)"}
            </span>
            <input
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 5))}
            />
          </label>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {files.map((file, i) => (
                <span key={i} className="tag flex items-center gap-2">
                  {file.name}
                  <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-fadetext">
          <input type="checkbox" {...register("over18")} /> I am 18 or older (photo ID required day-of)
        </label>
        <label className="flex items-center gap-2 text-sm text-fadetext">
          <input type="checkbox" {...register("depositAck")} /> I understand a {siteConfig.pricing.deposit} deposit is required
        </label>
        <label className="flex items-center gap-2 text-sm text-fadetext md:col-span-2">
          <input type="checkbox" {...register("photoRelease")} /> {siteConfig.artistName} may photograph the healed piece for portfolio (optional)
        </label>
        {err(errors.over18?.message)}
        {err(errors.depositAck?.message)}
        <button
          disabled={isSubmitting || uploading}
          className="md:col-span-2 bg-signal text-ink font-semibold py-3.5 rounded-full hover:brightness-110 transition emboss disabled:opacity-60"
        >
          {uploading ? "Uploading…" : isSubmitting ? "Sending…" : "Submit Tattoo Request"}
        </button>
        <p className="md:col-span-2 text-[11px] text-fadetext text-center">
          Health notes are private and only visible to studio admin.
        </p>
      </form>
    </section>
  );
}
