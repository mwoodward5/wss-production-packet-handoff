import {getClient,pageMeta,contactCopy} from '@/wss/bridge';
const client=getClient();
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHero } from "@/components/PageChrome";

export const Route = createFileRoute("/contact")({
  head:()=>pageMeta("Contact"),
  component: ContactPage,
});

type Status = "idle" | "sending" | "sent" | "error";

function ContactPage() {
  const [format, setFormat] = useState(client.services[0].name);
  const [level, setLevel] = useState<"New" | "Some experience" | "Instructor" | "Competitor">("New");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [hp, setHp] = useState(""); // honeypot
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>("");

  function onSubmit(e:React.FormEvent){e.preventDefault();}

  return (
    <>
      <PageHero
        eyebrow="Contact"
        title={<>Start with a <span className="italic text-steel">conversation.</span></>}
        sub="Choose a contact option below."
      />
      <section className="mx-auto grid max-w-[1440px] grid-cols-12 gap-6 px-6 py-16 md:px-10 md:py-24">
        <div className="col-span-12 md:col-span-5">
          <h2 className="font-serif text-3xl text-bone md:text-4xl">{client.identity.businessName}</h2>
          {contactCopy()&&<p className="mt-6 whitespace-pre-line text-steel">{contactCopy()}</p>}
          <div className="mt-8 space-y-6 border-t border-hairline pt-6"><p>{client.identity.city}, {client.identity.state}</p><a className="block text-edge" href={client.identity.phoneTel}>{client.identity.phoneDisplay}</a>{client.identity.email&&<a className="block text-edge" href={'mailto:'+client.identity.email}>{client.identity.email}</a>}{client.trust.bookingUrl&&<a className="block text-edge" href={client.trust.bookingUrl}>Booking</a>}</div>
        </div>

        {
          <form
            className="glass col-span-12 flex flex-col gap-5 rounded-none p-8 md:col-span-7 md:p-10"
            onSubmit={onSubmit}
            noValidate
          >
            {/* Honeypot — must be empty */}
            <input
              type="text"
              name="hp"
              value={hp}
              onChange={(e) => setHp(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="hidden"
            />
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Name">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={100}
                  className="w-full border-b border-hairline bg-transparent py-3 text-bone outline-none focus:border-edge"
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  maxLength={255}
                  className="w-full border-b border-hairline bg-transparent py-3 text-bone outline-none focus:border-edge"
                />
              </Field>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Your level">
                <select
                  value={level}
                  onChange={(e) => setLevel(e.target.value as typeof level)}
                  className="w-full border-b border-hairline bg-transparent py-3 text-bone outline-none focus:border-edge"
                >
                  {["New", "Some experience", "Instructor", "Competitor"].map((v) => (
                    <option key={v} value={v} className="bg-ink">{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="Preferred format">
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as typeof format)}
                  className="w-full border-b border-hairline bg-transparent py-3 text-bone outline-none focus:border-edge"
                >
                  {client.services.map(s=>s.name).map((v) => (
                    <option key={v} value={v} className="bg-ink">{v}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Where you're writing from (optional)">
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                maxLength={120}
                placeholder="City or region"
                className="w-full border-b border-hairline bg-transparent py-3 text-bone outline-none placeholder:text-steel/60 focus:border-edge"
              />
            </Field>
            <Field label="Notes">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={5}
                maxLength={2000}
                className="w-full resize-none border-b border-hairline bg-transparent py-3 text-bone outline-none focus:border-edge"
              />
            </Field>
            <p className="text-sm text-steel">This form is a local draft and does not send. Use the phone or email link to contact the business.</p>
          </form>
        }
      </section>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="eyebrow text-bone-dim">{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}
